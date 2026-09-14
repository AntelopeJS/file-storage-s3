import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  type FileMetadata,
  FileNotFoundError,
  isStagedKey,
  type PresignedReadResponse,
  type PresignedUploadResponse,
  STAGING_PREFIX,
  toStagedKey,
  type UploadConstraints,
  type UploadRequest,
  UploadValidationError,
  type Visibility,
} from "@antelopejs/interface-file-storage";

import { getS3Client, getStorageConfig, type StorageConfig } from "../../index";

const NotFoundStatusCode = 404;
const DefaultMimetype = "application/octet-stream";
const PathTrimRegex = /^\/|\/$/g;
const MetadataHeaderPrefix = "x-amz-meta-";
const VisibilityKeyPrefix = "__visibility__/";
const PrivateKeyPrefix = `${VisibilityKeyPrefix}private/`;
const PublicKeyPrefix = `${VisibilityKeyPrefix}public/`;
const MillisecondsPerSecond = 1000;
const policyValidatedAt = new WeakMap<S3Client, Set<string>>();
const CreateOnlyCondition = "*";

interface ErrorMetadata {
  httpStatusCode?: number;
}

interface ErrorLike {
  name?: string;
  $metadata?: ErrorMetadata;
}

function generateResourceKey(request: UploadRequest): string {
  const fileExtension = extname(request.filename);
  const resourceId = randomUUID();
  const pathPrefix = normalizePathPrefix(request.path);
  const generatedKey = `${pathPrefix}${resourceId}${fileExtension}`;
  const baseKey = request.visibility
    ? `${VisibilityKeyPrefix}${request.visibility}/${generatedKey}`
    : generatedKey;
  return request.staging ? toStagedKey(baseKey) : baseKey;
}

function keyWithoutStaging(resourceKey: string): string {
  return isStagedKey(resourceKey)
    ? resourceKey.slice(STAGING_PREFIX.length)
    : resourceKey;
}

function visibilityForKey(
  resourceKey: string,
  config: StorageConfig,
): Visibility {
  const key = keyWithoutStaging(resourceKey);
  if (key.startsWith(PrivateKeyPrefix)) return "private";
  if (key.startsWith(PublicKeyPrefix)) return "public";
  return config.defaultVisibility;
}

async function assertPrivateBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  const validated = policyValidatedAt.get(client) ?? new Set<string>();
  policyValidatedAt.set(client, validated);
  if (validated.has(bucket)) return;
  const response = await client.send(
    new GetPublicAccessBlockCommand({ Bucket: bucket }),
  );
  const block = response.PublicAccessBlockConfiguration;
  if (
    !block?.BlockPublicAcls ||
    !block.IgnorePublicAcls ||
    !block.BlockPublicPolicy ||
    !block.RestrictPublicBuckets
  )
    throw new Error(`Bucket '${bucket}' must block all public access`);
  validated.add(bucket);
}

async function bucketForKey(
  resourceKey: string,
  config: StorageConfig,
  client: S3Client,
): Promise<string> {
  if (visibilityForKey(resourceKey, config) !== "private") return config.bucket;
  if (!keyWithoutStaging(resourceKey).startsWith(PrivateKeyPrefix))
    return config.bucket;
  if (!config.attachmentPrivateBucket)
    throw new Error(
      "attachmentPrivateBucket is required for private overrides",
    );
  await assertPrivateBucket(client, config.attachmentPrivateBucket);
  return config.attachmentPrivateBucket;
}

function normalizePathPrefix(path?: string): string {
  if (!path) {
    return "";
  }
  const normalizedPath = path.replace(PathTrimRegex, "");
  if (!normalizedPath) {
    return "";
  }
  return `${normalizedPath}/`;
}

function validateUploadRequest(
  request: UploadRequest,
  constraints?: UploadConstraints,
): void {
  const maxSize = constraints?.maxSize;
  if (maxSize !== undefined && request.size > maxSize) {
    throw new UploadValidationError(
      `File size ${request.size} exceeds maximum allowed size ${maxSize}`,
      "SIZE_EXCEEDED",
    );
  }

  const allowedMimetypes = constraints?.allowedMimetypes;
  if (!allowedMimetypes || allowedMimetypes.length === 0) {
    return;
  }
  if (allowedMimetypes.includes(request.mimetype)) {
    return;
  }
  throw new UploadValidationError(
    `MIME type '${request.mimetype}' is not allowed. Allowed types: ${allowedMimetypes.join(", ")}`,
    "MIMETYPE_NOT_ALLOWED",
  );
}

function buildMetadata(request: UploadRequest): Record<string, string> {
  return {
    filename: request.filename,
    ...request.metadata,
  };
}

function buildMetadataHeaders(
  metadata: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      `${MetadataHeaderPrefix}${key}`,
      value,
    ]),
  );
}

function buildUploadHeaders(
  request: UploadRequest,
  metadata: Record<string, string>,
): Record<string, string> {
  return {
    "Content-Type": request.mimetype,
    "Content-Length": String(request.size),
    "If-None-Match": CreateOnlyCondition,
    ...buildMetadataHeaders(metadata),
  };
}

