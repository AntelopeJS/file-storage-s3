export type Visibility = 'public' | 'private';
export interface UploadRequest {
    filename: string;
    size: number;
    mimetype: string;
    path?: string;
    metadata?: Record<string, string>;
    visibility?: Visibility;
}
export interface UploadConstraints {
    maxSize?: number;
    allowedMimetypes?: string[];
}
export interface PresignedUploadResponse {
    uploadUrl: string;
    resourceKey: string;
    expiresAt: number;
    headers: Record<string, string>;
}
export interface PresignedReadResponse {
    url: string;
    expiresAt?: number;
}
export interface FileMetadata {
    resourceKey: string;
    size: number;
    mimetype: string;
    lastModified: number;
    metadata?: Record<string, string>;
}
export declare class UploadValidationError extends Error {
    readonly code: 'SIZE_EXCEEDED' | 'MIMETYPE_NOT_ALLOWED';
    constructor(message: string, code: 'SIZE_EXCEEDED' | 'MIMETYPE_NOT_ALLOWED');
}
export declare class FileNotFoundError extends Error {
    constructor(resourceKey: string);
}
export declare namespace internal {
    const createUploadUrl: (request: UploadRequest, constraints?: UploadConstraints | undefined, storage?: string | undefined) => Promise<PresignedUploadResponse>;
    const createReadUrl: (resourceKey: string, expiresIn?: number | undefined, storage?: string | undefined) => Promise<PresignedReadResponse>;
    const deleteFile: (resourceKey: string, storage?: string | undefined) => Promise<void>;
    const fileExists: (resourceKey: string, storage?: string | undefined) => Promise<boolean>;
    const getFileMetadata: (resourceKey: string, storage?: string | undefined) => Promise<FileMetadata>;
}
export declare function CreateUploadUrl(request: UploadRequest, constraints?: UploadConstraints, storage?: string): Promise<PresignedUploadResponse>;
export declare function CreateReadUrl(resourceKey: string, expiresIn?: number, storage?: string): Promise<PresignedReadResponse>;
export declare function DeleteFile(resourceKey: string, storage?: string): Promise<void>;
export declare function FileExists(resourceKey: string, storage?: string): Promise<boolean>;
export declare function GetFileMetadata(resourceKey: string, storage?: string): Promise<FileMetadata>;
