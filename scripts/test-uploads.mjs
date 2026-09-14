import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import {
  CreateUploadUrl,
  CreateReadUrl,
  FileExists,
  DeleteFile,
} from "@antelopejs/interface-file-storage";

import { construct, destroy, getS3Client } from "../dist/index.js";

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
const config = {
  default: {
    endpoint,
    region: "us-east-1",
    bucket: publicBucket,
    accessKeyId: "local-test",
    secretAccessKey: "local-test",
    defaultVisibility: "public",
    publicUrl: "https://cdn.example.invalid",
    defaultUploadExpiration: ExpirationSeconds,
    defaultReadExpiration: ExpirationSeconds,
  },
};
config.storages = {
  [PrivateStorage]: {
    endpoint,
    region: "us-east-1",
    bucket: privateBucket,
    accessKeyId: "local-test",
    secretAccessKey: "local-test",
    defaultVisibility: "private",
    defaultUploadExpiration: ExpirationSeconds,
    defaultReadExpiration: ExpirationSeconds,
  },
};

before(async () => {
  await construct(config);
  for (const Bucket of [publicBucket, privateBucket]) {
    await getS3Client().send(new CreateBucketCommand({ Bucket }));
  }
});
after(() => destroy());

function issue(staging = true) {
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

function put(upload, body) {
  return fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body,
  });
}

async function read(key) {
  const response = await CreateReadUrl(key, undefined, PrivateStorage);
  const content = await fetch(response.url);
  assert.equal(content.status, SuccessStatus);
  return content.text();
}

test("first PUT wins and same or different bytes cannot replace it", async () => {
  for (const staging of [false, true]) {
    const upload = await issue(staging);
    assert.equal((await put(upload, Original)).status, SuccessStatus);
    assert.equal((await put(upload, Original)).status, ConflictStatus);
    assert.equal((await put(upload, Replacement)).status, ConflictStatus);
    assert.equal(await read(upload.resourceKey), Original);
    assert.equal(await FileExists(upload.resourceKey), false);
  }
});

test("concurrent writes return one winner whose bytes remain intact", async () => {
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

test("separate forms receive different keys in the selected private storage", async () => {
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

test("deleting a source permits recreation until its URL expires", async () => {
  const upload = await issue();
  assert.equal((await put(upload, Original)).status, SuccessStatus);
  await DeleteFile(upload.resourceKey, PrivateStorage);
  assert.equal((await put(upload, Replacement)).status, SuccessStatus);
  assert.equal(await read(upload.resourceKey), Replacement);
});
