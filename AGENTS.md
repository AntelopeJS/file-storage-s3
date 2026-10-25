# file-storage-s3

The S3-compatible (AWS S3, Cloudflare R2) implementation of `@antelopejs/interface-file-storage`, published as `@antelopejs/file-storage-s3`.

## Layout

- `src/index.ts` holds the module config types and lifecycle (`construct`, `destroy`, `getS3Client`); `src/lifecycle.ts` applies the optional staging expiry rule.
- `src/implementations/file-storage/` implements the interface. `ImplementInterface` picks its `internal` namespace by convention, so `knip.config.ts` lists it as an entry.
- `UPLOADS.md` documents the create-only upload, promotion and visibility contract. Update it with any behaviour change there.

## Versioning

- `@antelopejs/interface-file-storage` stays capped below the next minor (`>=0.1.6 <0.2.0`): 0.2.0 adds a required `readFile` handler. `pnpm lint` runs `antelopejs-check-interface-ranges`, which rejects a range that does not stop below the next minor.
- When a dependency range changes, update the compatibility table in `README.md` too.
- A release that needs action from users gets an `### Upgrade notes` section in `CHANGELOG.md`, above the generated entries.

## Tests

- Every test needs a Moto 5.2.3 S3 server on `127.0.0.1:5005`, including `pnpm run checks`. Start it with `docker compose -f .github/release-services.yml up -d --wait`, or `moto_server -H 127.0.0.1 -p 5005` (`uv tool install 'moto[server]==5.2.3'`). `S3_UPLOAD_TEST_ENDPOINT` overrides the endpoint and must stay on loopback.
- `pnpm test` runs `ajs module test .` with the test project in `src/test/antelope.test.ts`. Its `installCommand` (`pnpm run build`) is the only build; the compiled suites in `dist/test` then run, followed by the shared conformance suite from `@antelopejs/interface-file-storage`.
- `src/test/moto.test.ts` runs the HTTP and fault-injection tests in `scripts/test-uploads.mjs` with `node --test` in a child process against `dist`. They are part of `pnpm test`; run them alone with `S3_UPLOAD_TEST_ENDPOINT=http://127.0.0.1:5005 node --test scripts/test-uploads.mjs` after `pnpm run build`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
