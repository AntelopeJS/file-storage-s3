---
covers:
  - src/implementations/file-storage/private-bucket.ts
  - src/implementations/file-storage/beta.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - private-routing
  - private-bucket-guard
---

# Visibility

A file uploaded with `visibility: private` goes to the private bucket, which the module first checks blocks public access.

## Sub-features

- `private-routing`: the key sits under `__visibility__/private/`, the private bucket (not the public one) holds the bytes, `CreateReadUrl` answers a signed URL that expires and serves the bytes, and `FileExists` finds the file.
- `private-bucket-guard`: with a private bucket that leaves one public access flag off, a private upload is refused naming the bucket, nothing is stored, and a public upload still works.

## How to get to it (user POV)

- A module that sets `visibility: "private"` in its upload request and configures `attachmentPrivateBucket`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" visibility
```

## Gotchas

- Moto does not enforce bucket policies on anonymous reads, so the journeys assert where the bytes are and how the URL is signed, not that an anonymous GET fails.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