function buildUnhoistableHeaders(
  metadata: Record<string, string>,
): Set<string> {
  return new Set(
    Object.keys(metadata).map((key) => `${MetadataHeaderPrefix}${key}`),
  );
}

function shouldUsePublicKey(
  resourceKey: string,
  config: StorageConfig,
): boolean {
  return (
    visibilityForKey(resourceKey, config) === "public" &&
    Boolean(config.publicUrl)
  );
}

function buildPublicReadUrl(
  resourceKey: string,
  config: StorageConfig,
): string {
  const publicUrl = config.publicUrl as string;
  return `${publicUrl.replace(/\/$/, "")}/${resourceKey}`;
}

function isErrorLike(error: unknown): error is ErrorLike {
  if (typeof error !== "object" || !error) {
    return false;
  }
  const candidate = error as { name?: unknown; $metadata?: unknown };
  const hasName = typeof candidate.name === "string";
  const hasMetadata =
    typeof candidate.$metadata === "object" && candidate.$metadata !== null;
  return hasName || hasMetadata;
}

function isNotFoundError(error: unknown): boolean {
  if (!isErrorLike(error)) {
    return false;
  }
  return (
    error.name === "NotFound" ||
    error.$metadata?.httpStatusCode === NotFoundStatusCode
  );
}

function mapHeadObjectToFileMetadata(
  response: HeadObjectCommandOutput,
  resourceKey: string,
): FileMetadata {
  const metadata = response.Metadata;
  const fileMetadata: FileMetadata = {
    filename: metadata?.filename ?? "",
    resourceKey,
    size: response.ContentLength ?? 0,
    mimetype: response.ContentType ?? DefaultMimetype,
    lastModified: response.LastModified?.getTime() ?? Date.now(),
  };
  if (metadata) {
    fileMetadata.metadata = metadata;
  }
  return fileMetadata;
}

const CopySourceSeparator = "/";

function buildCopySource(bucket: string, sourceKey: string): string {
  const encodedKey = sourceKey
    .split(CopySourceSeparator)
    .map(encodeURIComponent)
    .join(CopySourceSeparator);
  return `${bucket}/${encodedKey}`;
}

export namespace internal {
  export const createUploadUrl = async (
    request: UploadRequest,
    constraints?: UploadConstraints,
    storage?: string,
  ): Promise<PresignedUploadResponse> => {
    validateUploadRequest(request, constraints);

    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const resourceKey = generateResourceKey(request);
    const metadata = buildMetadata(request);
    const bucket = await bucketForKey(resourceKey, config, client);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: resourceKey,
      ContentType: request.mimetype,
      ContentLength: request.size,
      Metadata: metadata,
      IfNoneMatch: CreateOnlyCondition,
    });

    const expiresIn = config.defaultUploadExpiration;
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn,
      unhoistableHeaders: buildUnhoistableHeaders(metadata),
    });

    return {
      uploadUrl,
      resourceKey,
      expiresAt: Date.now() + expiresIn * MillisecondsPerSecond,
      headers: buildUploadHeaders(request, metadata),
    };
  };

  export const createReadUrl = async (
    resourceKey: string,
    expiresIn?: number,
    storage?: string,
  ): Promise<PresignedReadResponse> => {
    const config = getStorageConfig(storage);
    if (shouldUsePublicKey(resourceKey, config)) {
      return { url: buildPublicReadUrl(resourceKey, config) };
    }

    const client = getS3Client(storage);
    const bucket = await bucketForKey(resourceKey, config, client);
    const effectiveExpiresIn = expiresIn ?? config.defaultReadExpiration;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: resourceKey,
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: effectiveExpiresIn,
    });

    return {
      url,
      expiresAt: Date.now() + effectiveExpiresIn * MillisecondsPerSecond,
    };
  };

  export const deleteFile = async (
    resourceKey: string,
    storage?: string,
  ): Promise<void> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await bucketForKey(resourceKey, config, client);

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: resourceKey,
    });

    await client.send(command);
  };

  export const fileExists = async (
    resourceKey: string,
    storage?: string,
  ): Promise<boolean> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await bucketForKey(resourceKey, config, client);

    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: resourceKey,
      });

      await client.send(command);
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  };

  export const getFileMetadata = async (
    resourceKey: string,
    storage?: string,
  ): Promise<FileMetadata> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await bucketForKey(resourceKey, config, client);

    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: resourceKey,
      });

      const response = await client.send(command);
      return mapHeadObjectToFileMetadata(response, resourceKey);
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new FileNotFoundError(resourceKey);
      }
      throw error;
    }
  };

  export const moveFile = async (
    sourceKey: string,
    destKey: string,
    storage?: string,
  ): Promise<void> => {
    if (sourceKey === destKey) {
      return;
    }
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const sourceBucket = await bucketForKey(sourceKey, config, client);
    const destinationBucket = await bucketForKey(destKey, config, client);
    if (sourceBucket !== destinationBucket)
      throw new Error("Cannot move a file across visibility boundaries");

    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: destinationBucket,
          Key: destKey,
          CopySource: buildCopySource(sourceBucket, sourceKey),
        }),
      );
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }

    await client.send(
      new DeleteObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
    );
  };
}
