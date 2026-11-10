import { Readable } from "node:stream";
import { sdkStreamMixin } from "@smithy/util-stream";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import {
  CreateBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  S3ServiceException,
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from "@aws-sdk/client-s3";
import {
  CreateUploadUrl,
  CreateReadUrl,
  FileExists,
  DeleteFile,
  PromoteFile,
  MoveFile,
  GetFileMetadata,
  FileConflictError,
  FileNotFoundError,
  stripStagingPrefix,
  type PresignedUploadResponse,
} from "@antelopejs/interface-file-storage";

import { construct, destroy, getS3Client, type Config } from "../index";

const endpoint = process.env.S3_UPLOAD_TEST_ENDPOINT;
assert.ok(
  endpoint,
  "Set S3_UPLOAD_TEST_ENDPOINT to a disposable local S3 emulator",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname),
  "Tests may only write local disposable storage",
);
const PrivateStorage = "private-uploads";
const SuccessStatus = 200;
const ConflictStatus = 412;
const Original = "abc";
const Replacement = "xyz";
const ExpirationSeconds = 60;
const publicBucket = `public-${randomUUID()}`;
const privateBucket = `private-${randomUUID()}`;
const config: Config = {
  default: {
    endpoint,
    region: "us-east-1",
    bucket: publicBucket,
    attachmentPrivateBucket: privateBucket,
    accessKeyId: "local-test",
    secretAccessKey: "local-test",
    defaultVisibility: "public",
    publicUrl: "https://cdn.example.invalid",
    defaultUploadExpiration: ExpirationSeconds,
    defaultReadExpiration: ExpirationSeconds,
  },
  storages: {
    [PrivateStorage]: {
      endpoint,
      region: "us-east-1",
      bucket: privateBucket,
      attachmentPrivateBucket: privateBucket,
      accessKeyId: "local-test",
      secretAccessKey: "local-test",
      defaultVisibility: "private",
      defaultUploadExpiration: ExpirationSeconds,
      defaultReadExpiration: ExpirationSeconds,
    },
  },
};

before(async () => {
  await construct(config);
  for (const Bucket of [publicBucket, privateBucket]) {
    await getS3Client().send(new CreateBucketCommand({ Bucket }));
  }
  await getS3Client().send(
    new PutPublicAccessBlockCommand({
      Bucket: privateBucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
});
after(() => destroy());

function issue(staging = true): Promise<PresignedUploadResponse> {
  return CreateUploadUrl(
    {
      filename: "test.txt",
      mimetype: "text/plain",
      size: Buffer.byteLength(Original),
      staging,
    },
    undefined,
    PrivateStorage,
  );
}

function put(upload: PresignedUploadResponse, body: string): Promise<Response> {
  return fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body,
  });
}

async function read(key: string): Promise<string> {
  const response = await CreateReadUrl(key, undefined, PrivateStorage);
  const content = await fetch(response.url);
  assert.equal(content.status, SuccessStatus);
  return content.text();
}

void test("first PUT wins and same or different bytes cannot replace it", async () => {
  for (const staging of [false, true]) {
    const upload = await issue(staging);
    assert.equal((await put(upload, Original)).status, SuccessStatus);
    assert.equal((await put(upload, Original)).status, ConflictStatus);
    assert.equal((await put(upload, Replacement)).status, ConflictStatus);
    assert.equal(await read(upload.resourceKey), Original);
    assert.equal(await FileExists(upload.resourceKey), false);
  }
});

void test("concurrent writes return one winner whose bytes remain intact", async () => {
  const upload = await issue();
  const responses = await Promise.all([
    put(upload, Original),
    put(upload, Replacement),
  ]);
  assert.deepEqual(
    responses
      .map((response) => response.status)
      .sort((left, right) => left - right),
    [SuccessStatus, ConflictStatus],
  );
  const winner =
    responses[0]?.status === SuccessStatus ? Original : Replacement;
  assert.equal(await read(upload.resourceKey), winner);
  assert.equal(await FileExists(upload.resourceKey), false);
});

void test("separate forms receive different keys in the selected private storage", async () => {
  const first = await issue();
  const second = await issue();
  assert.notEqual(first.resourceKey, second.resourceKey);
  for (const upload of [first, second]) {
    const url = new URL(upload.uploadUrl);
    assert.ok(`${url.host}${url.pathname}`.includes(privateBucket));
    assert.equal((await put(upload, Original)).status, SuccessStatus);
    assert.equal(await FileExists(upload.resourceKey, PrivateStorage), true);
    assert.equal(await FileExists(upload.resourceKey), false);
  }
});

void test("deleting a source permits recreation until its URL expires", async () => {
  const upload = await issue();
  assert.equal((await put(upload, Original)).status, SuccessStatus);
  await DeleteFile(upload.resourceKey, PrivateStorage);
  assert.equal((await put(upload, Replacement)).status, SuccessStatus);
  assert.equal(await read(upload.resourceKey), Replacement);
});

void test("camelCase metadata uploads over HTTP and reads back with lowercase keys", async () => {
  const upload = await CreateUploadUrl(
    {
      filename: "context.tar",
      mimetype: "text/plain",
      size: Buffer.byteLength(Original),
      metadata: { tenantId: "tenant", buildId: "build" },
    },
    undefined,
    PrivateStorage,
  );
  assert.equal((await put(upload, Original)).status, SuccessStatus);
  const { metadata } = await GetFileMetadata(
    upload.resourceKey,
    PrivateStorage,
  );
  assert.ok(metadata);
  assert.equal(metadata.tenantid, "tenant");
  assert.equal(metadata.buildid, "build");
  assert.equal(metadata.tenantId, undefined);
});

async function stagedPrivateUpload(): Promise<PresignedUploadResponse> {
  const upload = await CreateUploadUrl({
    filename: "report.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(Original),
    staging: true,
    visibility: "private",
    metadata: { custom: "retained", visibility: "public" },
  });
  assert.equal((await put(upload, Original)).status, SuccessStatus);
  return upload;
}

type Fault = (
  command: { name: string; input: ServiceInputTypes },
  next: () => Promise<ServiceOutputTypes>,
) => Promise<ServiceOutputTypes>;

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}

