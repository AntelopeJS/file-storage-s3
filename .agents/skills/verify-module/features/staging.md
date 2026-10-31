---
covers:
  - src/implementations/file-storage/promotion.ts
  - src/implementations/file-storage/beta.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - promote-staged
  - promote-conflict
---

# Staging

A file uploaded with `staging: true` waits under `__staging__/` until the application promotes it.

## Sub-features

- `promote-staged`: `PromoteFile` answers the staged key without its prefix, the final object holds the bytes, type, filename and metadata, the staged copy is gone, promoting again replays the same key, and a regular key answers itself.
- `promote-conflict`: when a foreign object already sits at the final key, `PromoteFile` throws `FileConflictError`, the foreign object is untouched and the staged upload stays.

## How to get to it (user POV)

- A module that uploads with `staging: true` and calls `PromoteFile` once the user confirms.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" staging
```

## Gotchas

- Promotion streams the object through the server (get, then a conditional put), as UPLOADS.md describes.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
