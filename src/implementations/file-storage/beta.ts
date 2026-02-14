import {
  UploadRequest,
  UploadConstraints,
  PresignedUploadResponse,
  PresignedReadResponse,
  FileMetadata,
  UploadValidationError,
  FileNotFoundError,
} from '@ajs.local/file-storage/beta';
import { getS3Client, getStorageConfig } from '../../index';
import {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

const NotFoundStatusCode = 404;
const DefaultMimetype = 'application/octet-stream';
const PathTrimRegex = /^\/|\/$/g;
const MetadataHeaderPrefix = 'x-amz-meta-';

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
  return `${pathPrefix}${resourceId}${fileExtension}`;
}

function normalizePathPrefix(path?: string): string {
  if (!path) {
    return '';
  }
  const normalizedPath = path.replace(PathTrimRegex, '');
  if (!normalizedPath) {
    return '';
  }
  return `${normalizedPath}/`;
}

function validateUploadRequest(request: UploadRequest, constraints?: UploadConstraints): void {
  if (constraints?.maxSize !== undefined && request.size > constraints.maxSize) {
    throw new UploadValidationError(
      `File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`,
      'SIZE_EXCEEDED',
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
    `MIME type '${request.mimetype}' is not allowed. Allowed types: ${allowedMimetypes.join(', ')}`,
    'MIMETYPE_NOT_ALLOWED',
  );
}

function buildMetadata(request: UploadRequest): Record<string, string> {
  return {
    filename: request.filename,
    ...(request.metadata ?? {}),
  };
}

function buildMetadataHeaders(metadata: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [`${MetadataHeaderPrefix}${key}`, value]));
}

function buildUploadHeaders(request: UploadRequest, metadata: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': request.mimetype,
    'Content-Length': String(request.size),
    ...buildMetadataHeaders(metadata),
  };
}

function buildUnhoistableHeaders(metadata: Record<string, string>): Set<string> {
  return new Set(Object.keys(metadata).map((key) => `${MetadataHeaderPrefix}${key}`));
}

function shouldUsePublicUrl(storage?: string): boolean {
  const config = getStorageConfig(storage);
  return config.defaultVisibility === 'public' && Boolean(config.publicUrl);
}

function buildPublicReadUrl(resourceKey: string, storage?: string): string {
  const config = getStorageConfig(storage);
  const publicUrl = config.publicUrl ?? '';
  return `${publicUrl.replace(/\/$/, '')}/${resourceKey}`;
}

function isErrorLike(error: unknown): error is ErrorLike {
  if (typeof error !== 'object' || !error) {
    return false;
  }
  return 'name' in error || '$metadata' in error;
}

function isNotFoundError(error: unknown): boolean {
  if (!isErrorLike(error)) {
    return false;
  }
  return error.name === 'NotFound' || error.$metadata?.httpStatusCode === NotFoundStatusCode;
}

function mapHeadObjectToFileMetadata(response: HeadObjectCommandOutput, resourceKey: string): FileMetadata {
  const metadata = response.Metadata;
  const fileMetadata: FileMetadata = {
    filename: response.Metadata?.filename ?? '',
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

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: resourceKey,
      ContentType: request.mimetype,
      ContentLength: request.size,
      Metadata: metadata,
    });

    const expiresIn = config.defaultUploadExpiration;
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn,
      unhoistableHeaders: buildUnhoistableHeaders(metadata),
    });

    return {
      uploadUrl,
      resourceKey,
      expiresAt: Date.now() + expiresIn * 1000,
      headers: buildUploadHeaders(request, metadata),
    };
  };

  export const createReadUrl = async (
    resourceKey: string,
    expiresIn?: number,
    storage?: string,
  ): Promise<PresignedReadResponse> => {
    if (shouldUsePublicUrl(storage)) {
      return { url: buildPublicReadUrl(resourceKey, storage) };
    }

    const config = getStorageConfig(storage);
    const client = getS3Client(storage);
    const effectiveExpiresIn = expiresIn ?? config.defaultReadExpiration;
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: resourceKey,
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: effectiveExpiresIn,
    });

    return {
      url,
      expiresAt: Date.now() + effectiveExpiresIn * 1000,
    };
  };

  export const deleteFile = async (resourceKey: string, storage?: string): Promise<void> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);

    const command = new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: resourceKey,
    });

    await client.send(command);
  };

  export const fileExists = async (resourceKey: string, storage?: string): Promise<boolean> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);

    try {
      const command = new HeadObjectCommand({
        Bucket: config.bucket,
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

  export const getFileMetadata = async (resourceKey: string, storage?: string): Promise<FileMetadata> => {
    const client = getS3Client(storage);
    const config = getStorageConfig(storage);

    try {
      const command = new HeadObjectCommand({
        Bucket: config.bucket,
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
}
