import type { Journey } from "@antelopejs/tooling-configs/verify";

import { isString } from "./json.ts";
import { PUBLIC_BUCKET, answered, call, fetched, keysIn, objectInfo, pick, put, same, slotOf, startStack, statusOf, thrown } from "./session.ts";

const REPORT = { filename: "report.txt", size: 6, mimetype: "text/plain", path: "/reports/2026/", metadata: { Owner: "ada" } };

const objectsLifecycle: Journey = {
  title: "an uploaded file is found, described, readable through its URL, movable and deletable, and a missing file is reported as not found",
  entryPoint: "`FileExists`, `GetFileMetadata`, `CreateReadUrl`, `MoveFile` and `DeleteFile` through core",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [REPORT]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    context.expect(created.folder, [same("the key sits under the normalised path", slot.resourceKey.startsWith("reports/2026/"), true)]);
    const uploaded = await put(context, "PUT report", slot, "report");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")], { critical: true });
    const key = slot.resourceKey;

    const exists = await call(stack, "FileExists", "FileExists", [key]);
    const missing = await call(stack, "FileExists of an unknown key", "FileExists", ["reports/none.txt"]);
    context.expect(exists.folder, [same("the uploaded file exists", exists.value, true)]);
    context.expect(missing.folder, [same("an unknown key does not", missing.value, false)]);

    const described = await call(stack, "GetFileMetadata", "GetFileMetadata", [key]);
    context.expect(described.folder, [
      answered(described),
      same("the key, name, size and type are the stored ones", [pick(described.value, "resourceKey"), pick(described.value, "filename"), pick(described.value, "size"), pick(described.value, "mimetype")], [key, "report.txt", 6, "text/plain"]),
      same("the custom metadata comes back lowercased", pick(described.value, "metadata", "owner"), "ada"),
    ]);
    const absent = await call(stack, "GetFileMetadata of an unknown key", "GetFileMetadata", ["reports/none.txt"]);
    context.expect(absent.folder, [same("an unknown key is a FileNotFoundError", pick(thrown(absent), 0), "FileNotFoundError")]);

    const read = await call(stack, "CreateReadUrl", "CreateReadUrl", [key]);
    const url = pick(read.value, "url");
    context.expect(read.folder, [answered(read), same("the public URL is the configured public base plus the key", url, `${stack.endpoint}/${PUBLIC_BUCKET}/${key}`), same("a public URL does not expire", pick(read.value, "expiresAt") ?? null, null)]);
    if (isString(url)) {
      const fetchedBody = await context.http("GET the public URL", url);
      context.expect(fetchedBody.folder, [same("the URL serves the stored bytes", fetched(fetchedBody), [200, "report"])]);
    }

    const target = "archive/report.txt";
    const moved = await call(stack, "MoveFile", "MoveFile", [key, target]);
    context.expect(moved.folder, [answered(moved)]);
    const keys = await keysIn(context, "boto3 lists the public bucket after the move", PUBLIC_BUCKET);
    context.expect(keys.folder, [same("the object is at the destination only", keys.keys, [target])]);
    const copy = await objectInfo(context, "boto3 reads the moved object", PUBLIC_BUCKET, target);
    context.expect(copy.folder, [same("the move kept the bytes and the metadata", [pick(copy.info, "body"), pick(copy.info, "metadata", "owner")], ["report", "ada"])]);

    const removed = await call(stack, "DeleteFile", "DeleteFile", [target]);
    context.expect(removed.folder, [answered(removed)]);
    const after = await keysIn(context, "boto3 lists the public bucket after the delete", PUBLIC_BUCKET);
    context.expect(after.folder, [same("the bucket is empty", after.keys, [])]);
    const gone = await call(stack, "FileExists after the delete", "FileExists", [target]);
    context.expect(gone.folder, [same("the file no longer exists", gone.value, false)]);
  },
};

export const objectJourneys = { "objects-lifecycle": objectsLifecycle };
