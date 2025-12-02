import { S3Client } from '@aws-sdk/client-s3';
import { Visibility } from '@ajs.local/file-storage/beta';
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
}
export interface Config {
    default: StorageConfig;
    storages?: Record<string, StorageConfig>;
}
export declare function getStorageConfig(storage?: string): StorageConfig;
export declare function getS3Client(storage?: string): S3Client;
export declare function construct(config: Config): Promise<void>;
export declare function start(): void;
export declare function stop(): void;
export declare function destroy(): void;
