# @antelopejs/file-storage-s3

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/file-storage-s3"><img alt="NPM version" src="https://img.shields.io/npm/v/@antelopejs/file-storage-s3.svg?style=for-the-badge&labelColor=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-s3.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

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

### Private bucket verification

Before its first use, the module verifies that `attachmentPrivateBucket` blocks
all public access: `GetPublicAccessBlock` must report the four flags
`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, and
`RestrictPublicBuckets` as enabled. Otherwise, every explicit private upload
and read fails.

Some S3-compatible providers do not implement `GetPublicAccessBlock` (MinIO
answers `501 NotImplemented`; Hetzner Object Storage does not list it among its
supported actions). For those providers, set `assumePrivateBuckets: true` on
the storage:

```ts
default: {
  // ...
  attachmentPrivateBucket: "app-private-files",
  assumePrivateBuckets: true,
},
```

With this option, the module skips the public access block verification and
logs a warning at startup for each assumed bucket. As a best-effort safety net,
it calls `GetBucketPolicyStatus` and refuses the bucket when the provider
reports it public. The module continues when the provider does not implement
that call (`501 NotImplemented`) or when the bucket has no policy. Any other
error still fails the verification.

The operator is then responsible for keeping the private bucket private: do not
attach a public bucket policy, public ACLs, anonymous access rules, or a public
domain to it. Providers can under-report public access through
`GetBucketPolicyStatus` (MinIO reports `IsPublic: false` even with an
anonymous read policy), so do not rely on the safety net alone. The option
defaults to `false`, which keeps the strict verification.

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