async function withFault(
  fault: Fault,
  run: () => Promise<void>,
): Promise<void> {
  const stack = getS3Client().middlewareStack;
  const name = "uploadsHttpFault";
  stack.add(
    (next, context) => async (args) => {
      let response: unknown;
      const command = { name: context.commandName ?? "", input: args.input };
      const output = await fault(command, async () => {
        const result = await next(args);
        response = result.response;
        return result.output;
      });
      return { output, response };
    },
    { step: "initialize", priority: "high", name },
  );
  try {
    await run();
  } finally {
    stack.remove(name);
  }
}

void test("promotion streams to canonical private key preserving metadata and replays source gone", async () => {
  const upload = await stagedPrivateUpload();
  const expected = stripStagingPrefix(upload.resourceKey);
  await withFault(
    async (command, next) => {
      const { input } = command;
      if (command.name === "PutObjectCommand") {
        assert.ok("Body" in input && "IfNoneMatch" in input);
        assert.ok(input.Body instanceof Readable);
        assert.equal(input.ContentLength, Buffer.byteLength(Original));
        assert.equal(input.IfNoneMatch, "*");
        assert.equal(input.Bucket, privateBucket);
      }
      return next();
    },
    async () => {
      assert.deepEqual(await PromoteFile(upload.resourceKey), {
        resourceKey: expected,
      });
    },
  );
  assert.equal(await FileExists(upload.resourceKey), false);
  const metadata = await GetFileMetadata(expected);
  assert.equal(metadata.filename, "report.txt");
  assert.equal(metadata.mimetype, "text/plain");
  assert.ok(metadata.metadata);
  assert.equal(metadata.metadata.custom, "retained");
  assert.equal(await read(expected), Original);
  assert.ok((await CreateReadUrl(expected)).expiresAt);
  assert.deepEqual(await PromoteFile(upload.resourceKey), {
    resourceKey: expected,
  });
  assert.deepEqual(await PromoteFile(expected), { resourceKey: expected });
});

void test("foreign occupied final conflicts even with source gone and is never deleted", async () => {
  const upload = await stagedPrivateUpload();
  const key = stripStagingPrefix(upload.resourceKey);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: privateBucket,
      Key: key,
      Body: Replacement,
    }),
  );
  await assert.rejects(PromoteFile(upload.resourceKey), FileConflictError);
  assert.equal(await FileExists(upload.resourceKey), true);
  await DeleteFile(upload.resourceKey);
  await assert.rejects(PromoteFile(upload.resourceKey), FileConflictError);
  assert.equal(await read(key), Replacement);
});

void test("missing source and destination produce FileNotFoundError", async () => {
  const missing = `__staging__/__visibility__/private/${randomUUID()}`;
  await assert.rejects(PromoteFile(missing), FileNotFoundError);
});

void test("lost publication ack verifies provenance before source cleanup", async () => {
  const upload = await stagedPrivateUpload();
  const key = stripStagingPrefix(upload.resourceKey);
  await withFault(
    async (command, next) => {
      const result = await next();
      if (command.name === "PutObjectCommand")
        throw new Error("lost put acknowledgement");
      return result;
    },
    async () => {
      assert.deepEqual(await PromoteFile(upload.resourceKey), {
        resourceKey: key,
      });
    },
  );
  assert.equal(await FileExists(upload.resourceKey), false);
  assert.equal(await read(key), Original);
});

