import { Readable } from "node:stream";
import assert from "node:assert/strict";
import {
  CreateReadUrl,
  CreateUploadUrl,
  FileExists,
  GetFileMetadata,
  MoveFile,
  PromoteFile,
  STAGING_PREFIX,
} from "@antelopejs/interface-file-storage";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  type LifecycleRule,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  type PutBucketLifecycleConfigurationCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";

import { PublicBucket, PublicUrl } from "./moto";
import { applyStagingLifecycleRule } from "../lifecycle";

const ExistingResourceKey = "folder/existing.txt";
const MetadataOnlyResourceKey = "folder/metadata-only.txt";
const StagedResourceKey = `${STAGING_PREFIX}uploads/staged.txt`;
const PromotedResourceKey = "uploads/staged.txt";
const UploadPath = "/uploads/";
const PublicStorage = "public-assets";
const DefaultBucket = PublicBucket;
const PreconditionFailedStatus = 412;

interface StoredFile {
  size: number;
  mimetype: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

interface NotFoundErrorShape extends Error {
  $metadata: NotFoundMetadata;
}

type S3SendMethod = S3Client["send"];
type SendCommand =
  | DeleteObjectCommand
  | HeadObjectCommand
  | CopyObjectCommand
  | GetObjectCommand
  | PutObjectCommand;

interface SourceResponse extends HeadObjectCommandOutput {
  Body: Readable;
}

interface NotFoundMetadata {
  httpStatusCode: number;
}

const originalSend = S3Client.prototype.send;
const storageByResourceKey: Map<string, StoredFile> = new Map();

describe("S3 commands and URL mapping", () => {
  before(() => {
    S3Client.prototype.send = createMockSendMethod();
  });

  after(() => {
    S3Client.prototype.send = originalSend;
  });

  beforeEach(() => {
    resetStorage();
  });

  it("creates an upload URL with signed headers and normalized resource key", async () => {
    const response = await CreateUploadUrl({
      filename: "avatar.png",
      size: 128,
      mimetype: "image/png",
      path: UploadPath,
      metadata: { source: "profile" },
    });

    assert.ok(response.uploadUrl.includes("X-Amz-Signature="));
    assert.ok(response.resourceKey.startsWith("uploads/"));
    assert.ok(response.resourceKey.endsWith(".png"));
    assert.equal(response.headers["Content-Type"], "image/png");
    assert.equal(response.headers["Content-Length"], "128");
    assert.equal(response.headers["x-amz-meta-filename"], "avatar.png");
    assert.equal(response.headers["x-amz-meta-source"], "profile");
    assert.ok(response.expiresAt > Date.now());
  });

  it("returns public read URL when storage visibility is public", async () => {
    const response = await CreateReadUrl(
      "assets/logo.svg",
      undefined,
      PublicStorage,
    );
    assert.equal(response.url, `${PublicUrl}/assets/logo.svg`);
    assert.equal(response.expiresAt, undefined);
  });

  it("returns presigned read URL and expiration for private storage", async () => {
    const response = await CreateReadUrl(ExistingResourceKey, 120);
    assert.ok(response.url.includes("X-Amz-Signature="));
    assert.ok(response.expiresAt !== undefined);
    assert.ok((response.expiresAt ?? 0) > Date.now());
  });

  it("defaults metadata filename to empty string when filename metadata is not set", async () => {
    const metadata = await GetFileMetadata(MetadataOnlyResourceKey);
    assert.equal(metadata.filename, "");
    assert.deepEqual(metadata.metadata, { source: "imported" });
  });

  it("places staged uploads under the staging prefix preserving the path", async () => {
    const response = await CreateUploadUrl({
      filename: "draft.png",
      size: 64,
      mimetype: "image/png",
      path: UploadPath,
      staging: true,
    });

    assert.ok(response.resourceKey.startsWith(`${STAGING_PREFIX}uploads/`));
    assert.ok(response.resourceKey.endsWith(".png"));
  });

  it("keeps non-staged uploads out of the staging prefix", async () => {
    const response = await CreateUploadUrl({
      filename: "final.png",
      size: 64,
      mimetype: "image/png",
      path: UploadPath,
    });

    assert.equal(response.resourceKey.startsWith(STAGING_PREFIX), false);
  });

  it("routes explicit visibility with canonical staged keys", async () => {
    const privateUpload = await CreateUploadUrl({
      filename: "draft.txt",
      size: 5,
      mimetype: "text/plain",
      visibility: "private",
      metadata: { visibility: "public", source: "cms" },
      staging: true,
    });
    const publicUpload = await CreateUploadUrl({
      filename: "draft.txt",
      size: 5,
      mimetype: "text/plain",
      visibility: "public",
      staging: true,
    });

    assert.ok(
      privateUpload.resourceKey.startsWith(
        `${STAGING_PREFIX}__visibility__/private/`,
      ),
    );
    assert.ok(privateUpload.uploadUrl.includes("visibility-private-bucket"));
    assert.equal(privateUpload.headers["x-amz-meta-visibility"], "public");
    assert.ok((await CreateReadUrl(privateUpload.resourceKey, 30)).expiresAt);
    assert.ok(publicUpload.uploadUrl.includes(DefaultBucket));
    const publicRead = await CreateReadUrl(publicUpload.resourceKey, 30);
    assert.equal(publicRead.expiresAt, undefined);
    assert.equal(publicRead.url, `${PublicUrl}/${publicUpload.resourceKey}`);
  });

  it("publishes promotion through a conditional streaming S3 PUT", async () => {
    seedStagedFile();

    const result = await PromoteFile(StagedResourceKey);

    assert.equal(result.resourceKey, PromotedResourceKey);
    assert.equal(await FileExists(PromotedResourceKey), true);
    assert.equal(await FileExists(StagedResourceKey), false);
  });

  it("moves an object to a new key with MoveFile", async () => {
    seedStagedFile();

    await MoveFile(StagedResourceKey, PromotedResourceKey);

    assert.equal(await FileExists(PromotedResourceKey), true);
    assert.equal(await FileExists(StagedResourceKey), false);
  });
});

function createMockSendMethod(): S3SendMethod {
  return ((command: unknown) => {
    try {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve(handleHeadObjectCommand(command));
      }
      if (command instanceof GetObjectCommand) {
        return Promise.resolve(handleGetObjectCommand(command));
      }
      if (command instanceof PutObjectCommand) {
        return handlePutObjectCommand(command);
      }
      if (command instanceof GetPublicAccessBlockCommand) {
        return Promise.resolve({
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        });
      }
      if (command instanceof DeleteObjectCommand) {
        return Promise.resolve(handleDeleteObjectCommand(command));
      }
      if (command instanceof CopyObjectCommand) {
        return Promise.resolve(handleCopyObjectCommand(command));
      }
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return Promise.reject(
      new Error(`Unexpected S3 command: ${String(command)}`),
    );
  }) as S3SendMethod;
}

function parseCopySource(copySource: string): string {
  const keyPart = copySource.slice(copySource.indexOf("/") + 1);
  return keyPart.split("/").map(decodeURIComponent).join("/");
}

function handleGetObjectCommand(command: GetObjectCommand): SourceResponse {
  const head = handleHeadObjectCommand(new HeadObjectCommand(command.input));
  return { ...head, Body: Readable.from([Buffer.alloc(head.ContentLength!)]) };
}

async function handlePutObjectCommand(
  command: PutObjectCommand,
): Promise<Record<string, never>> {
  const key = getCommandResourceKey(command);
  assert.equal(command.input.IfNoneMatch, "*");
  assert.ok(command.input.Body instanceof Readable);
  let size = 0;
  for await (const chunk of command.input.Body)
    size += Buffer.byteLength(chunk);
  assert.equal(size, command.input.ContentLength);
  if (storageByResourceKey.has(key)) {
    throw Object.assign(new Error("Precondition failed"), {
      $metadata: { httpStatusCode: PreconditionFailedStatus },
    });
  }
  storageByResourceKey.set(key, {
    size,
    mimetype: command.input.ContentType!,
    lastModified: new Date(),
    metadata: command.input.Metadata ?? {},
  });
  return {};
}

function handleCopyObjectCommand(
  command: CopyObjectCommand,
): Record<string, never> {
  const destKey = getCommandResourceKey(command);
  const copySource = command.input.CopySource;
  if (!copySource) {
    throw new Error("Missing CopySource in S3 copy command input");
  }
  const sourceKey = parseCopySource(copySource);
  const storedFile = storageByResourceKey.get(sourceKey);
  if (!storedFile) {
    throw createNotFoundError();
  }
  storageByResourceKey.set(destKey, storedFile);
  return {};
}

function handleHeadObjectCommand(
  command: HeadObjectCommand,
): HeadObjectCommandOutput {
  const resourceKey = getCommandResourceKey(command);
  const storedFile = storageByResourceKey.get(resourceKey);
  if (!storedFile) {
    throw createNotFoundError();
  }
  const output: HeadObjectCommandOutput = {
    ETag: '"mock-etag"',
    ContentLength: storedFile.size,
    ContentType: storedFile.mimetype,
    LastModified: storedFile.lastModified,
    $metadata: {},
  };
  if (storedFile.metadata) {
    output.Metadata = storedFile.metadata;
  }
  return output;
}

function handleDeleteObjectCommand(
  command: DeleteObjectCommand,
): Record<string, never> {
  const resourceKey = getCommandResourceKey(command);
  storageByResourceKey.delete(resourceKey);
  return {};
}

function getCommandResourceKey(command: SendCommand): string {
  const resourceKey = command.input.Key;
  if (!resourceKey) {
    throw new Error("Missing resource key in S3 command input");
  }
  return resourceKey;
}

function createNotFoundError(): NotFoundErrorShape {
  const error = new Error("Not found") as NotFoundErrorShape;
  error.name = "NotFound";
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

function resetStorage(): void {
  storageByResourceKey.clear();
  storageByResourceKey.set(ExistingResourceKey, {
    size: 42,
    mimetype: "text/plain",
    lastModified: new Date("2026-01-01T00:00:00.000Z"),
    metadata: {
      filename: "existing.txt",
      source: "seed",
    },
  });
  storageByResourceKey.set(MetadataOnlyResourceKey, {
    size: 64,
    mimetype: "text/plain",
    lastModified: new Date("2026-01-02T00:00:00.000Z"),
    metadata: {
      source: "imported",
    },
  });
}

function seedStagedFile(): void {
  storageByResourceKey.set(StagedResourceKey, {
    size: 16,
    mimetype: "text/plain",
    lastModified: new Date("2026-01-03T00:00:00.000Z"),
    metadata: { filename: "staged.txt" },
  });
}

interface LifecycleCapture {
  input?: PutBucketLifecycleConfigurationCommandInput;
}

function createLifecycleMockClient(
  existingRules: LifecycleRule[],
  capture: LifecycleCapture,
): S3Client {
  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof GetBucketLifecycleConfigurationCommand) {
      return Promise.resolve({ Rules: existingRules });
    }
    if (command instanceof PutBucketLifecycleConfigurationCommand) {
      capture.input = command.input;
      return Promise.resolve({});
    }
    return Promise.reject(new Error("Unexpected lifecycle command"));
  };
  return { send } as unknown as S3Client;
}

