import { Readable } from "node:stream";
import assert from "node:assert/strict";
import {
  DeleteAttachment,
  GetPrivateFileMetadata,
  PrepareAttachment,
  PublishAttachment,
} from "@antelopejs/interface-file-storage/attachments";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getStorageConfig } from "../index";

const PrivateBucket = "attachment-private";
const PublicBucket = "private-bucket";
const SourceKey = "attachments/temporary/source.txt";
const SnapshotKey = "attachments/private/snapshot.txt";
const PublicKey = "attachments/public/snapshot.txt";

interface StoredObject {
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

interface ErrorStatus {
  $metadata: { httpStatusCode: number };
}

const objects = new Map<string, StoredObject>();
const commands: unknown[] = [];
const originalSend = S3Client.prototype.send;

describe("attachment S3 SDK contract", () => {
  before(() => {
    getStorageConfig().attachmentPrivateBucket = PrivateBucket;
    getStorageConfig().publicUrl = "https://cdn.example.com";
    S3Client.prototype.send = mockSend as S3Client["send"];
  });

  after(() => {
    S3Client.prototype.send = originalSend;
    delete getStorageConfig().attachmentPrivateBucket;
    delete getStorageConfig().publicUrl;
  });

  beforeEach(() => {
    objects.clear();
    commands.length = 0;
    objects.set(`${PrivateBucket}/${SourceKey}`, {
      body: Buffer.from("source"),
      contentType: "text/plain",
      metadata: { filename: "source.txt", owner: "test" },
    });
  });

  it("creates a conditional private snapshot with preserved metadata", async () => {
    await PrepareAttachment("source.txt", "snapshot.txt");
    const snapshot = objects.get(`${PrivateBucket}/${SnapshotKey}`);
    assert.equal(snapshot?.body.toString(), "source");
    assert.deepEqual(snapshot?.metadata, {
      filename: "source.txt",
      owner: "test",
    });
    const put = commands.find((command) => command instanceof PutObjectCommand);
    assert.equal((put as PutObjectCommand).input.IfNoneMatch, "*");
    assert.equal((put as PutObjectCommand).input.ContentLength, 6);
  });

  it("succeeds after the source vanished when the snapshot exists", async () => {
    objects.set(`${PrivateBucket}/${SnapshotKey}`, {
      body: Buffer.from("winner"),
    });
    objects.delete(`${PrivateBucket}/${SourceKey}`);
    await PrepareAttachment("source.txt", "snapshot.txt");
    assert.equal(
      objects.get(`${PrivateBucket}/${SnapshotKey}`)?.body.toString(),
      "winner",
    );
  });

  it("publishes and deletes only the reserved public namespace", async () => {
    objects.set(`${PrivateBucket}/${SnapshotKey}`, {
      body: Buffer.from("snapshot"),
    });
    const result = await PublishAttachment("snapshot.txt");
    assert.ok(result.url.endsWith(PublicKey));
    objects.set(`${PublicBucket}/snapshot.txt`, {
      body: Buffer.from("unrelated"),
    });
    await DeleteAttachment("snapshot.txt");
    assert.equal(objects.has(`${PublicBucket}/snapshot.txt`), true);
    assert.equal(objects.has(`${PublicBucket}/${PublicKey}`), false);
  });

  it("maps only 404 metadata failures to file not found", async () => {
    await assert.rejects(
      () => GetPrivateFileMetadata("missing.txt"),
      /not found/i,
    );
    objects.set(`${PrivateBucket}/${SnapshotKey}`, {
      body: Buffer.from("snapshot"),
    });
    const outage = statusError(503);
    failNextHead = outage;
    await assert.rejects(() => GetPrivateFileMetadata("snapshot.txt"), outage);
  });
});

let failNextHead: Error | undefined;

async function mockSend(command: unknown): Promise<unknown> {
  commands.push(command);
  if (command instanceof GetPublicAccessBlockCommand)
    return {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    };
  if (command instanceof HeadObjectCommand) return head(command);
  if (command instanceof GetObjectCommand) return get(command);
  if (command instanceof PutObjectCommand) return put(command);
  if (command instanceof DeleteObjectCommand) {
    objects.delete(identifier(command.input.Bucket, command.input.Key));
    return {};
  }
  throw new Error(`Unexpected command ${String(command)}`);
}

function head(command: HeadObjectCommand): object {
  if (failNextHead) {
    const error = failNextHead;
    failNextHead = undefined;
    throw error;
  }
  const stored = objects.get(
    identifier(command.input.Bucket, command.input.Key),
  );
  if (!stored) throw statusError(404);
  return {
    ContentLength: stored.body.length,
    ContentType: stored.contentType,
    Metadata: stored.metadata,
    LastModified: new Date(),
  };
}

function get(command: GetObjectCommand): object {
  const stored = objects.get(
    identifier(command.input.Bucket, command.input.Key),
  );
  if (!stored) throw statusError(404);
  return {
    Body: Readable.from(stored.body),
    ContentLength: stored.body.length,
    ContentType: stored.contentType,
    Metadata: stored.metadata,
  };
}

async function put(command: PutObjectCommand): Promise<object> {
  const key = identifier(command.input.Bucket, command.input.Key);
  if (objects.has(key) && command.input.IfNoneMatch === "*")
    throw statusError(412);
  const chunks: Buffer[] = [];
  for await (const chunk of command.input.Body as Readable)
    chunks.push(Buffer.from(chunk));
  const stored: StoredObject = { body: Buffer.concat(chunks) };
  if (command.input.ContentType) stored.contentType = command.input.ContentType;
  if (command.input.Metadata) stored.metadata = command.input.Metadata;
  objects.set(key, stored);
  return {};
}

function identifier(bucket?: string, key?: string): string {
  if (!bucket || !key) throw new Error("Missing bucket or key");
  return `${bucket}/${key}`;
}

function statusError(status: number): Error & ErrorStatus {
  return Object.assign(new Error(status === 404 ? "not found" : "outage"), {
    $metadata: { httpStatusCode: status },
  });
}
