import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before } from "node:test";
import {
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  FileSealError,
  SEALED_PREFIX,
  type SealFileRequest,
} from "@antelopejs/interface-file-storage";

import { internal } from "../implementations/file-storage/beta";
import { construct, destroy, getS3Client, type Config } from "../index";

const endpoint = process.env.S3_SEAL_TEST_ENDPOINT;
assert.ok(
  endpoint,
  "Set S3_SEAL_TEST_ENDPOINT to a disposable local S3 emulator",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname),
  "Integration writes must stay local",
);
export const bucket = `sealing-${randomUUID()}`;
export const config: Config = {
  default: {
    endpoint,
    bucket,
    region: "us-east-1",
    accessKeyId: "local-test",
    secretAccessKey: "local-test",
    defaultVisibility: "private",
    defaultUploadExpiration: 60,
    defaultReadExpiration: 60,
    sealStorageId: randomUUID(),
  },
};

type Fault = (
  command: unknown,
  next: () => Promise<unknown>,
) => Promise<unknown>;

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}

export function gate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

before(async () => {
  await construct(config);
  await getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
  await getS3Client().send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
});
after(() => destroy());

export async function upload(
  key: string,
  body = "original bytes",
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "text/plain",
      Metadata: { filename: "original.txt", admissionid: "untrusted-upload" },
    }),
  );
}

export async function request(): Promise<SealFileRequest> {
  const key = `__staging__/${randomUUID()}`;
  await upload(key);
  return {
    source: (await internal.getFileSnapshot(key)).identity,
    destinationKey: `${SEALED_PREFIX}${randomUUID()}`,
    admissionId: randomUUID(),
  };
}

export function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof FileSealError && error.code === expected;
}

export async function withFault(
  fault: Fault,
  run: () => Promise<void>,
): Promise<void> {
  const client = getS3Client();
  const original = client.send.bind(client);
  client.send = ((command: never) =>
    fault(command, () => original(command))) as typeof client.send;
  try {
    await run();
  } finally {
    client.send = original;
  }
}

export async function readBytes(key: string): Promise<string> {
  const result = await internal.createReadUrl(key);
  const response = await fetch(result.url);
  assert.equal(response.status, 200);
  return response.text();
}
