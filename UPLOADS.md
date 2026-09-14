# Create-only uploads and canonical promotion

`CreateUploadUrl` allocates a UUID key and signs `If-None-Match: *` for every PUT, including staged uploads and explicitly selected public storage. Clients must send the returned `headers`, including `If-None-Match`. Removing or changing that signed condition invalidates the signature. The request and response interfaces are unchanged; no versioned bucket or seals API is required.

The first completed conditional PUT creates the object. A replay with identical or different bytes cannot overwrite an existing object and receives HTTP 412. Concurrent requests can also receive HTTP 409. This adapter only issues URLs: it does not upload, retry 409 responses, or remove conditions. Callers must preserve the condition on any retry. After a lost acknowledgement, a 412 response is not proof that the intended upload succeeded; reconcile through the application's authorized upload record.

## Coordinate storage privacy and expiry

Omitting a visibility override preserves legacy storage selection and public behavior. Applications that need private temporary uploads must select a genuinely private named storage, or request `visibility: "private"` with `attachmentPrivateBucket` configured. Explicit private overrides use the reserved `__visibility__/private/` namespace and require all four bucket public-access-block flags. Staging remains the outermost prefix. This adapter does not change bucket policies, ACLs, CORS, or lifecycle configuration.

Create-only protection lasts while the object exists. Deletion, lifecycle expiry, or promotion cleanup can allow an unexpired upload URL to recreate the source. Old URLs issued before this change can still overwrite their keys or supply reserved metadata until they expire. Drain old upload URLs before relying on the new guarantees. Unconditional writers with separate credentials bypass the condition.

Business logic must reject cancelled uploads independently of object existence and coordinate private orphan cleanup with every issued URL's expiry and in-flight uploads. Do not reuse allocated keys. A promotion already reading the source can finish after cancellation or source deletion; its final object remains private only when the caller selected private storage. Record successful promotion ownership durably before scheduling final-object cleanup. Already-issued signed read URLs remain usable until expiry while the object exists.

## Promote without replacing a destination

`PromoteFile` removes only the outer staging prefix. A non-staged key remains a no-op. The provider streams `GetObject` into a single conditional `PutObject` with `If-None-Match: *`, preserving visibility routing, MIME type, filename metadata, and standard content headers. Generic `MoveFile` retains its existing behavior and is not a no-clobber operation.

The provider reserves `antelope-promotion-*` metadata. Upload requests cannot set these fields: the presigner strips them case-insensitively and signs a fixed non-proof sentinel. Promotion writes an origin digest bound to bucket, source key, and destination key. A complete destination with that exact origin permits replay even when the source is gone. A foreign or incomplete destination raises `FileConflictError` (`FILE_CONFLICT`); absent source and destination raise `FileNotFoundError`. Other failures propagate unless the destination proves completed publication. Source cleanup runs only after destination verification; cleanup retries do not republish.

This proof relies on exclusive generated keys and trusted credential holders, not cryptographic protection from privileged writers. The digest is not secret. Arbitrary credentialed writes, key reuse, legacy signed URLs, and arbitrary moves into this namespace violate the ownership boundary. Moving an already-promoted object to another destination does not produce matching provenance there. Deleting a final object removes replay evidence; there is no cancellation registry or permanent tombstone.

Promotion transfers the object through the application server, increasing bandwidth, latency, and potential egress charges compared with server-side copying. Node streams provide backpressure; the provider does not buffer the entire object. A bounded intermediary stream and abort signal contain source errors without feeding them into the SDK checksum stream. Streams are not rewindable: failed streaming PUTs are not automatically replayed, and there is no unconditional or 409 retry fallback. A caller retry opens a new source stream after checking the final destination. The backend's single-PUT size limits still apply; this provider adds neither multipart promotion nor a new upload-size limit.

S3-compatible endpoints must enforce atomic conditional PUT and complete-object publication, with consistent HEAD/GET reads. CopyObject conditional behavior is not used for promotion. Emulator support is not proof that every compatible endpoint satisfies this contract.

## Browser CORS requirements

Before rolling out the new header, operators must ensure bucket CORS allows the application origin, the PUT method, and the `if-none-match` header together with `content-type`, metadata headers, and any SDK-required checksum headers. Otherwise the browser can reject the preflight before sending the PUT. JavaScript supplies `If-None-Match` from the response headers; the browser controls `Content-Length`. Expose `ETag` only if the application reads it; it is not a generation or ownership proof. CORS does not replace authorization.

See AWS documentation for [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) and [CORS evaluation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html). S3-compatible services must support and enforce conditional PUT; there is no fallback to an unconditional write.

## Verification

The existing Antelope runner includes the signature tests. They independently reconstruct the SigV4 HMAC with fake test credentials, confirm the valid signature, and show that omitted or altered condition headers produce a different signature. They do not send requests to AWS or claim to test AWS authentication responses. Existing tests continue to exercise legacy reads, public storage selection, moves, and promotion.

```sh
pnpm test
```

This branch requires the coordinated interface preview containing `internal.promoteFile` and `FileConflictError`, not merely the currently published baseline. Validation overlays the unpublished `interface-file-storage-promotion-preview.tgz` into ignored `node_modules/@antelopejs/interface-file-storage`; its SHA256 is `dabb3dc8750a705e9a317e0029f909256c3d40acff180139a35e6f619662edaa`. Package metadata retains the baseline version only for local integration. No published version or manifest dependency is fabricated; a clean registry-only install is not sufficient until the interface release is coordinated.

The separate HTTP suite requires a disposable local S3-compatible emulator. It creates randomly named buckets, configures a private bucket's public-access-block flags, and refuses non-loopback endpoints. It exercises first-writer-wins, byte-changing replay, concurrent PUTs, storage routing, deletion/recreation, canonical promotion, lost acknowledgements, competing promotions, cleanup failure, interrupted source streams, foreign or incomplete finals, provenance transplantation, and late private orphans. SDK fault injection supplies failures and delays while object operations use real local HTTP.

```sh
pnpm build
S3_UPLOAD_TEST_ENDPOINT=http://127.0.0.1:5005 \
  node --test scripts/test-uploads.mjs
```

Validation used Moto 5.2.3: 24 Antelope runner tests and 15 HTTP tests passed with zero skipped. Moto is an emulator, not AWS/R2 conditional-write, IAM, signature-rejection, privacy-policy, or browser CORS conformance evidence. A separate Moto probe ignored a conditional CopyObject and overwrote its destination, so that operation is not used as conformance evidence. No AWS account, public CORS setting, or shared storage was modified. Browser CORS and real backend rejection remain deployment checks. Restart the disposable emulator to discard its test buckets.
