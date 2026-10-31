---
covers:
  - src/implementations/file-storage/beta.ts
  - src/implementations/file-storage/metadata.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - objects-lifecycle
---

# Objects

An application module checks, describes, links, moves and deletes a stored file.

## Sub-features

- `objects-lifecycle`: `FileExists` and `GetFileMetadata` answer for an uploaded file and for an unknown key (`FileNotFoundError`); `CreateReadUrl` of a public file is the public base plus the key and serves the bytes; `MoveFile` leaves the object at the destination only with its bytes and metadata; `DeleteFile` empties the bucket. This is the containment journey of the Data door.

## How to get to it (user POV)

- A module that calls `FileExists`, `GetFileMetadata`, `CreateReadUrl`, `MoveFile` and `DeleteFile` of the file storage interface.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" objects
```

## Gotchas

- `ReadFile` returns a stream that the JSON driver cannot pass; it is covered by the module's own mocha suite.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
