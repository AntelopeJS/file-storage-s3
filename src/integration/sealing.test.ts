import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  FileNotFoundError,
  GetFileSnapshot,
  SealFile,
  GetFileSeal,
  RemoveSealedFile,
  SEALED_PREFIX,
  type SealFileRequest,
} from "@antelopejs/interface-file-storage";

import { bindAdmission } from "../sealing-admission";
import { construct, destroy, getS3Client } from "../index";
import { internal } from "../implementations/file-storage/beta";
import { BackingPrefix, MaximumSealBytes, readSlot } from "../sealing-store";
import {
  bucket,
  config,
  gate,
  upload,
  request,
  code,
  withFault,
  readBytes,
} from "./fixture";

test("public interface bindings expose the complete seal lifecycle", async () => {
  const input = await request();
  assert.deepEqual(
    (await GetFileSnapshot(input.source.resourceKey)).identity,
    input.source,
  );
  const sealed = await SealFile(input);
  assert.deepEqual(await GetFileSeal(input), {
    status: "sealed",
    file: sealed,
  });
  assert.deepEqual(await RemoveSealedFile(input), { status: "removed" });
});

test("same-admission concurrent seals return one identity and trusted provenance", async () => {
  const input = await request();
  const [first, second] = await Promise.all([
    internal.sealFile(input),
    internal.sealFile(input),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.provenance, {
    admissionId: input.admissionId,
    source: input.source,
  });
  assert.equal(await readBytes(input.destinationKey), "original bytes");
  assert.equal(await internal.fileExists(input.source.resourceKey), true);
});

test("different admissions race without clobbering and loser cannot remove winner", async () => {
  const first = await request();
  const second = { ...(await request()), destinationKey: first.destinationKey };
  const results = await Promise.allSettled([
    internal.sealFile(first),
    internal.sealFile(second),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const winner = results[0]?.status === "fulfilled" ? first : second;
  const loser = winner === first ? second : first;
  await assert.rejects(
    internal.getFileSeal(loser),
    code("DESTINATION_CONFLICT"),
  );
  await assert.rejects(
    internal.removeSealedFile(loser),
    code("DESTINATION_CONFLICT"),
  );
  assert.equal((await internal.getFileSeal(winner)).status, "sealed");
});

test("identical PUT replay gets a new generation; seal reads the captured version", async () => {
  const input = await request();
  await upload(input.source.resourceKey);
  const replay = await internal.getFileSnapshot(input.source.resourceKey);
  assert.notEqual(replay.identity.generation, input.source.generation);
  await upload(
    input.source.resourceKey,
    "replacement bytes with a different length",
  );
  const sealed = await internal.sealFile(input);
  assert.equal(sealed.metadata.size, Buffer.byteLength("original bytes"));
  assert.equal(await readBytes(input.destinationKey), "original bytes");
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: input.source.resourceKey,
      VersionId: input.source.generation,
    }),
  );
  assert.deepEqual(await internal.sealFile(input), sealed);
  assert.equal(
    await readBytes(input.source.resourceKey),
    "replacement bytes with a different length",
  );
});

test("missing expected version fails closed", async () => {
  const input = await request();
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: input.source.resourceKey,
      VersionId: input.source.generation,
    }),
  );
  await assert.rejects(internal.sealFile(input), code("GENERATION_MISMATCH"));
  assert.deepEqual(await internal.getFileSeal(input), { status: "absent" });
});

test("binding-only crash recovers and changed destination/source conflicts", async () => {
  const input = await request();
  await bindAdmission(input);
  destroy();
  await construct(config);
  assert.deepEqual(await internal.getFileSeal(input), { status: "absent" });
  await assert.rejects(
    internal.getFileSeal({ ...input, destinationKey: `${SEALED_PREFIX}other` }),
    code("DESTINATION_CONFLICT"),
  );
  await assert.rejects(
    internal.sealFile({
      ...input,
      source: { ...input.source, generation: "different" },
    }),
    code("DESTINATION_CONFLICT"),
  );
  assert.equal(
    (await internal.sealFile(input)).identity.resourceKey,
    input.destinationKey,
  );
});

