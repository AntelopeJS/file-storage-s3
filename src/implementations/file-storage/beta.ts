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
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

/**
 * Generates a unique resource key for a file
 */
function generateResourceKey(request: UploadRequest): string {
  const ext = extname(request.filename) || '';
  const uuid = randomUUID();
  const prefix = request.path ? `${request.path.replace(/^\/|\/$/g, '')}/` : '';
  return `${prefix}${uuid}${ext}`;
}

/**
 * Validates the upload request against constraints
 */
function validateUploadRequest(request: UploadRequest, constraints?: UploadConstraints): void {
  if (constraints?.maxSize && request.size > constraints.maxSize) {
    throw new UploadValidationError(
      `File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`,
      'SIZE_EXCEEDED',
    );
  }

  if (constraints?.allowedMimetypes && constraints.allowedMimetypes.length > 0) {
    if (!constraints.allowedMimetypes.includes(request.mimetype)) {
      throw new UploadValidationError(
        `MIME type '${request.mimetype}' is not allowed. Allowed types: ${constraints.allowedMimetypes.join(', ')}`,
        'MIMETYPE_NOT_ALLOWED',
      );
    }
  }
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

    const metadata: Record<string, string> = {
      ...(request.metadata || {}),
    };

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: resourceKey,
      ContentType: request.mimetype,
      ContentLength: request.size,
      Metadata: metadata,
    });

    const unhoistableHeaders = new Set<string>();
    for (const key of Object.keys(metadata)) {
      unhoistableHeaders.add(`x-amz-meta-${key}`);
    }

    const expiresIn = config.defaultUploadExpiration;
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn,
      unhoistableHeaders,
    });

    const expiresAt = Date.now() + expiresIn * 1000;

    const headers: Record<string, string> = {
      'Content-Type': request.mimetype,
      'Content-Length': String(request.size),
    };
    for (const [key, value] of Object.entries(metadata)) {
      headers[`x-amz-meta-${key}`] = value;
    }

    return {
      uploadUrl,
      resourceKey,
      expiresAt,
      headers,
    };
  };

  export const createReadUrl = async (
    resourceKey: string,
    expiresIn?: number,
    storage?: string,
  ): Promise<PresignedReadResponse> => {
    const config = getStorageConfig(storage);

    // If public URL is configured and default visibility is public, return direct URL
    if (config.publicUrl && config.defaultVisibility === 'public') {
      const url = `${config.publicUrl.replace(/\/$/, '')}/${resourceKey}`;
      return { url };
    }

    // Generate presigned GET URL for private access
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
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
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

      return {
        filename: '',
        resourceKey,
        size: response.ContentLength ?? 0,
        mimetype: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified?.getTime() ?? Date.now(),
        metadata: response.Metadata,
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new FileNotFoundError(resourceKey);
      }
      throw error;
    }
  };
}
