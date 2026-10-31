---
covers:
  - src/implementations/file-storage/beta.ts
  - src/implementations/file-storage/metadata.ts
  - src/implementations/file-storage/index.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - upload-presigned
  - upload-validation
---

# Upload

An application module asks for a presigned upload URL; a client PUTs the bytes straight into the bucket with the headers the module returned.

## Sub-features

- `upload-presigned`: `CreateUploadUrl` returns a slot whose headers carry the create-only condition, the declared type and size and the lowercased metadata; a PUT with exactly those headers stores the bytes, the type, the filename and the metadata; a second PUT of the same URL is refused with 412 and the first bytes stay.
- `upload-validation`: a size over `maxSize`, a type outside `allowedMimetypes` and metadata keys that collide once lowercased are each refused with their message; a request on the limit is accepted; the bucket stays empty.

## How to get to it (user POV)

- A module that imports `@antelopejs/interface-file-storage` and calls `CreateUploadUrl(request, constraints?, storage?)`, then hands the URL and headers to a browser.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" upload
```

## Gotchas

- `WriteFile` carries a `Uint8Array` that the JSON driver cannot pass; it is covered by the module's own mocha suite, not by a journey.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
