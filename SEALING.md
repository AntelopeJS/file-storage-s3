# Immutable file sealing

This adapter implements the additive contract in [interface-file-storage PR #7](https://github.com/AntelopeJS/interface-file-storage/pull/7). That interface is not published yet. This draft deliberately leaves the published dependency range and lockfile unchanged: merge and release require the real interface release, followed by a dependency-floor and lockfile update. Do not install the draft into production with interface-file-storage 0.1.2.

## Enable sealing only on a private, versioned store

Set `sealStorageId` on the storage configuration to a durable, unique store-incarnation UUID. All aliases and processes accessing the same bucket must use the same UUID. Never reuse that UUID for another bucket, endpoint, account, or a deleted and recreated bucket. Do not generate it on each application start.

Setting this field is an operator assertion that all of these prerequisites hold:

- The bucket is private, with public access blocked, and `defaultVisibility` is `private` without `publicUrl`.
- The source bucket has versioning enabled. Null or missing VersionIds are unsupported. Identical PUTs receive distinct VersionIds; ETags are not generations.
- The service implements strongly consistent GET and atomic `PutObject` `If-None-Match: *` and `If-Match` checks. An S3-compatible endpoint that ignores these headers is unsafe and must not opt in.
- The adapter exclusively owns initially empty `__sealed__/` and `__seal_data__/` namespaces. No old presigned uploads, external writers, replication, lifecycle expiry, delete markers, or version deletion may modify their protocol records. Do not enable sealing over previously user-writable reserved keys.
- The adapter can read specific source versions and write/read private backing objects and protocol records. A bucket owner must provision permissions; bootstrap does not modify access policies or versioning.

`GetFileSnapshot` returns the configured incarnation ID and the VersionId observed by the same HEAD request as its metadata. `SealFile` reads that exact VersionId, even when a newer version is current. It never deletes the source. Sources already under the reserved sealing namespaces are rejected; this initial implementation seals upload generations, not other seals.

The adapter buffers at most 16 MiB of source content, then writes a separate private payload with `If-None-Match: *`. Larger objects return `UNSUPPORTED`; there is no multipart fallback. Admission bindings are bounded to 8 KiB and slots to 64 KiB. Caller retries may create unreachable private payloads, but cannot publish multiple logical generations for one destination.

## Publication and cancellation share one conditional slot

1. An immutable record at `__seal_data__/admissions/<sha256(admissionId)>` binds the complete admission tuple using `If-None-Match: *`. Changed source or destination values return `DESTINATION_CONFLICT`.
2. The adapter reads the requested `__sealed__/...` destination slot. Matching sealed provenance returns the original identity without consulting the source. A tombstone returns `ADMISSION_REMOVED`; another owner returns `DESTINATION_CONFLICT`.
3. The adapter writes an immutable private payload, then publishes a JSON slot containing its version-specific pointer, metadata, identity, and trusted provenance using `If-None-Match: *`.
4. `RemoveSealedFile` writes a permanent tombstone into that same destination slot. It uses `If-None-Match: *` for an absent slot or `If-Match` with the observed slot ETag for a matching seal. It never physically deletes a slot or another admission's object.

The admission binding does not authorize publication or cancellation. A crash after binding alone leaves `GetFileSeal` at `absent`, and the same tuple can continue. Only the destination slot decides publication versus removal, so there is no two-key cancellation transaction. A delayed publication cannot overwrite a tombstone. A different admission cannot remove the winning slot, even after reading it before a concurrent change.

After a failed or lost write acknowledgement, the adapter rereads the durable state. Matching publication or removal reconciles successfully; conflicting provenance fails closed. If the state cannot establish the outcome, the adapter returns `OUTCOME_UNKNOWN`. Retry or reconcile the same admission; do not fall back to `PromoteFile`, rename, or a fresh admission. An `absent` observation alone does not cancel an in-flight PUT.

## Removal is logical, not immediate physical erasure

`CreateReadUrl`, `GetFileMetadata`, `FileExists`, and `GetFileSnapshot` resolve logical slots. Removed slots behave as missing files. Legacy upload, move, and delete operations reject the reserved namespaces, while behavior outside them, including legacy `PromoteFile`, remains unchanged.

New read URLs point to the exact private backing VersionId. Previously issued URLs remain usable until their signed expiration, including a read authorized concurrently with removal. Removing a seal does not revoke such URLs.

This change does not implement physical garbage collection. Losing, interrupted, and removed payloads consume storage. Future GC must distinguish immutable admission records from payloads, preserve every live pointer, and wait beyond issued URL expiry and in-flight operation windows. Never apply blanket expiration to `__seal_data__/`: admission bindings and tombstones are permanent protocol state.

## AWS semantics and provider limits

- [S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) assigns unique version IDs to new writes; unversioned and suspended null versions do not provide this identity.
- [GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) accepts `versionId` and requires `s3:GetObjectVersion` for version-specific reads.
- [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) define atomic destination `If-None-Match` and ETag-based `If-Match` checks, including 409/412 contention. Delete markers count as absence, which is why protocol keys must never be deleted.
- AWS [announced conditional CopyObject destinations in October 2025](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-s3-conditional-write-functionality-copy-operations/). Its [conditional-policy page](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) still contains contradictory unsupported-copy text. This implementation does not depend on CopyObject guarding both source and destination; legacy moves alone retain CopyObject.

Cloudflare R2 and other endpoints without immutable non-null VersionIds cannot use this implementation. The opt-in is not an automatic provider capability probe or an IAM-policy audit.

## Validate the draft against an explicit local artifact

The interface owner supplied an unpublished package with unchanged baseline metadata. For draft validation only, overlay the reviewed tarball into the ignored installed dependency after `pnpm install --frozen-lockfile`. No `file:` dependency, invented package version, or external checkout path belongs in package.json or the lockfile.

```sh
tar -xzf /path/to/antelopejs-interface-file-storage-final.tgz \
  -C node_modules/@antelopejs/interface-file-storage --strip-components=1
pnpm build
pnpm test
S3_SEAL_TEST_ENDPOINT=http://127.0.0.1:5005 pnpm test:sealing
```

The reviewed interface artifact SHA-256 is `1d43f0f0c05b9f8e2b0fe2cafb59c5da97f639b0366d14bb1cc1970217365684`. `pnpm test` also requires the AntelopeJS CLI, as in the existing CI workflow.

The sealing suite accepts only a loopback endpoint and creates a randomly named disposable bucket with test credentials. A local Moto 5.2.3 server exercises actual SDK HTTP requests, versioning, conditional publication, lost acknowledgements, paused writes, restart, and logical reads. Moto is an emulator, not evidence that AWS or another S3-compatible deployment implements these conditions correctly. No AWS account, shared storage, or production policy was modified during validation. Restart the disposable emulator to discard its test buckets.
