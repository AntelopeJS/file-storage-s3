"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internal = void 0;
const beta_1 = require("@ajs.local/file-storage/beta");
const index_1 = require("../../index");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const path_1 = require("path");
function generateResourceKey(request) {
    const ext = (0, path_1.extname)(request.filename) || '';
    const uuid = (0, crypto_1.randomUUID)();
    const prefix = request.path ? `${request.path.replace(/^\/|\/$/g, '')}/` : '';
    return `${prefix}${uuid}${ext}`;
}
function validateUploadRequest(request, constraints) {
    if (constraints?.maxSize && request.size > constraints.maxSize) {
        throw new beta_1.UploadValidationError(`File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`, 'SIZE_EXCEEDED');
    }
    if (constraints?.allowedMimetypes && constraints.allowedMimetypes.length > 0) {
        if (!constraints.allowedMimetypes.includes(request.mimetype)) {
            throw new beta_1.UploadValidationError(`MIME type '${request.mimetype}' is not allowed. Allowed types: ${constraints.allowedMimetypes.join(', ')}`, 'MIMETYPE_NOT_ALLOWED');
        }
    }
}
function getVisibility(request, config) {
    return request.visibility ?? config.defaultVisibility;
}
var internal;
(function (internal) {
    internal.createUploadUrl = async (request, constraints, storage) => {
        validateUploadRequest(request, constraints);
        const client = (0, index_1.getS3Client)(storage);
        const config = (0, index_1.getStorageConfig)(storage);
        const resourceKey = generateResourceKey(request);
        const metadata = {
            'original-filename': request.filename,
            ...(request.metadata || {}),
        };
        const command = new client_s3_1.PutObjectCommand({
            Bucket: config.bucket,
            Key: resourceKey,
            ContentType: request.mimetype,
            ContentLength: request.size,
            Metadata: metadata,
        });
        const expiresIn = config.defaultUploadExpiration;
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(client, command, {
            expiresIn,
            signableHeaders: new Set(['content-type', 'content-length']),
        });
        const expiresAt = Date.now() + expiresIn * 1000;
        return {
            uploadUrl,
            resourceKey,
            expiresAt,
            headers: {
                'Content-Type': request.mimetype,
                'Content-Length': String(request.size),
            },
        };
    };
    internal.createReadUrl = async (resourceKey, expiresIn, storage) => {
        const config = (0, index_1.getStorageConfig)(storage);
        if (config.publicUrl && config.defaultVisibility === 'public') {
            const url = `${config.publicUrl.replace(/\/$/, '')}/${resourceKey}`;
            return { url };
        }
        const client = (0, index_1.getS3Client)(storage);
        const effectiveExpiresIn = expiresIn ?? config.defaultReadExpiration;
        const command = new client_s3_1.GetObjectCommand({
            Bucket: config.bucket,
            Key: resourceKey,
        });
        const url = await (0, s3_request_presigner_1.getSignedUrl)(client, command, {
            expiresIn: effectiveExpiresIn,
        });
        return {
            url,
            expiresAt: Date.now() + effectiveExpiresIn * 1000,
        };
    };
    internal.deleteFile = async (resourceKey, storage) => {
        const client = (0, index_1.getS3Client)(storage);
        const config = (0, index_1.getStorageConfig)(storage);
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: config.bucket,
            Key: resourceKey,
        });
        await client.send(command);
    };
    internal.fileExists = async (resourceKey, storage) => {
        const client = (0, index_1.getS3Client)(storage);
        const config = (0, index_1.getStorageConfig)(storage);
        try {
            const command = new client_s3_1.HeadObjectCommand({
                Bucket: config.bucket,
                Key: resourceKey,
            });
            await client.send(command);
            return true;
        }
        catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    };
    internal.getFileMetadata = async (resourceKey, storage) => {
        const client = (0, index_1.getS3Client)(storage);
        const config = (0, index_1.getStorageConfig)(storage);
        try {
            const command = new client_s3_1.HeadObjectCommand({
                Bucket: config.bucket,
                Key: resourceKey,
            });
            const response = await client.send(command);
            return {
                resourceKey,
                size: response.ContentLength ?? 0,
                mimetype: response.ContentType ?? 'application/octet-stream',
                lastModified: response.LastModified?.getTime() ?? Date.now(),
                metadata: response.Metadata,
            };
        }
        catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                throw new beta_1.FileNotFoundError(resourceKey);
            }
            throw error;
        }
    };
})(internal || (exports.internal = internal = {}));
//# sourceMappingURL=beta.js.map