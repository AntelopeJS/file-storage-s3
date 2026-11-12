# Changelog

## v0.1.11

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.10...v0.1.11)

### 🔥 Performance

- **ci:** Probe Moto health every second while it starts ([#56](https://github.com/AntelopeJS/file-storage-s3/pull/56))
- **build:** Skip the lib check in build, keep it in typecheck ([#57](https://github.com/AntelopeJS/file-storage-s3/pull/57))

### 🩹 Fixes

- **verify:** Cover the lifecycle call in index.ts and upload metadata in promotion.ts ([#58](https://github.com/AntelopeJS/file-storage-s3/pull/58))
- **storage:** Resolve only own keys of storages in getStorageConfig ([#59](https://github.com/AntelopeJS/file-storage-s3/pull/59))
- **metadata:** Reject a __proto__ metadata key instead of dropping it ([#60](https://github.com/AntelopeJS/file-storage-s3/pull/60))

### 📖 Documentation

- **readme:** Link the package to AntelopeJS and AntelopeJS DMS ([dc90fc5](https://github.com/AntelopeJS/file-storage-s3/commit/dc90fc5))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#55](https://github.com/AntelopeJS/file-storage-s3/pull/55))
- **deps:** Bump @antelopejs/tooling-configs to 0.4.0 ([#61](https://github.com/AntelopeJS/file-storage-s3/pull/61))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#62](https://github.com/AntelopeJS/file-storage-s3/pull/62))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#63](https://github.com/AntelopeJS/file-storage-s3/pull/63))

### 🏡 Chore

- **verify:** Remove seeded runs from the verification skill ([#52](https://github.com/AntelopeJS/file-storage-s3/pull/52))
- **ci:** Remove the weekly mutation caller ([#53](https://github.com/AntelopeJS/file-storage-s3/pull/53))

### 🤖 CI

- Call ci-node.yml@v1 ([#54](https://github.com/AntelopeJS/file-storage-s3/pull/54))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.10

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.9...v0.1.10)

### 💅 Refactors

- Clean the repo with the guardrail pack ([#41](https://github.com/AntelopeJS/file-storage-s3/pull/41))
- Clear the residual ratchet findings ([#42](https://github.com/AntelopeJS/file-storage-s3/pull/42))

### 📖 Documentation

- **changelog:** Upgrade notes of file-storage-s3 0.1.9 ([#35](https://github.com/AntelopeJS/file-storage-s3/pull/35))
- **readme:** Use one Discord invite ([#46](https://github.com/AntelopeJS/file-storage-s3/pull/46))
- **github:** Send questions and ideas to Discord ([#47](https://github.com/AntelopeJS/file-storage-s3/pull/47))

### 🏡 Chore

- Adopt the guardrail pack from tooling-configs 0.2.0 ([#36](https://github.com/AntelopeJS/file-storage-s3/pull/36))
- Configure Renovate with the shared preset ([#37](https://github.com/AntelopeJS/file-storage-s3/pull/37))
- Land the cleanup campaign on main ([#50](https://github.com/AntelopeJS/file-storage-s3/pull/50))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.9

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.8...v0.1.9)

### Upgrade notes

- Implements `ReadFile` from `@antelopejs/interface-file-storage` 0.1.6 with one `GetObjectCommand` in the bucket the key's visibility routes to; the SDK body stream is returned as is with `ContentLength` and `ContentType`, and a missing object throws `FileNotFoundError` ([#33](https://github.com/AntelopeJS/file-storage-s3/pull/33)). The server needs network access to the S3 endpoint, not to a presigned URL.
- Implements `@antelopejs/interface-file-storage` `>=0.1.6 <0.2.0`. Upgrade it together with interface-file-storage 0.1.6: a provider without `readFile` (0.1.8 and older) fails to construct against it.

### 🚀 Enhancements

- Implement ReadFile with GetObject ([#33](https://github.com/AntelopeJS/file-storage-s3/pull/33))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.8

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.7...v0.1.8)

## v0.1.7

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.6...v0.1.7)

### 🚀 Enhancements

- Implement WriteFile with a conditional PutObject ([#32](https://github.com/AntelopeJS/file-storage-s3/pull/32))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.6

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.5...v0.1.6)

### 📖 Documentation

- Rewrite the README ([#29](https://github.com/AntelopeJS/file-storage-s3/pull/29))
- **agents:** Simplify repository guidance ([#30](https://github.com/AntelopeJS/file-storage-s3/pull/30))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.5

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- **presign:** Sign metadata headers regardless of key casing ([#25](https://github.com/AntelopeJS/file-storage-s3/pull/25))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.4

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.3...v0.1.4)

### 🚀 Enhancements

- **config:** Allow operators to assume private buckets ([#24](https://github.com/AntelopeJS/file-storage-s3/pull/24))

### 📖 Documentation

- Add public package readme ([#15](https://github.com/AntelopeJS/file-storage-s3/pull/15))

### 🏡 Chore

- Align community files with the organization defaults ([#17](https://github.com/AntelopeJS/file-storage-s3/pull/17))
- Remove .git-blame-ignore-revs ([#19](https://github.com/AntelopeJS/file-storage-s3/pull/19))

### 🤖 CI

- Harden specialized npm release workflow ([#16](https://github.com/AntelopeJS/file-storage-s3/pull/16))
- **release:** Release next from a dedicated branch and restore requireCommits ([#20](https://github.com/AntelopeJS/file-storage-s3/pull/20))
- **release:** Use the shared release workflow with compose services ([#21](https://github.com/AntelopeJS/file-storage-s3/pull/21))
- Start test services from the shared compose file ([#22](https://github.com/AntelopeJS/file-storage-s3/pull/22))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- **storage:** Add create-only uploads and streaming promotion ([#13](https://github.com/AntelopeJS/file-storage-s3/pull/13))

### 🏡 Chore

- Replace Biome with oxlint, oxfmt and Knip ([#11](https://github.com/AntelopeJS/file-storage-s3/pull/11))

### 🤖 CI

- Standardize npm releases ([#10](https://github.com/AntelopeJS/file-storage-s3/pull/10))
- Start moto for release tests ([#14](https://github.com/AntelopeJS/file-storage-s3/pull/14))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Thomas ([@Thomasims](http://github.com/Thomasims))

## v0.1.2

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.1...v0.1.2)

## v0.1.1

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.1.0...v0.1.1)

## v0.1.0

[compare changes](https://github.com/AntelopeJS/file-storage-s3/compare/v0.0.2...v0.1.0)

### 🚀 Enhancements

- Staging upload + file promotion ([#7](https://github.com/AntelopeJS/file-storage-s3/pull/7))

### 🏡 Chore

- Update dependencies ([e10ea02](https://github.com/AntelopeJS/file-storage-s3/commit/e10ea02))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>
- Antony Rizzitelli <upd4ting@gmail.com>

## v0.0.2

### 🩹 Fixes

- Visibility handling ([6542f42](https://github.com/AntelopeJS/file-storage-s3/commit/6542f42))
- The original file name is now properly sent/retreived ([#1](https://github.com/AntelopeJS/file-storage-s3/pull/1))
- Empty filename in return ([#2](https://github.com/AntelopeJS/file-storage-s3/pull/2))
- Typo in install command key ([8baf007](https://github.com/AntelopeJS/file-storage-s3/commit/8baf007))

### 💅 Refactors

- Metadata.filename and filename were coexisting ([#3](https://github.com/AntelopeJS/file-storage-s3/pull/3))

### 🏡 Chore

- Import ([f17bf1c](https://github.com/AntelopeJS/file-storage-s3/commit/f17bf1c))
- Remove dist ([431573c](https://github.com/AntelopeJS/file-storage-s3/commit/431573c))
- Lint ([9b6c6b2](https://github.com/AntelopeJS/file-storage-s3/commit/9b6c6b2))
- Use new ImplementInterface ([0e49c02](https://github.com/AntelopeJS/file-storage-s3/commit/0e49c02))
- Replicate ai agent config files (.agents/.claude) ([#4](https://github.com/AntelopeJS/file-storage-s3/pull/4))
- Remove ci publish adopt guidelines strict ts interface tests ([#5](https://github.com/AntelopeJS/file-storage-s3/pull/5))
- Simplify CI workflow triggers and update AGENTS.md ([bacb92f](https://github.com/AntelopeJS/file-storage-s3/commit/bacb92f))
- Migrate from eslint and prettier to biome ([#6](https://github.com/AntelopeJS/file-storage-s3/pull/6))
- Migrate from local beta interfaces to published @antelopejs packages ([44fd84b](https://github.com/AntelopeJS/file-storage-s3/commit/44fd84b))

### 🤖 CI

- Remove test:coverage step from CI workflow ([6eb2bb2](https://github.com/AntelopeJS/file-storage-s3/commit/6eb2bb2))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Glastis ([@Glastis](http://github.com/Glastis))
