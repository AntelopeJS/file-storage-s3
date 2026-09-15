# @antelopejs/file-storage-s3

[![npm](https://img.shields.io/npm/v/@antelopejs/file-storage-s3)](https://www.npmjs.com/package/@antelopejs/file-storage-s3)
[![CI](https://github.com/AntelopeJS/file-storage-s3/actions/workflows/ci.yml/badge.svg)](https://github.com/AntelopeJS/file-storage-s3/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

S3-compatible implementation of the AntelopeJS file-storage interface. It
supports AWS S3, Cloudflare R2, and compatible services, with signed uploads,
public and private reads, named storage backends, and staged-file promotion.

## Installation

```bash
pnpm add @antelopejs/file-storage-s3
```

The module implements
[`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage).

## Configuration

Add the module to `antelope.config.ts`:

```ts
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "my-app",
  modules: {
    storage: {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-s3",
      },
      config: {
        default: {
          endpoint: "https://s3.example.com",
          region: "auto",
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          bucket: "app-files",
          attachmentPrivateBucket: "app-private-files",
          publicUrl: "https://cdn.example.com",
          defaultVisibility: "private",
          defaultUploadExpiration: 3600,
          defaultReadExpiration: 300,
          stagingExpirationDays: 1,
        },
      },
    },
  },
});
```

`attachmentPrivateBucket` keeps explicit private uploads separate from a public
bucket. `publicUrl` is required for public reads. Omit
`stagingExpirationDays` when lifecycle rules are managed by infrastructure.

Additional backends can be declared under `storages`. The name `default` is
reserved.

## Upload guarantees

Upload URLs include a signed `If-None-Match: *` condition. Clients must send all
returned headers unchanged. This prevents an upload URL from replacing an
existing object while that object exists.

Read [UPLOADS.md](UPLOADS.md) before deploying. It documents promotion,
privacy, expiry, CORS, conditional-write requirements, retries, and the trust
boundary for S3-compatible providers.

## Development

Tests use a disposable Moto server:

```bash
uv tool install 'moto[server]==5.2.3'
moto_server -H 127.0.0.1 -p 5005
```

In another terminal:

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm test
```

See the organization-wide
[contribution guidelines](https://github.com/AntelopeJS/.github/blob/main/CONTRIBUTING.md)
and [security policy](SECURITY.md).

## License

Apache-2.0