test("foreign destination bytes fail closed", async () => {
  const input = await request();
  await upload(input.destinationKey, "not a slot");
  await assert.rejects(
    internal.getFileSeal(input),
    code("DESTINATION_CONFLICT"),
  );
  await assert.rejects(internal.sealFile(input), code("DESTINATION_CONFLICT"));
  await assert.rejects(
    internal.removeSealedFile(input),
    code("DESTINATION_CONFLICT"),
  );
  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: input.destinationKey }),
  );
  assert.equal(await response.Body?.transformToString(), "not a slot");
});

test("lost publication acknowledgement reconciles the committed identity", async () => {
  const input = await request();
  await withFault(
    async (command, next) => {
      const result = await next();
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === input.destinationKey
      )
        throw new Error("lost ack");
      return result;
    },
    async () => {
      const sealed = await internal.sealFile(input);
      assert.deepEqual(await internal.getFileSeal(input), {
        status: "sealed",
        file: sealed,
      });
    },
  );
});

test("unknown publication then cancellation fences a late PUT", async () => {
  const input = await request();
  let delayed: (() => Promise<unknown>) | undefined;
  await withFault(
    async (command, next) => {
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === input.destinationKey &&
        command.input.IfNoneMatch
      ) {
        delayed = next;
        throw new Error("request still in flight");
      }
      return next();
    },
    async () => {
      await assert.rejects(internal.sealFile(input), code("OUTCOME_UNKNOWN"));
    },
  );
  assert.deepEqual(await internal.removeSealedFile(input), {
    status: "removed",
  });
  assert.ok(delayed);
  await assert.rejects(delayed());
  await assert.rejects(internal.sealFile(input), code("ADMISSION_REMOVED"));
  assert.deepEqual(await internal.getFileSeal(input), { status: "removed" });
});

test("removal fences a seal paused immediately before publication", async () => {
  const input = await request();
  const arrived = gate();
  const resume = gate();
  await withFault(
    async (command, next) => {
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === input.destinationKey &&
        command.input.IfNoneMatch &&
        String(command.input.Body).includes('"status":"sealed"')
      ) {
        arrived.resolve();
        await resume.promise;
      }
      return next();
    },
    async () => {
      const sealing = internal.sealFile(input);
      await arrived.promise;
      await internal.removeSealedFile(input);
      resume.resolve();
      await assert.rejects(sealing, code("ADMISSION_REMOVED"));
    },
  );
});

test("removal survives restart, hides logical reads, and preserves issued URL expiry semantics", async () => {
  const input = await request();
  await internal.sealFile(input);
  const issued = await internal.createReadUrl(input.destinationKey);
  await Promise.all([
    internal.removeSealedFile(input),
    internal.removeSealedFile(input),
  ]);
  destroy();
  await construct(config);
  assert.equal(await internal.fileExists(input.destinationKey), false);
  await assert.rejects(
    internal.getFileMetadata(input.destinationKey),
    FileNotFoundError,
  );
  await assert.rejects(
    internal.createReadUrl(input.destinationKey),
    FileNotFoundError,
  );
  await assert.rejects(internal.sealFile(input), code("ADMISSION_REMOVED"));
  assert.equal((await fetch(issued.url)).status, 200);
  assert.ok(issued.expiresAt);
});

test("legacy mutations and backing reads cannot bypass the protocol", async () => {
  const input = await request();
  await internal.sealFile(input);
  for (const key of [input.destinationKey, `${BackingPrefix}payload`]) {
    await assert.rejects(internal.deleteFile(key), code("INVALID_REQUEST"));
    await assert.rejects(
      internal.moveFile(input.source.resourceKey, key),
      code("INVALID_REQUEST"),
    );
    await assert.rejects(
      internal.moveFile(key, "ordinary"),
      code("INVALID_REQUEST"),
    );
    await assert.rejects(
      internal.createUploadUrl({
        filename: "x",
        size: 1,
        mimetype: "text/plain",
        path: key,
      }),
      code("INVALID_REQUEST"),
    );
  }
  await assert.rejects(
    internal.createReadUrl(`${BackingPrefix}payload`),
    code("INVALID_REQUEST"),
  );
});

test("source store mismatch and null versions are rejected", async () => {
  const input = await request();
  await assert.rejects(
    internal.sealFile({
      ...input,
      source: { ...input.source, storageId: "another-store" },
    }),
    code("STORAGE_MISMATCH"),
  );
  await assert.rejects(
    internal.sealFile({
      ...input,
      source: { ...input.source, generation: "null" },
    }),
    code("UNSUPPORTED"),
  );
});

