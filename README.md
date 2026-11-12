<a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration src="./.github/readme/strip.svg" width="100%" alt="PROVIDER · FILE STORAGE S3: part of AntelopeJS, hexagonal architecture beyond your own code. A glowing button reads Star AntelopeJS."></a>

<div align="center">

# `@antelopejs/file-storage-s3`

<a href="https://www.npmjs.com/package/@antelopejs/file-storage-s3"><img data-illustration alt="npm" src="https://img.shields.io/npm/v/@antelopejs/file-storage-s3?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-s3?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="https://discord.gg/g4pFt6eXqu"><img data-illustration alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a> <a href="https://github.com/AntelopeJS/interface-file-storage/tree/main/docs"><img data-illustration alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a> <a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration alt="Star AntelopeJS" src="https://img.shields.io/github/stars/AntelopeJS/antelopejs?label=Star%20AntelopeJS&style=for-the-badge&labelColor=000000&color=000000&logo=github"></a>

**The AntelopeJS file storage module for S3-compatible object storage, such as AWS S3 and Cloudflare R2, using presigned URLs.**

[Documentation](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) · [Interfaces](#interfaces) · [All interfaces and providers](https://github.com/AntelopeJS/antelopejs#ecosystem)

</div>

The AntelopeJS file storage module for S3-compatible object storage, such as AWS S3 and Cloudflare R2. It uses `@aws-sdk/client-s3`, and clients upload and read files directly from the bucket through presigned URLs.

## Interfaces

| Interface                                                                                    | Documentation                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage) | [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) |

The interface pages document uploads, reads, visibility, metadata, staging, and promotion.

## Install

```bash
ajs project modules add @antelopejs/file-storage-s3
```

The module ships no default configuration, so add a `config` block with a `default` storage before you start the project.

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

