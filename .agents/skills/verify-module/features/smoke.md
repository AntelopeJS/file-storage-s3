---
covers:
docs:
  - README.md
  - UPLOADS.md
journeys:
  - module-dev
  - upload-through-moto
---

# Smoke

The fixed journey every verdict runs: load the module as `local` against Moto, get an upload URL, PUT the bytes and find them with boto3.

## Sub-features

- `module-dev` is the pack's journey: the project answers, the consumer loads the file storage interface, Ctrl+C exits 130.
- `upload-through-moto`: one upload through `CreateUploadUrl` ends in the bucket.

## How to get to it (user POV)

- A project with `@antelopejs/file-storage-s3`, a bucket and a module that imports `@antelopejs/interface-file-storage`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" smoke
```

## Gotchas

- The smoke feature covers no glob, so it never marks a file as mapped.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
