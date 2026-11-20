# file-storage-s3

The S3-compatible (AWS S3, Cloudflare R2) implementation of `@antelopejs/interface-file-storage`, published as `@antelopejs/file-storage-s3`.

## Layout

- `src/index.ts` holds the module config types and lifecycle (`construct`, `destroy`, `getS3Client`); `src/lifecycle.ts` applies the optional staging expiry rule.
- `src/implementations/file-storage/` implements the interface. `ImplementInterface` picks its `internal` namespace by convention, so `knip.config.ts` lists it as an entry.
- `build` runs `tsc --skipLibCheck` for speed. `typecheck` checks the same files with the lib check, and `pnpm run checks`, pre-push, CI and `release` all run it.
- `UPLOADS.md` documents the create-only upload, promotion and visibility contract. Update it with any behaviour change there.

## Versioning

- Every 0.x `@antelopejs/*` range stops below the next minor (`>=0.1.8 <0.2.0`), and every 1.x range uses `~`, because a new minor can add required handlers. The `dependency:ranges` step of `pnpm run checks` rejects any other range.
- When a dependency range changes, update the compatibility table in `README.md` too.
- A release that needs action from users gets an `### Upgrade notes` section in `CHANGELOG.md`, above the generated entries.

## Tests

- Every test needs a Moto 5.2.3 S3 server on `127.0.0.1:5005`, including `pnpm run checks`. Start it with `docker compose -f .github/release-services.yml up -d --wait`, or `moto_server -H 127.0.0.1 -p 5005` (`uv tool install 'moto[server]==5.2.3'`). `S3_UPLOAD_TEST_ENDPOINT` overrides the endpoint and must stay on loopback.
- `pnpm test` runs `scripts/test.ts`: on Windows only the suites that mock S3 (`index`, `uploads`, `private-bucket`), because the shared CI never starts Moto there; elsewhere `ajs module test .` with the test project in `src/test/antelope.test.ts`. Its `installCommand` (`pnpm run build`) is the only build; the compiled suites in `dist/test` then run, followed by the shared conformance suite from `@antelopejs/interface-file-storage`.
- `src/test/moto.test.ts` runs the HTTP and fault-injection tests in `dist/test/uploads-http.js` with `node --test` in a child process against `dist`. They are part of `pnpm test`; run them alone with `S3_UPLOAD_TEST_ENDPOINT=http://127.0.0.1:5005 node --test dist/test/uploads-http.js` after `pnpm run build`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-module/SKILL.md`](.agents/skills/verify-module/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
