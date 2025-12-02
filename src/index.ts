import { ImplementInterface } from '@ajs/core/beta';
import { S3Client } from '@aws-sdk/client-s3';
import { Visibility } from '@ajs.local/file-storage/beta';

/**
 * Configuration for a single storage (bucket)
 */
export interface StorageConfig {
  /** S3-compatible endpoint URL (e.g., https://<account>.r2.cloudflarestorage.com) */
  endpoint: string;
  /** AWS region or "auto" for Cloudflare R2 */
  region: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** Bucket name */
  bucket: string;
  /** Public URL for the bucket (for public file access) */
  publicUrl?: string;
  /** Default visibility for uploaded files */
  defaultVisibility: Visibility;
  /** Default expiration time for upload URLs in seconds (default: 3600 = 1 hour) */
  defaultUploadExpiration: number;
  /** Default expiration time for read URLs in seconds (default: 60 = 1 minute) */
  defaultReadExpiration: number;
}

/**
 * Module configuration
 */
export interface Config {
  /** Default storage configuration (used when no storage parameter is provided) */
  default: StorageConfig;
  /** Additional named storage configurations for multi-bucket setups */
  storages?: Record<string, StorageConfig>;
}

let moduleConfig: Config;
const s3Clients: Map<string, S3Client> = new Map();

/**
 * Creates an S3 client for a storage configuration
 */
function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * Gets the storage configuration by name
 * @param storage - Storage name (undefined for default)
 */
export function getStorageConfig(storage?: string): StorageConfig {
  if (!storage) {
    return moduleConfig.default;
  }

  const config = moduleConfig.storages?.[storage];
  if (!config) {
    throw new Error(`Storage '${storage}' not found in configuration`);
  }

  return config;
}

/**
 * Gets or creates an S3 client for the specified storage
 * @param storage - Storage name (undefined for default)
 */
export function getS3Client(storage?: string): S3Client {
  const key = storage ?? 'default';

  let client = s3Clients.get(key);
  if (!client) {
    const config = getStorageConfig(storage);
    client = createS3Client(config);
    s3Clients.set(key, client);
  }

  return client;
}

/**
 * Module lifecycle: construct
 * Called when the module is loaded with its configuration
 */
export async function construct(config: Config): Promise<void> {
  moduleConfig = config;

  // Register the interface implementation
  await ImplementInterface(import('@ajs.local/file-storage/beta'), import('./implementations/file-storage/beta'));
}

/**
 * Module lifecycle: start
 * Called when the module should start
 */
export function start(): void {}

/**
 * Module lifecycle: stop
 * Called when the module should stop
 */
export function stop(): void {}

/**
 * Module lifecycle: destroy
 * Called when the module is being unloaded
 */
export function destroy(): void {
  // Clean up S3 clients
  for (const client of s3Clients.values()) {
    client.destroy();
  }
  s3Clients.clear();
}
