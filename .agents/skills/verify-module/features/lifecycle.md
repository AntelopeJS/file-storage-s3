---
covers:
  - src/lifecycle.ts
docs:
  - README.md
  - UPLOADS.md
journeys:
  - lifecycle-rule
---

# Lifecycle

With `stagingExpirationDays` the module keeps an expiration rule for the staging prefix on the configured buckets.

## Sub-features

- `lifecycle-rule`: at start the bucket gets the `antelopejs-staging-expiration` rule for `__staging__/` with the configured days, beside the rule that was already there.

## How to get to it (user POV)

- An operator who sets `stagingExpirationDays` in the module config.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" lifecycle
```

## Gotchas

- A failure to apply the rule is only logged as a warning, so a journey that needs the rule reads it back with boto3.
- Storage is a disposable Moto container (`motoserver/moto:5.2.3`); journeys read state back with boto3 inside it, a different client than the module's AWS SDK for JavaScript.
