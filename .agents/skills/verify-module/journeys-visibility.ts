import type { Journey } from "@antelopejs/tooling-configs/verify";

import { isNumber, isString } from "./json.ts";
import { PRIVATE_BUCKET, PUBLIC_BUCKET, answered, boto, call, createBuckets, keysIn, objectInfo, pick, put, same, slotOf, startStack, statusOf, storageConfig, thrown } from "./session.ts";

const SECRET_FILE = { filename: "secret.txt", size: 6, mimetype: "text/plain", visibility: "private" };

const privateRouting: Journey = {
  title: "a file uploaded with visibility private lands in the private bucket under the reserved prefix, is read through a signed expiring URL and never appears in the public bucket",
  entryPoint: "`CreateUploadUrl` and `CreateReadUrl` with `visibility: private`, through core",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl private", "CreateUploadUrl", [SECRET_FILE]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    context.expect(created.folder, [same("the key is under the reserved private prefix", slot.resourceKey.startsWith("__visibility__/private/"), true)]);
    const uploaded = await put(context, "PUT secret", slot, "secret");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")], { critical: true });
    const stored = await objectInfo(context, "boto3 reads the private object", PRIVATE_BUCKET, slot.resourceKey);
    context.expect(stored.folder, [same("the private bucket holds the bytes", pick(stored.info, "body"), "secret")]);
    const publicKeys = await keysIn(context, "boto3 lists the public bucket", PUBLIC_BUCKET);
    context.expect(publicKeys.folder, [same("the public bucket holds nothing", publicKeys.keys, [])]);
    const read = await call(stack, "CreateReadUrl private", "CreateReadUrl", [slot.resourceKey, 120]);
    const url = pick(read.value, "url");
    const expiresAt = pick(read.value, "expiresAt");
    context.expect(read.folder, [
      answered(read),
      same("the URL is signed", isString(url) && url.includes("X-Amz-Signature="), true),
      same("the URL points at the private bucket", isString(url) && url.includes(`/${PRIVATE_BUCKET}/`), true),
      same("the URL expires", isNumber(expiresAt) && expiresAt > Date.now(), true),
    ]);
    if (isString(url)) {
      const fetchedBody = await context.http("GET the signed URL", url);
      context.expect(fetchedBody.folder, [same("the signed URL serves the bytes", [fetchedBody.status, fetchedBody.body], [200, "secret"])]);
    }
    const exists = await call(stack, "FileExists private", "FileExists", [slot.resourceKey]);
    context.expect(exists.folder, [same("FileExists finds it in the private bucket", exists.value, true)]);
  },
};

const privateBucketGuard: Journey = {
  title: "a private upload is refused while the private bucket leaves any public access flag off, and nothing is stored",
  entryPoint: "`CreateUploadUrl` with `visibility: private` against a bucket that blocks only three of the four public access flags",
  async run(context) {
    await createBuckets(context);
    const created = await boto(
      context,
      "boto3 creates a bucket that does not restrict public buckets",
      `s3.create_bucket(Bucket="partial-bucket")
s3.put_public_access_block(Bucket="partial-bucket", PublicAccessBlockConfiguration={"BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": False})
print("created")
`,
    );
    context.expect(created.folder, [same("the partial bucket exists", created.stdout.trim(), "created")], { critical: true });
    const project = context.fixture({ moduleConfig: { default: storageConfig(context, { attachmentPrivateBucket: "partial-bucket" }) } });
    const app = await context.dev("ajs-project-dev", project);
    const stack = { context, app, endpoint: "" };
    const refused = await call(stack, "CreateUploadUrl private", "CreateUploadUrl", [SECRET_FILE]);
    context.expect(refused.folder, [same("the call was refused", refused.ok, false), same("the message says the bucket must block all public access", pick(thrown(refused), 1), "Bucket 'partial-bucket' must block all public access")]);
    const keys = await keysIn(context, "boto3 lists the partial bucket", "partial-bucket");
    context.expect(keys.folder, [same("nothing was stored", keys.keys, [])]);
    const publicUpload = await call(stack, "CreateUploadUrl public", "CreateUploadUrl", [{ filename: "open.txt", size: 4, mimetype: "text/plain" }]);
    context.expect(publicUpload.folder, [answered(publicUpload), same("a public upload still works", slotOf(publicUpload) !== undefined, true)]);
  },
};

export const visibilityJourneys = { "private-routing": privateRouting, "private-bucket-guard": privateBucketGuard };
