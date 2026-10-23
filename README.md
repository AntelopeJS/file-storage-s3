# @antelopejs/file-storage-s3

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/file-storage-s3"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/file-storage-s3?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-s3?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://github.com/AntelopeJS/interface-file-storage/tree/main/docs"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The AntelopeJS file storage module for S3-compatible object storage (AWS S3, Cloudflare R2 and others), built on the AWS SDK for JavaScript v3: clients upload and read files directly from the bucket through presigned URLs.

## Interfaces

| Interface                                                                                    | Documentation                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage) | [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) |

Uploads, reads, visibility, metadata, staging and promotion are documented on the interface pages.

## Install

```bash
ajs project modules add @antelopejs/file-storage-s3
```

The module ships no default configuration: add a `config` block with a `default` storage before starting the project.

## Configuration

```typescript [antelope.config.ts]
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "my-project",
  modules: {
    "file-storage-s3": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-s3",
        version: "^0.1.5",
      },
      config: {
        default: {
          endpoint: "https://<account>.r2.cloudflarestorage.com",
          region: "auto",
          accessKeyId: "<access-key-id>",
          secretAccessKey: "<secret-access-key>",
          bucket: "app-files",
          attachmentPrivateBucket: "app-private-files",
          publicUrl: "https://cdn.example.com",
          defaultVisibility: "private",
          defaultUploadExpiration: 3600,
          defaultReadExpiration: 300,
          stagingExpirationDays: 1,
          assumePrivateBuckets: false,
        },
        storages: {
          media: {
            endpoint: "https://<account>.r2.cloudflarestorage.com",
            region: "auto",
            accessKeyId: "<access-key-id>",
            secretAccessKey: "<secret-access-key>",
            bucket: "app-media",
            publicUrl: "https://media.example.com",
            defaultVisibility: "public",
            defaultUploadExpiration: 3600,
            defaultReadExpiration: 300,
          },
        },
      },
    },
  },
  envOverrides: {
    S3_SECRET_ACCESS_KEY:
      "modules.file-storage-s3.config.default.secretAccessKey",
  },
});
```

| Key                              | Description                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`, `region`             | S3 endpoint and region. R2 uses region `auto`.                                                                                                                   |
| `accessKeyId`, `secretAccessKey` | Credentials of the S3 client.                                                                                                                                    |
| `bucket`                         | Bucket that holds the files.                                                                                                                                     |
| `attachmentPrivateBucket`        | Optional bucket for uploads that request `visibility: "private"`, kept apart from a public `bucket`.                                                             |
| `publicUrl`                      | Optional public origin of `bucket`. Public files are read from `<publicUrl>/<resourceKey>`; without it, through presigned URLs.                                  |
| `defaultVisibility`              | Visibility of files uploaded without an explicit one: `"public"` or `"private"`.                                                                                 |
| `defaultUploadExpiration`        | Lifetime of an upload URL, in seconds.                                                                                                                           |
| `defaultReadExpiration`          | Lifetime of a private read URL, in seconds, when the caller sets none.                                                                                           |
| `stagingExpirationDays`          | Optional. At startup, the module adds a lifecycle rule that expires staged files after this many days. Omit it when your infrastructure manages lifecycle rules. |
| `assumePrivateBuckets`           | Optional, `false` by default. Relaxes the private bucket verification for providers that cannot pass it.                                                         |

Every key except the optional ones is required. `default` holds the main storage; `storages` adds named ones with the same keys, addressed with the `storage` argument of the interface functions. The name `default` is reserved in `storages`.

## Quick start

In the module that handles uploads, add the interface:

```bash
pnpm add @antelopejs/interface-file-storage
```

```typescript
import {
  CreateReadUrl,
  CreateUploadUrl,
} from "@antelopejs/interface-file-storage";

const upload = await CreateUploadUrl(
  { filename: "avatar.png", size: 52_000, mimetype: "image/png" },
  { maxSize: 1_000_000, allowedMimetypes: ["image/png", "image/jpeg"] },
);

const read = await CreateReadUrl(upload.resourceKey);
```

The client sends the file with `PUT upload.uploadUrl` and every header of `upload.headers`, unchanged, then fetches it from `read.url`.

## Before deploying

- Upload URLs sign an `If-None-Match: *` condition, so an upload never replaces an existing object. The provider must enforce conditional `PUT`, and the bucket CORS rules must allow the `if-none-match` header.
- The module verifies that `attachmentPrivateBucket` blocks all public access before using it. MinIO and Hetzner Object Storage need `assumePrivateBuckets: true`.
- S3 stores metadata keys in lowercase: `GetFileMetadata` returns `tenantid` for an upload sent with `tenantId`.

[UPLOADS.md](UPLOADS.md) details these guarantees: create-only uploads, promotion, privacy and expiry, private bucket verification, metadata keys and CORS.

## Documentation

- [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs): the `@antelopejs/interface-file-storage` contract this module implements
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration): module sources, `config` blocks and config variables in `antelope.config.ts`

## Compatibility

| Package                              | Supported range  |
| ------------------------------------ | ---------------- |
| `@antelopejs/interface-file-storage` | `>=0.1.6 <0.2.0` |
| `@antelopejs/interface-core`         | `>=0.2.4 <1.0.0` |

The module is developed and tested against `@antelopejs/core` `^1.16.0` on Node.js 24, with `@aws-sdk/client-s3` `^3.1016.0` and Moto 5.2.3.

## Contributing

The tests need a [Moto](https://github.com/getmoto/moto) S3 server on `127.0.0.1:5005`. Start the one CI uses:

```bash
docker compose -f .github/release-services.yml up -d --wait
```

Then run the checks:

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm knip
pnpm test           # build, then ajs module test
```

The tests also run the shared conformance suite of `@antelopejs/interface-file-storage`. Read the [contribution guidelines](CONTRIBUTING.md) before opening a pull request.

## License

[Apache-2.0](LICENSE)