void test("concurrent promotion publishes once and both callers reconcile", async () => {
  const upload = await stagedPrivateUpload();
  const results = await Promise.all([
    PromoteFile(upload.resourceKey),
    PromoteFile(upload.resourceKey),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(await read(results[0].resourceKey), Original);
  assert.equal(await FileExists(upload.resourceKey), false);
});

void test("cleanup failure retry does not republish or overwrite the verified final", async () => {
  const upload = await stagedPrivateUpload();
  const failure = new Error("delete failed");
  let writes = 0;
  await withFault(
    async (command, next) => {
      if (command.name === "PutObjectCommand") writes++;
      if (command.name === "DeleteObjectCommand") throw failure;
      return next();
    },
    async () => {
      await assert.rejects(
        PromoteFile(upload.resourceKey),
        (error) => error === failure,
      );
    },
  );
  assert.equal(await FileExists(upload.resourceKey), true);
  await withFault(
    async (command, next) => {
      if (command.name === "PutObjectCommand") writes++;
      return next();
    },
    async () => {
      await PromoteFile(upload.resourceKey);
    },
  );
  assert.equal(writes, 1);
  assert.equal(await FileExists(upload.resourceKey), false);
});

void test("unknown unpublished outcome preserves source and propagates original error", async () => {
  const upload = await stagedPrivateUpload();
  const failure = new Error("unknown PUT result");
  await withFault(
    async (command, next) => {
      if (command.name === "PutObjectCommand") throw failure;
      return next();
    },
    async () => {
      await assert.rejects(
        PromoteFile(upload.resourceKey),
        (error) => error === failure,
      );
    },
  );
  assert.equal(await FileExists(upload.resourceKey), true);
  assert.equal(await FileExists(stripStagingPrefix(upload.resourceKey)), false);
});

void test("interrupted source stream cannot publish a partial final or delete the source", async () => {
  const upload = await stagedPrivateUpload();
  await withFault(
    async (command, next) => {
      const result = await next();
      if (command.name === "GetObjectCommand") {
        assert.ok("Body" in result && result.Body instanceof Readable);
        result.Body.destroy();
        result.Body = sdkStreamMixin(
          Readable.from(
            (async function* () {
              yield Buffer.from("a");
              throw new Error("source interrupted");
            })(),
          ),
        );
      }
      return result;
    },
    async () => {
      await assert.rejects(PromoteFile(upload.resourceKey));
    },
  );
  assert.equal(await FileExists(upload.resourceKey), true);
  assert.equal(await FileExists(stripStagingPrefix(upload.resourceKey)), false);
});

void test("incomplete final metadata fails closed without cleaning up source", async () => {
  const upload = await stagedPrivateUpload();
  await withFault(
    async (command, next) => {
      if (command.name === "DeleteObjectCommand")
        throw new Error("retain source");
      return next();
    },
    async () => {
      await assert.rejects(PromoteFile(upload.resourceKey));
    },
  );
  await withFault(
    async (command, next) => {
      const result = await next();
      if (command.name === "HeadObjectCommand")
        Reflect.deleteProperty(result, "ContentLength");
      return result;
    },
    async () => {
      await assert.rejects(PromoteFile(upload.resourceKey), FileConflictError);
    },
  );
  assert.equal(await FileExists(upload.resourceKey), true);
  assert.equal(await read(stripStagingPrefix(upload.resourceKey)), Original);
});

void test("legacy MoveFile cannot transplant a trusted origin to another canonical destination", async () => {
  const first = await stagedPrivateUpload();
  const second = await stagedPrivateUpload();
  const promoted = await PromoteFile(first.resourceKey);
  const destination = stripStagingPrefix(second.resourceKey);
  await MoveFile(promoted.resourceKey, destination);
  await assert.rejects(PromoteFile(second.resourceKey), FileConflictError);
  assert.equal(await FileExists(second.resourceKey), true);
  assert.equal(await read(destination), Original);
});

void test("a late promotion stays private rather than implicitly publishing a cancelled upload", async () => {
  const upload = await stagedPrivateUpload();
  const gate = deferred();
  const paused = deferred();
  await withFault(
    async (command, next) => {
      if (command.name === "PutObjectCommand") {
        paused.resolve();
        await gate.promise;
      }
      return next();
    },
    async () => {
      const promotion = PromoteFile(upload.resourceKey);
      await paused.promise;
      await DeleteFile(upload.resourceKey);
      gate.resolve();
      const final = await promotion;
      assert.ok((await CreateReadUrl(final.resourceKey)).expiresAt);
      await assert.rejects(
        getS3Client().send(
          new HeadObjectCommand({
            Bucket: publicBucket,
            Key: final.resourceKey,
          }),
        ),
        (error) =>
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === 404,
      );
      assert.equal(await read(final.resourceKey), Original);
    },
  );
});
