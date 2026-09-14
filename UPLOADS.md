# Create-only uploads

`CreateUploadUrl` allocates a UUID key and signs `If-None-Match: *` for every PUT, including staged uploads and explicitly selected public storage. Clients must send the returned `headers`, including `If-None-Match`. Removing or changing that signed condition invalidates the signature. The request and response interfaces are unchanged; no versioned bucket or seals API is required.

The first completed conditional PUT creates the object. A replay with identical or different bytes cannot overwrite an existing object and receives HTTP 412. Concurrent requests can also receive HTTP 409. This adapter only issues URLs: it does not upload, retry 409 responses, or remove conditions. Callers must preserve the condition on any retry. After a lost acknowledgement, a 412 response is not proof that the intended upload succeeded; reconcile through the application's authorized upload record.

## Coordinate storage privacy and expiry

Storage selection and public behavior remain unchanged. Applications that need private temporary uploads must pass a private named storage to `CreateUploadUrl` and ensure its bucket actually denies public access. `staging: true` only selects a key prefix; it does not make a public bucket private. This change does not alter bucket policies, ACLs, CORS, lifecycle configuration, or the independent attachment provider.

Create-only protection lasts while the object exists. Deletion, lifecycle expiry, or the existing `PromoteFile` copy-and-delete flow can allow an unexpired upload URL to recreate the source. Old URLs issued before this change can still overwrite their keys until they expire. Unconditional writers with separate credentials also bypass the condition.

Business logic must reject cancelled uploads independently of object existence and coordinate private orphan cleanup with every issued URL's expiry and in-flight uploads. Do not reuse allocated keys. Retaining private temporary objects until upload URLs expire avoids reopening those keys to replay. `MoveFile` and `PromoteFile` are unchanged and do not gain no-clobber publication or ownership reconciliation guarantees from this change.

## Browser CORS requirements

Before rolling out the new header, operators must ensure bucket CORS allows the application origin, the PUT method, and the `if-none-match` header together with `content-type`, metadata headers, and any SDK-required checksum headers. Otherwise the browser can reject the preflight before sending the PUT. JavaScript supplies `If-None-Match` from the response headers; the browser controls `Content-Length`. Expose `ETag` only if the application reads it; it is not a generation or ownership proof. CORS does not replace authorization.

See AWS documentation for [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) and [CORS evaluation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html). S3-compatible services must support and enforce conditional PUT; there is no fallback to an unconditional write.

## Verification

The existing Antelope runner includes the signature tests. They independently reconstruct the SigV4 HMAC with fake test credentials, confirm the valid signature, and show that omitted or altered condition headers produce a different signature. They do not send requests to AWS or claim to test AWS authentication responses. Existing tests continue to exercise legacy reads, public storage selection, moves, and promotion.

```sh
pnpm install --frozen-lockfile
pnpm test
```

The separate HTTP suite requires a disposable local S3-compatible emulator. It creates fresh randomly named buckets without enabling versioning and refuses non-loopback endpoints. It exercises first-writer-wins, identical/different-byte replays, concurrent PUTs, named private storage selection without writes to the default bucket, and the deletion/recreation limitation.

```sh
pnpm build
S3_UPLOAD_TEST_ENDPOINT=http://127.0.0.1:5005 \
  node --test scripts/test-uploads.mjs
```

Validation used Moto 5.2.3: 22 Antelope runner tests and 4 HTTP tests passed with zero skipped. Moto is an emulator, not AWS conditional-write, IAM, signature-rejection, privacy-policy, or browser CORS conformance evidence. No AWS account, public CORS setting, or shared storage was modified. Browser CORS and real AWS rejection remain deployment checks. Restart the disposable emulator to discard its test buckets.
