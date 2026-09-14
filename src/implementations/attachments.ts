import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  FileNotFoundError,
  type FileMetadata,
  type PresignedReadResponse,
  type PresignedUploadResponse,
  type UploadConstraints,
  type UploadRequest,
  UploadValidationError,
} from "@antelopejs/interface-file-storage";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3";

import { getS3Client, getStorageConfig, type StorageConfig } from "../index";

const MaximumUploadExpiration = 86400;
const MaximumReadExpiration = 60;
const PolicyCacheDuration = 60000;
const TemporaryPrefix = "attachments/temporary/";
const PrivatePrefix = "attachments/private/";
const KeyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const policyValidatedAt = new Map<string, number>();

function privateBucket(config: StorageConfig): string {
  if (!config.attachmentPrivateBucket)
    throw new Error(
      "attachmentPrivateBucket is required for attachment storage",
    );
  return config.attachmentPrivateBucket;
}

function validateKey(key: string): void {
  if (!KeyPattern.test(key)) throw new Error("Invalid attachment resource key");
}

function validateUpload(
  request: UploadRequest,
  constraints?: UploadConstraints,
): void {
  if (constraints?.maxSize !== undefined && request.size > constraints.maxSize)
    throw new UploadValidationError(
      "File size exceeds maximum allowed size",
      "SIZE_EXCEEDED",
    );
  if (
    constraints?.allowedMimetypes?.length &&
    !constraints.allowedMimetypes.includes(request.mimetype)
  )
    throw new UploadValidationError(
      "MIME type is not allowed",
      "MIMETYPE_NOT_ALLOWED",
    );
}

async function assertPrivateBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  const lastValidation = policyValidatedAt.get(bucket) ?? 0;
  if (Date.now() - lastValidation < PolicyCacheDuration) return;
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
    throw new Error(
      `Bucket '${bucket}' must enable every public access block setting`,
    );
  policyValidatedAt.set(bucket, Date.now());
}

async function assertAttachmentBuckets(
  client: S3Client,
  config: StorageConfig,
): Promise<string> {
  const source = privateBucket(config);
  await Promise.all([
    assertPrivateBucket(client, source),
    assertPrivateBucket(client, config.bucket),
  ]);
  return source;
}

function metadata(request: UploadRequest): Record<string, string> {
  return { filename: request.filename, ...request.metadata };
}

async function immutableCopy(
  client: S3Client,
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string,
): Promise<void> {
  try {
    const source = await client.send(
      new GetObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
    );
    if (!source.Body) throw new Error("Attachment source has no body");
    const input: PutObjectCommandInput = {
      Bucket: destinationBucket,
      Key: destinationKey,
      Body: source.Body as NonNullable<PutObjectCommandInput["Body"]>,
      IfNoneMatch: "*",
    };
    if (source.ContentLength !== undefined)
      input.ContentLength = source.ContentLength;
    if (source.ContentType !== undefined)
      input.ContentType = source.ContentType;
    if (source.Metadata !== undefined) input.Metadata = source.Metadata;
    await client.send(new PutObjectCommand(input));
  } catch (error: unknown) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
}

function toMetadata(
  resourceKey: string,
  head: HeadObjectCommandOutput,
): FileMetadata {
  return {
    resourceKey,
    filename: head.Metadata?.filename ?? "",
    size: head.ContentLength ?? 0,
    mimetype: head.ContentType ?? "application/octet-stream",
    lastModified: head.LastModified?.getTime() ?? Date.now(),
    ...(head.Metadata ? { metadata: head.Metadata } : {}),
  };
}

export namespace internal {
  export async function createPrivateUploadUrl(
    request: UploadRequest,
    constraints?: UploadConstraints,
    storage?: string,
  ): Promise<PresignedUploadResponse> {
    validateUpload(request, constraints);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    const resourceKey = `${randomUUID()}${extname(request.filename)}`;
    const expiresIn = Math.min(
      config.defaultUploadExpiration,
      MaximumUploadExpiration,
    );
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: `${TemporaryPrefix}${resourceKey}`,
      ContentLength: request.size,
      ContentType: request.mimetype,
      Metadata: metadata(request),
      IfNoneMatch: "*",
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn });
    return {
      uploadUrl,
      resourceKey,
      expiresAt: Date.now() + expiresIn * 1000,
      headers: {
        "Content-Type": request.mimetype,
        "Content-Length": String(request.size),
        "If-None-Match": "*",
      },
    };
  }

  export async function prepareAttachment(
    sourceKey: string,
    destinationKey: string,
    storage?: string,
  ): Promise<void> {
    validateKey(sourceKey);
    validateKey(destinationKey);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    await immutableCopy(
      client,
      bucket,
      `${TemporaryPrefix}${sourceKey}`,
      bucket,
      `${PrivatePrefix}${destinationKey}`,
    );
  }

  export async function publishAttachment(
    resourceKey: string,
    storage?: string,
  ): Promise<PresignedReadResponse> {
    validateKey(resourceKey);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    if (!config.publicUrl)
      throw new Error("publicUrl is required to publish attachments");
    await immutableCopy(
      client,
      bucket,
      `${PrivatePrefix}${resourceKey}`,
      config.bucket,
      resourceKey,
    );
    return {
      url: `${config.publicUrl.replace(/\/$/, "")}/${encodeURIComponent(resourceKey)}`,
    };
  }

  export async function getPrivateFileMetadata(
    resourceKey: string,
    storage?: string,
  ): Promise<FileMetadata> {
    validateKey(resourceKey);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    try {
      return toMetadata(
        resourceKey,
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: `${PrivatePrefix}${resourceKey}`,
          }),
        ),
      );
    } catch {
      throw new FileNotFoundError(resourceKey);
    }
  }

  export async function createPrivateReadUrl(
    resourceKey: string,
    expiresIn: number,
    storage?: string,
  ): Promise<PresignedReadResponse> {
    validateKey(resourceKey);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    const effective = Math.min(expiresIn, MaximumReadExpiration);
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: `${PrivatePrefix}${resourceKey}`,
      }),
      { expiresIn: effective },
    );
    return { url, expiresAt: Date.now() + effective * 1000 };
  }

  export async function deleteAttachment(
    resourceKey: string,
    storage?: string,
  ): Promise<void> {
    validateKey(resourceKey);
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);
    const bucket = await assertAttachmentBuckets(client, config);
    await Promise.all(
      [
        `${TemporaryPrefix}${resourceKey}`,
        `${PrivatePrefix}${resourceKey}`,
      ].map((Key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key })),
      ),
    );
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: resourceKey }),
    );
  }
}