test("oversized sources are rejected before publication", async () => {
  const input = await request();
  await upload(input.source.resourceKey, "x".repeat(MaximumSealBytes + 1));
  input.source = (
    await internal.getFileSnapshot(input.source.resourceKey)
  ).identity;
  await assert.rejects(internal.sealFile(input), code("UNSUPPORTED"));
  assert.deepEqual(await internal.getFileSeal(input), { status: "absent" });
});

test("the maximum supported source size seals successfully", async () => {
  const input = await request();
  await upload(input.source.resourceKey, "x".repeat(MaximumSealBytes));
  input.source = (
    await internal.getFileSnapshot(input.source.resourceKey)
  ).identity;
  const sealed = await internal.sealFile(input);
  assert.equal(sealed.metadata.size, MaximumSealBytes);
  assert.equal(
    (await readBytes(input.destinationKey)).length,
    MaximumSealBytes,
  );
});

test("replaying one presigned PUT cannot change a captured generation", async () => {
  const body = "signed upload bytes";
  const upload = await internal.createUploadUrl({
    filename: "signed.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(body),
    staging: true,
  });
  const put = () =>
    fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body });
  assert.equal((await put()).status, 200);
  const captured = await internal.getFileSnapshot(upload.resourceKey);
  assert.equal((await put()).status, 200);
  const replay = await internal.getFileSnapshot(upload.resourceKey);
  assert.notEqual(captured.identity.generation, replay.identity.generation);
  const input: SealFileRequest = {
    source: captured.identity,
    admissionId: randomUUID(),
    destinationKey: `${SEALED_PREFIX}${randomUUID()}`,
  };
  await internal.sealFile(input);
  assert.equal(await readBytes(input.destinationKey), body);
});

test("lost removal acknowledgement reconciles a permanent tombstone", async () => {
  const input = await request();
  await internal.sealFile(input);
  await withFault(
    async (command, next) => {
      const result = await next();
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === input.destinationKey
      )
        throw new Error("lost removal ack");
      return result;
    },
    async () => {
      assert.deepEqual(await internal.removeSealedFile(input), {
        status: "removed",
      });
    },
  );
  assert.deepEqual(await internal.getFileSeal(input), { status: "removed" });
});

test("conditional removal cannot overwrite a replacement installed after its read", async () => {
  const input = await request();
  const replacement = await request();
  await internal.sealFile(input);
  await internal.sealFile(replacement);
  const competing = (await readSlot(replacement.destinationKey))!.slot;
  competing.file!.identity.resourceKey = input.destinationKey;
  competing.file!.metadata.resourceKey = input.destinationKey;
  await withFault(
    async (command, next) => {
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === input.destinationKey &&
        command.input.IfMatch
      ) {
        await getS3Client().send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: input.destinationKey,
            Body: JSON.stringify(competing),
          }),
        );
      }
      return next();
    },
    async () => {
      await assert.rejects(
        internal.removeSealedFile(input),
        code("DESTINATION_CONFLICT"),
      );
    },
  );
  assert.deepEqual((await readSlot(input.destinationKey))!.slot, competing);
});

test("cancel-before-seal survives restart and rejects all changed-tuple operations", async () => {
  const input = await request();
  await internal.removeSealedFile(input);
  destroy();
  await construct(config);
  assert.deepEqual(await internal.getFileSeal(input), { status: "removed" });
  await assert.rejects(internal.sealFile(input), code("ADMISSION_REMOVED"));
  const changes = [
    { ...input, destinationKey: `${SEALED_PREFIX}${randomUUID()}` },
    { ...input, source: { ...input.source, generation: "other" } },
  ];
  for (const changed of changes) {
    for (const operation of [
      internal.sealFile,
      internal.getFileSeal,
      internal.removeSealedFile,
    ]) {
      await assert.rejects(operation(changed), code("DESTINATION_CONFLICT"));
    }
  }
});

test("unversioned sources and stores without explicit private opt-in are unsupported", async () => {
  const key = randomUUID();
  await getS3Client().send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: "Suspended" },
    }),
  );
  try {
    await upload(key);
    await assert.rejects(internal.getFileSnapshot(key), code("UNSUPPORTED"));
  } finally {
    await getS3Client().send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
  }
  const originalIdentity = config.default.sealStorageId;
  delete config.default.sealStorageId;
  await assert.rejects(internal.getFileSnapshot(key), code("UNSUPPORTED"));
  config.default.sealStorageId = originalIdentity!;
});