describe("staging lifecycle rule", () => {
  it("targets only the staging prefix and preserves existing rules", async () => {
    const existingRule: LifecycleRule = {
      ID: "archive-cleanup",
      Status: "Enabled",
      Filter: { Prefix: "archive/" },
      Expiration: { Days: 30 },
    };
    const capture: LifecycleCapture = {};
    const client = createLifecycleMockClient([existingRule], capture);

    await applyStagingLifecycleRule(client, DefaultBucket, 2);

    const rules = capture.input?.LifecycleConfiguration?.Rules ?? [];
    const stagingRule = rules.find(
      (rule) => rule.Filter?.Prefix === STAGING_PREFIX,
    );
    assert.ok(rules.some((rule) => rule.ID === "archive-cleanup"));
    assert.ok(stagingRule);
    assert.equal(stagingRule?.Expiration?.Days, 2);
  });

  it("replaces a previous staging rule instead of duplicating it", async () => {
    const previousStagingRule: LifecycleRule = {
      ID: "antelopejs-staging-expiration",
      Status: "Enabled",
      Filter: { Prefix: STAGING_PREFIX },
      Expiration: { Days: 7 },
    };
    const capture: LifecycleCapture = {};
    const client = createLifecycleMockClient([previousStagingRule], capture);

    await applyStagingLifecycleRule(client, DefaultBucket, 1);

    const rules = capture.input?.LifecycleConfiguration?.Rules ?? [];
    const stagingRules = rules.filter(
      (rule) => rule.Filter?.Prefix === STAGING_PREFIX,
    );
    assert.equal(stagingRules.length, 1);
    assert.equal(stagingRules[0]?.Expiration?.Days, 1);
  });
});
