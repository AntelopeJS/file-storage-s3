"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internal = exports.FileNotFoundError = exports.UploadValidationError = void 0;
exports.CreateUploadUrl = CreateUploadUrl;
exports.CreateReadUrl = CreateReadUrl;
exports.DeleteFile = DeleteFile;
exports.FileExists = FileExists;
exports.GetFileMetadata = GetFileMetadata;
const beta_1 = require("@ajs/core/beta");
class UploadValidationError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'UploadValidationError';
    }
}
exports.UploadValidationError = UploadValidationError;
class FileNotFoundError extends Error {
    constructor(resourceKey) {
        super(`File not found: ${resourceKey}`);
        this.name = 'FileNotFoundError';
    }
}
exports.FileNotFoundError = FileNotFoundError;
var internal;
(function (internal) {
    internal.createUploadUrl = (0, beta_1.InterfaceFunction)();
    internal.createReadUrl = (0, beta_1.InterfaceFunction)();
    internal.deleteFile = (0, beta_1.InterfaceFunction)();
    internal.fileExists = (0, beta_1.InterfaceFunction)();
    internal.getFileMetadata = (0, beta_1.InterfaceFunction)();
})(internal || (exports.internal = internal = {}));
function CreateUploadUrl(request, constraints, storage) {
    return internal.createUploadUrl(request, constraints, storage);
}
function CreateReadUrl(resourceKey, expiresIn, storage) {
    return internal.createReadUrl(resourceKey, expiresIn, storage);
}
function DeleteFile(resourceKey, storage) {
    return internal.deleteFile(resourceKey, storage);
}
function FileExists(resourceKey, storage) {
    return internal.fileExists(resourceKey, storage);
}
function GetFileMetadata(resourceKey, storage) {
    return internal.getFileMetadata(resourceKey, storage);
}
//# sourceMappingURL=beta.js.map