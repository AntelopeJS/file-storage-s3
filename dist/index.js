"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStorageConfig = getStorageConfig;
exports.getS3Client = getS3Client;
exports.construct = construct;
exports.start = start;
exports.stop = stop;
exports.destroy = destroy;
const beta_1 = require("@ajs/core/beta");
const client_s3_1 = require("@aws-sdk/client-s3");
let moduleConfig;
const s3Clients = new Map();
function createS3Client(config) {
    return new client_s3_1.S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
}
function getStorageConfig(storage) {
    if (!storage) {
        return moduleConfig.default;
    }
    const config = moduleConfig.storages?.[storage];
    if (!config) {
        throw new Error(`Storage '${storage}' not found in configuration`);
    }
    return config;
}
function getS3Client(storage) {
    const key = storage ?? 'default';
    let client = s3Clients.get(key);
    if (!client) {
        const config = getStorageConfig(storage);
        client = createS3Client(config);
        s3Clients.set(key, client);
    }
    return client;
}
async function construct(config) {
    moduleConfig = config;
    await (0, beta_1.ImplementInterface)(Promise.resolve().then(() => __importStar(require('@ajs.local/file-storage/beta'))), Promise.resolve().then(() => __importStar(require('./implementations/file-storage/beta'))));
}
function start() { }
function stop() { }
function destroy() {
    for (const client of s3Clients.values()) {
        client.destroy();
    }
    s3Clients.clear();
}
//# sourceMappingURL=index.js.map