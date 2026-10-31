import type { Journey } from "@antelopejs/tooling-configs/verify";

import { PUBLIC_BUCKET, answered, boto, call, keysIn, objectInfo, pick, put, same, slotOf, startStack, statusOf, thrown } from "./session.ts";

const STAGED = { filename: "photo.png", size: 5, mimetype: "image/png", metadata: { Owner: "ada" }, staging: true };

const promoteStaged: Journey = {
  title: "a staged upload is promoted out of staging: the final key drops the prefix, the bytes and metadata move, the staged copy is gone, and promoting a regular key changes nothing",
  entryPoint: "`CreateUploadUrl` with `staging: true`, then `PromoteFile`, through core",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl staged", "CreateUploadUrl", [STAGED]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    context.expect(created.folder, [same("the key is under the staging prefix", slot.resourceKey.startsWith("__staging__/"), true)]);
    const uploaded = await put(context, "PUT photo", slot, "photo");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")], { critical: true });
    const promoted = await call(stack, "PromoteFile", "PromoteFile", [slot.resourceKey]);
    const finalKey = slot.resourceKey.slice("__staging__/".length);
    context.expect(promoted.folder, [answered(promoted), same("the final key is the staged key without its prefix", pick(promoted.value, "resourceKey"), finalKey)]);
    const keys = await keysIn(context, "boto3 lists the public bucket", PUBLIC_BUCKET);
    context.expect(keys.folder, [same("only the final object remains", keys.keys, [finalKey])]);
    const final = await objectInfo(context, "boto3 reads the promoted object", PUBLIC_BUCKET, finalKey);
    context.expect(final.folder, [
      same("the bytes and type moved", [pick(final.info, "body"), pick(final.info, "type")], ["photo", "image/png"]),
      same("the filename and metadata moved", [pick(final.info, "metadata", "filename"), pick(final.info, "metadata", "owner")], ["photo.png", "ada"]),
    ]);
    const again = await call(stack, "PromoteFile again", "PromoteFile", [slot.resourceKey]);
    context.expect(again.folder, [answered(again), same("promoting again after the cleanup replays the same key", pick(again.value, "resourceKey"), finalKey)]);
    const regular = await call(stack, "PromoteFile of a regular key", "PromoteFile", [finalKey]);
    const kept = await keysIn(context, "boto3 lists the public bucket after the no-op", PUBLIC_BUCKET);
    context.expect(regular.folder, [answered(regular), same("a regular key answers itself", pick(regular.value, "resourceKey"), finalKey)]);
    context.expect(kept.folder, [same("nothing moved", kept.keys, [finalKey])]);
  },
};

const promoteConflict: Journey = {
  title: "promoting onto a destination somebody else already wrote is refused with FileConflictError, and the staged upload stays",
  entryPoint: "`PromoteFile` of a staged key whose final key already holds a foreign object",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl staged", "CreateUploadUrl", [STAGED]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    const uploaded = await put(context, "PUT photo", slot, "photo");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")], { critical: true });
    const finalKey = slot.resourceKey.slice("__staging__/".length);
    const planted = await boto(context, "boto3 writes a foreign object at the final key", `s3.put_object(Bucket="${PUBLIC_BUCKET}", Key=${JSON.stringify(finalKey)}, Body=b"foreign")\nprint("planted")\n`);
    context.expect(planted.folder, [same("the foreign object is there", planted.stdout.trim(), "planted")], { critical: true });
    const refused = await call(stack, "PromoteFile onto a foreign object", "PromoteFile", [slot.resourceKey]);
    context.expect(refused.folder, [same("the call was refused as a FileConflictError", pick(thrown(refused), 0), "FileConflictError")]);
    const foreign = await objectInfo(context, "boto3 reads the final key", PUBLIC_BUCKET, finalKey);
    const staged = await objectInfo(context, "boto3 reads the staged key", PUBLIC_BUCKET, slot.resourceKey);
    context.expect(foreign.folder, [same("the foreign object was not overwritten", pick(foreign.info, "body"), "foreign")]);
    context.expect(staged.folder, [same("the staged upload is still there", pick(staged.info, "body"), "photo")]);
  },
};

export const stagingJourneys = { "promote-staged": promoteStaged, "promote-conflict": promoteConflict };
