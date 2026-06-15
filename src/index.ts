import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import type { Visibility } from "@antelopejs/interface-file-storage";
import { S3Client } from "@aws-sdk/client-s3";
import { applyStagingLifecycleRule } from "./lifecycle";

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl?: string;
  defaultVisibility: Visibility;
  defaultUploadExpiration: number;
  defaultReadExpiration: number;
  /**
   * When set, a bucket lifecycle rule expiring objects under the staging
   * prefix after this many days is applied at bootstrap. Omit to manage the
   * rule as external infrastructure instead.
   */
  stagingExpirationDays?: number;
}

export interface Config {
  default: StorageConfig;
  storages?: Record<string, StorageConfig>;
}

const DefaultStorageKey = "default";
let moduleConfig: Config | null = null;
const s3Clients: Map<string, S3Client> = new Map();

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

function ensureModuleConfig(): Config {
  if (!moduleConfig) {
    throw new Error("Module config is not initialized");
  }
  return moduleConfig;
}

function getNamedStorageConfig(config: Config, storage: string): StorageConfig {
  const namedStorage = config.storages?.[storage];
  if (namedStorage === undefined) {
    throw new Error(`Storage '${storage}' not found in configuration`);
  }
  return namedStorage;
}

export function getStorageConfig(storage?: string): StorageConfig {
  const config = ensureModuleConfig();
  if (!storage) {
    return config.default;
  }
  return getNamedStorageConfig(config, storage);
}

export function getS3Client(storage?: string): S3Client {
  const storageKey = storage ?? DefaultStorageKey;
  const existingClient = s3Clients.get(storageKey);
  if (existingClient) {
    return existingClient;
  }
  const config = getStorageConfig(storage);
  const client = createS3Client(config);
  s3Clients.set(storageKey, client);
  return client;
}

function destroyS3Clients(): void {
  for (const client of s3Clients.values()) {
    client.destroy();
  }
  s3Clients.clear();
}

interface StorageEntry {
  storage?: string;
  config: StorageConfig;
}

const StagingLifecycleErrorPrefix =
  "[file-storage-s3] Failed to apply staging lifecycle rule for bucket";

function collectStorageEntries(config: Config): StorageEntry[] {
  const entries: StorageEntry[] = [{ config: config.default }];
  for (const [storage, storageConfig] of Object.entries(
    config.storages ?? {},
  )) {
    entries.push({ storage, config: storageConfig });
  }
  return entries;
}

async function setupStagingLifecycleForEntry(
  entry: StorageEntry,
): Promise<void> {
  const expirationDays = entry.config.stagingExpirationDays;
  if (expirationDays === undefined || expirationDays <= 0) {
    return;
  }
  try {
    await applyStagingLifecycleRule(
      getS3Client(entry.storage),
      entry.config.bucket,
      expirationDays,
    );
  } catch (error: unknown) {
    Logging.Warn(StagingLifecycleErrorPrefix, entry.config.bucket, error);
  }
}

async function setupStagingLifecycles(config: Config): Promise<void> {
  await Promise.all(
    collectStorageEntries(config).map((entry) =>
      setupStagingLifecycleForEntry(entry),
    ),
  );
}

export async function construct(config: Config): Promise<void> {
  moduleConfig = config;
  await setupStagingLifecycles(config);
  const [fileStorageInterface, fileStorageImplementation] = await Promise.all([
    import("@antelopejs/interface-file-storage"),
    import("./implementations/file-storage"),
  ]);
  void ImplementInterface(fileStorageInterface, fileStorageImplementation);
}

export function start(): void {}

export function stop(): void {}

export function destroy(): void {
  destroyS3Clients();
  moduleConfig = null;
}
