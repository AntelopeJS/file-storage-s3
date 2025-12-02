import { UploadRequest, UploadConstraints, PresignedUploadResponse, PresignedReadResponse, FileMetadata } from '@ajs.local/file-storage/beta';
export declare namespace internal {
    const createUploadUrl: (request: UploadRequest, constraints?: UploadConstraints, storage?: string) => Promise<PresignedUploadResponse>;
    const createReadUrl: (resourceKey: string, expiresIn?: number, storage?: string) => Promise<PresignedReadResponse>;
    const deleteFile: (resourceKey: string, storage?: string) => Promise<void>;
    const fileExists: (resourceKey: string, storage?: string) => Promise<boolean>;
    const getFileMetadata: (resourceKey: string, storage?: string) => Promise<FileMetadata>;
}
