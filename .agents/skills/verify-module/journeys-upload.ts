import type { Journey } from "@antelopejs/tooling-configs/verify";

import { PUBLIC_BUCKET, answered, call, keysIn, objectInfo, pick, put, same, slotOf, startStack, statusOf, thrown } from "./session.ts";

const HELLO = { filename: "hello.txt", size: 5, mimetype: "text/plain", metadata: { TenantId: "t1" } };

const uploadPresigned: Journey = {
  title: "a presigned upload URL takes exactly the declared bytes with the returned headers, stores them with the declared type and lowercase metadata, and refuses a replay",
  entryPoint: "`CreateUploadUrl` through core, then a browser-style PUT with the returned headers",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [HELLO]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    context.expect(created.folder, [
      same("the key keeps the file extension", slot.resourceKey.endsWith(".txt"), true),
      same("the create-only condition is a header to send", slot.headers["If-None-Match"], "*"),
      same("the type and size are headers to send", [slot.headers["Content-Type"], slot.headers["Content-Length"]], ["text/plain", "5"]),
      same("the metadata key is lowercased in the header", slot.headers["x-amz-meta-tenantid"], "t1"),
    ]);
    const uploaded = await put(context, "PUT hello", slot, "hello");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")]);
    const stored = await objectInfo(context, "boto3 reads the object", PUBLIC_BUCKET, slot.resourceKey);
    context.expect(stored.folder, [
      same("the bytes are the ones sent", pick(stored.info, "body"), "hello"),
      same("size and type are the declared ones", [pick(stored.info, "size"), pick(stored.info, "type")], [5, "text/plain"]),
      same("the filename and the lowercased metadata are stored", [pick(stored.info, "metadata", "filename"), pick(stored.info, "metadata", "tenantid")], ["hello.txt", "t1"]),
    ]);
    const replay = await put(context, "PUT hello again", slot, "hello");
    context.expect(replay.folder, [same("a second PUT of the same URL is refused as a precondition failure", statusOf(replay), "412")]);
    const kept = await objectInfo(context, "boto3 reads the object after the replay", PUBLIC_BUCKET, slot.resourceKey);
    context.expect(kept.folder, [same("the first bytes are still stored", pick(kept.info, "body"), "hello")]);
  },
};

const uploadValidation: Journey = {
  title: "an upload over the size limit, outside the allowed types or with metadata keys that collide once lowercased is refused and leaves the bucket empty",
  entryPoint: "`CreateUploadUrl` with constraints, through core",
  async run(context) {
    const stack = await startStack(context);
    const tooBig = await call(stack, "CreateUploadUrl over the limit", "CreateUploadUrl", [{ filename: "big.bin", size: 11, mimetype: "application/octet-stream" }, { maxSize: 10 }]);
    context.expect(tooBig.folder, [
      same("the call was refused as an UploadValidationError", pick(thrown(tooBig), 0), "UploadValidationError"),
      same("the message names the size and the limit", pick(thrown(tooBig), 1), "File size 11 exceeds maximum allowed size 10"),
    ]);
    const wrongType = await call(stack, "CreateUploadUrl with a type outside the list", "CreateUploadUrl", [{ filename: "a.gif", size: 3, mimetype: "image/gif" }, { allowedMimetypes: ["image/png", "image/jpeg"] }]);
    context.expect(wrongType.folder, [
      same("the call was refused as an UploadValidationError", pick(thrown(wrongType), 0), "UploadValidationError"),
      same("the message lists the allowed types", pick(thrown(wrongType), 1), "MIME type 'image/gif' is not allowed. Allowed types: image/png, image/jpeg"),
    ]);
    const allowed = await call(stack, "CreateUploadUrl with an allowed type", "CreateUploadUrl", [{ filename: "a.png", size: 3, mimetype: "image/png" }, { allowedMimetypes: ["image/png"], maxSize: 3 }]);
    context.expect(allowed.folder, [answered(allowed), same("a request on the limit is accepted", slotOf(allowed) !== undefined, true)]);
    const collision = await call(stack, "CreateUploadUrl with colliding metadata", "CreateUploadUrl", [{ filename: "a.txt", size: 1, mimetype: "text/plain", metadata: { TenantId: "a", tenantid: "b" } }]);
    context.expect(collision.folder, [
      same("the call was refused", collision.ok, false),
      same("the message names both keys", pick(thrown(collision), 1), "Metadata keys 'TenantId' and 'tenantid' collide: S3 stores metadata keys in lowercase as 'tenantid'"),
    ]);
    const bucket = await keysIn(context, "boto3 lists the public bucket", PUBLIC_BUCKET);
    context.expect(bucket.folder, [same("nothing was stored", bucket.keys, [])]);
  },
};

export const uploadJourneys = { "upload-presigned": uploadPresigned, "upload-validation": uploadValidation };
