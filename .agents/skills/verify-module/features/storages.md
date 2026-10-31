---
covers:
  - src/index.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - named-storage
---

# Storages

The config holds a `default` storage and optional named storages that a call selects by id.

## Sub-features

- `named-storage`: a call with a storage id signs its URL for that storage's bucket, a call without one uses the default bucket, and an unknown id is refused naming it.

## How to get to it (user POV)

- An operator who adds `storages: { media: { ... } }` to the module config and a module that passes the id.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" storages
```

## Gotchas

- A config that names a storage `default` is refused at start; the journeys do not start that project.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