| Key                              | Description                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`, `region`             | S3 endpoint and region. R2 uses region `auto`.                                                                                                                                                             |
| `accessKeyId`, `secretAccessKey` | Credentials of the S3 client.                                                                                                                                                                              |
| `bucket`                         | Bucket that holds the files.                                                                                                                                                                               |
| `attachmentPrivateBucket`        | Optional bucket for uploads that request `visibility: "private"`, kept apart from a public `bucket`. Without it, such an upload throws.                                                                    |
| `publicUrl`                      | Optional public origin of `bucket`. A public file is read from `<publicUrl>/<resourceKey>`. Without `publicUrl`, it is read through a presigned URL.                                                       |
| `defaultVisibility`              | Visibility of a file uploaded without one, `"public"` or `"private"`.                                                                                                                                      |
| `defaultUploadExpiration`        | Lifetime of an upload URL, in seconds.                                                                                                                                                                     |
| `defaultReadExpiration`          | Lifetime of a private read URL, in seconds, when the caller sets none.                                                                                                                                     |
| `stagingExpirationDays`          | Optional. At startup, the module puts a lifecycle rule on `bucket` and `attachmentPrivateBucket` that expires staged files after this many days. Omit it when your infrastructure manages lifecycle rules. |
| `assumePrivateBuckets`           | Optional, `false` by default. Relaxes the private bucket verification for providers that cannot pass it.                                                                                                   |

Every key except the optional ones is required. `default` holds the main storage. `storages` adds named storages with the same keys, and the `storage` argument of the interface functions selects one. The name `default` is reserved in `storages`, and the module refuses to start with it.

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
- S3 stores metadata keys in lowercase, so `GetFileMetadata` returns `tenantid` for an upload sent with `tenantId`. Two keys that differ only by case make the upload throw.

[UPLOADS.md](UPLOADS.md) details these guarantees. It covers create-only uploads, promotion, privacy and expiry, private bucket verification, metadata keys, and CORS.

## Documentation

- [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) documents the `@antelopejs/interface-file-storage` contract that this module implements.
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration) covers module sources, `config` blocks, and config variables in `antelope.config.ts`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                              | Supported        | Tested with |
| ------------------------------------ | ---------------- | ----------- |
| `@antelopejs/interface-core`         | `>=0.2.4 <1.0.0` | `0.4.0`     |
| `@antelopejs/interface-file-storage` | `>=0.1.6 <0.2.0` | `0.1.6`     |

<!-- antelopejs-docs-compat:end -->

`.nvmrc` names the Node.js release for development. The tests run against the Moto image that `.github/release-services.yml` pins.

## Contributing

The tests need a [Moto](https://github.com/getmoto/moto) S3 server on `127.0.0.1:5005`. Start the one that CI uses:

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

## Part of AntelopeJS

This package belongs to [AntelopeJS](https://github.com/AntelopeJS/antelopejs), the TypeScript framework where modules depend on contracts and the application chooses the provider. The open-source back office [AntelopeJS DMS](https://github.com/AntelopeJS/dms) is built on it.

<!-- antelopejs-framework-modules:start -->

| Area         | Contracts                                                                                                                                                                                                                                                                                                                                                                                                                  | Providers                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | [`interface-api`](https://github.com/AntelopeJS/interface-api) · [`interface-api-util`](https://github.com/AntelopeJS/interface-api-util) · [`interface-data-api`](https://github.com/AntelopeJS/interface-data-api)                                                                                                                                                                                                       | [`api`](https://github.com/AntelopeJS/api)                                                                                                                                                                                                          |
| Auth         | [`interface-auth`](https://github.com/AntelopeJS/interface-auth)                                                                                                                                                                                                                                                                                                                                                           | [`auth-jwt`](https://github.com/AntelopeJS/auth-jwt)                                                                                                                                                                                                |
| Database     | [`interface-database`](https://github.com/AntelopeJS/interface-database) · [`interface-database-decorators`](https://github.com/AntelopeJS/interface-database-decorators) · [`interface-database-catalog`](https://github.com/AntelopeJS/interface-database-catalog) · [`interface-mongodb`](https://github.com/AntelopeJS/interface-mongodb) · [`interface-rethinkdb`](https://github.com/AntelopeJS/interface-rethinkdb) | [`postgres`](https://github.com/AntelopeJS/postgres) · [`mongodb`](https://github.com/AntelopeJS/mongodb) · [`rethinkdb`](https://github.com/AntelopeJS/rethinkdb)                                                                                  |
| Redis        | [`interface-redis`](https://github.com/AntelopeJS/interface-redis) · [`interface-redis-scheduler`](https://github.com/AntelopeJS/interface-redis-scheduler)                                                                                                                                                                                                                                                                | [`redis`](https://github.com/AntelopeJS/redis)                                                                                                                                                                                                      |
| Email        | [`interface-email`](https://github.com/AntelopeJS/interface-email)                                                                                                                                                                                                                                                                                                                                                         | [`nodemailer`](https://github.com/AntelopeJS/nodemailer) · [`brevo`](https://github.com/AntelopeJS/brevo)                                                                                                                                           |
| File storage | [`interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage)                                                                                                                                                                                                                                                                                                                                           | [`file-storage-local`](https://github.com/AntelopeJS/file-storage-local) · **`file-storage-s3`**                                                                                                                                                    |
| Payments     | [`interface-payment`](https://github.com/AntelopeJS/interface-payment) · [`interface-subscriptions`](https://github.com/AntelopeJS/interface-subscriptions) · [`interface-stripe`](https://github.com/AntelopeJS/interface-stripe)                                                                                                                                                                                         | [`stripe`](https://github.com/AntelopeJS/stripe) · [`mollie`](https://github.com/AntelopeJS/mollie) · [`checkout-com`](https://github.com/AntelopeJS/checkout-com) · [`payment-subscriptions`](https://github.com/AntelopeJS/payment-subscriptions) |

<!-- antelopejs-framework-modules:end -->

## License

[Apache-2.0](LICENSE)
