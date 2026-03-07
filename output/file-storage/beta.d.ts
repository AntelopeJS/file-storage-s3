/**
 * Visibility mode for files
 */
export type Visibility = "public" | "private";
/**
 * Request to create an upload URL
 */
export interface UploadRequest {
    /** Original filename */
    filename: string;
    /** Exact file size in bytes */
    size: number;
    /** MIME type of the file (e.g., 'image/jpeg') */
    mimetype: string;
    /** Optional path/folder prefix for the file */
    path?: string;
    /** Optional custom metadata to attach to the file */
    metadata?: Record<string, string>;
}
/**
 * Constraints for validating uploads
 */
export interface UploadConstraints {
    /** Maximum allowed file size in bytes */
    maxSize?: number;
    /** List of allowed MIME types (e.g., ['image/png', 'image/jpeg']) */
    allowedMimetypes?: string[];
}
/**
 * Response containing the presigned upload URL
 */
export interface PresignedUploadResponse {
    /** Presigned PUT URL for direct upload */
    uploadUrl: string;
    /** Unique resource key to reference this file */
    resourceKey: string;
    /** Timestamp when the URL expires */
    expiresAt: number;
    /** Required headers the client must send with the PUT request */
    headers: Record<string, string>;
}
/**
 * Response containing the URL to read/download a file
 */
export interface PresignedReadResponse {
    /** URL to access the file */
    url: string;
    /** Timestamp when the URL expires (undefined if public) */
    expiresAt?: number;
}
/**
 * File metadata information
 */
export interface FileMetadata {
    /** Unique resource key */
    resourceKey: string;
    /** Original filename */
    filename: string;
    /** File size in bytes */
    size: number;
    /** MIME type */
    mimetype: string;
    /** Last modified timestamp */
    lastModified: number;
    /** Custom metadata attached to the file */
    metadata?: Record<string, string>;
}
/**
 * Error thrown when upload validation fails
 */
export declare class UploadValidationError extends Error {
    readonly code: "SIZE_EXCEEDED" | "MIMETYPE_NOT_ALLOWED";
    constructor(message: string, code: "SIZE_EXCEEDED" | "MIMETYPE_NOT_ALLOWED");
}
/**
 * Error thrown when a file is not found
 */
export declare class FileNotFoundError extends Error {
    constructor(resourceKey: string);
}
/**
 * Creates a presigned URL for uploading a file directly to storage.
 *
 * The client must use the returned URL with a PUT request, including
 * all headers specified in the response. Any modification to the
 * Content-Type or Content-Length will cause the signature to be invalid.
 *
 * @param request - Upload request details (filename, size, mimetype)
 * @param constraints - Optional validation constraints
 * @param storage - Optional storage identifier for multi-bucket setups
 * @returns Presigned upload URL and required headers
 * @throws UploadValidationError if constraints are violated
 */
export declare function CreateUploadUrl(request: UploadRequest, constraints?: UploadConstraints, storage?: string): Promise<PresignedUploadResponse>;
/**
 * Creates a URL to read/download a file.
 *
 * For public files, returns the direct URL (no expiration).
 * For private files, returns a presigned URL with short expiration.
 *
 * @param resourceKey - The unique identifier of the file
 * @param expiresIn - Optional expiration time in seconds (for private files)
 * @param storage - Optional storage identifier for multi-bucket setups
 * @returns URL to access the file
 */
export declare function CreateReadUrl(resourceKey: string, expiresIn?: number, storage?: string): Promise<PresignedReadResponse>;
/**
 * Deletes a file from storage.
 *
 * @param resourceKey - The unique identifier of the file to delete
 * @param storage - Optional storage identifier for multi-bucket setups
 */
export declare function DeleteFile(resourceKey: string, storage?: string): Promise<void>;
/**
 * Checks if a file exists in storage.
 *
 * @param resourceKey - The unique identifier of the file
 * @param storage - Optional storage identifier for multi-bucket setups
 * @returns true if the file exists, false otherwise
 */
export declare function FileExists(resourceKey: string, storage?: string): Promise<boolean>;
/**
 * Retrieves metadata for a file.
 *
 * @param resourceKey - The unique identifier of the file
 * @param storage - Optional storage identifier for multi-bucket setups
 * @returns File metadata
 * @throws FileNotFoundError if the file doesn't exist
 */
export declare function GetFileMetadata(resourceKey: string, storage?: string): Promise<FileMetadata>;
