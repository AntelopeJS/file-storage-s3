import assert from "node:assert/strict";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  FileExists,
  FileNotFoundError,
  GetFileMetadata,
  MoveFile,
  PromoteFile,
  STAGING_PREFIX,
  UploadValidationError,
} from "@antelopejs/interface-file-storage";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  type LifecycleRule,
  PutBucketLifecycleConfigurationCommand,
  type PutBucketLifecycleConfigurationCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import { applyStagingLifecycleRule } from "../lifecycle";

const ExistingResourceKey = "folder/existing.txt";
const MissingResourceKey = "folder/missing.txt";
const MetadataOnlyResourceKey = "folder/metadata-only.txt";
const StagedResourceKey = "tmp/uploads/staged.txt";
const PromotedResourceKey = "uploads/staged.txt";
const UploadPath = "/uploads/";
const PublicStorage = "public-assets";
const DefaultBucket = "private-bucket";

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
type SendCommand = DeleteObjectCommand | HeadObjectCommand | CopyObjectCommand;

interface NotFoundMetadata {
  httpStatusCode: number;
}

const originalSend = S3Client.prototype.send;
const storageByResourceKey: Map<string, StoredFile> = new Map();

describe("file-storage interface", () => {
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

  it("validates upload max size constraints", async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: "oversized.txt",
            size: 20,
            mimetype: "text/plain",
          },
          { maxSize: 10 },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError &&
        error.code === "SIZE_EXCEEDED" &&
        error.message.includes("20"),
    );
  });

  it("validates upload mimetype constraints", async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: "document.pdf",
            size: 10,
            mimetype: "application/pdf",
          },
          { allowedMimetypes: ["image/png", "image/jpeg"] },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError &&
        error.code === "MIMETYPE_NOT_ALLOWED" &&
        error.message.includes("pdf"),
    );
  });

  it("returns public read URL when storage visibility is public", async () => {
    const response = await CreateReadUrl(
      "assets/logo.svg",
      undefined,
      PublicStorage,
    );
    assert.equal(response.url, "https://cdn.example.com/assets/logo.svg");
    assert.equal(response.expiresAt, undefined);
  });

  it("returns presigned read URL and expiration for private storage", async () => {
    const response = await CreateReadUrl(ExistingResourceKey, 120);
    assert.ok(response.url.includes("X-Amz-Signature="));
    assert.ok(response.expiresAt !== undefined);
    assert.ok((response.expiresAt ?? 0) > Date.now());
  });

  it("returns true when the file exists", async () => {
    const exists = await FileExists(ExistingResourceKey);
    assert.equal(exists, true);
  });

  it("returns false when the file does not exist", async () => {
    const exists = await FileExists(MissingResourceKey);
    assert.equal(exists, false);
  });

  it("returns metadata for existing files", async () => {
    const metadata = await GetFileMetadata(ExistingResourceKey);
    assert.equal(metadata.resourceKey, ExistingResourceKey);
    assert.equal(metadata.filename, "existing.txt");
    assert.equal(metadata.size, 42);
    assert.equal(metadata.mimetype, "text/plain");
    assert.ok(metadata.lastModified > 0);
    assert.deepEqual(metadata.metadata, {
      filename: "existing.txt",
      source: "seed",
    });
  });

  it("throws FileNotFoundError when metadata is requested for a missing file", async () => {
    await assert.rejects(
      () => GetFileMetadata(MissingResourceKey),
      (error: unknown) => error instanceof FileNotFoundError,
    );
  });

  it("deletes files from storage", async () => {
    const existsBeforeDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsBeforeDelete, true);
    await DeleteFile(ExistingResourceKey);
    const existsAfterDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsAfterDelete, false);
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

  it("promotes a staged file and returns the clean key", async () => {
    seedStagedFile();

    const result = await PromoteFile(StagedResourceKey);

    assert.equal(result.resourceKey, PromotedResourceKey);
    assert.equal(await FileExists(PromotedResourceKey), true);
    assert.equal(await FileExists(StagedResourceKey), false);
  });

  it("is a no-op when promoting a non-staged key", async () => {
    const result = await PromoteFile(ExistingResourceKey);

    assert.equal(result.resourceKey, ExistingResourceKey);
    assert.equal(await FileExists(ExistingResourceKey), true);
  });

  it("is safe to promote twice", async () => {
    seedStagedFile();

    const first = await PromoteFile(StagedResourceKey);
    const second = await PromoteFile(StagedResourceKey);
    const third = await PromoteFile(PromotedResourceKey);

    assert.equal(first.resourceKey, PromotedResourceKey);
    assert.equal(second.resourceKey, PromotedResourceKey);
    assert.equal(third.resourceKey, PromotedResourceKey);
    assert.equal(await FileExists(PromotedResourceKey), true);
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
