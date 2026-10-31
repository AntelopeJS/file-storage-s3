import type { Journey } from "@antelopejs/tooling-configs/verify";

import { PUBLIC_BUCKET, answered, call, objectInfo, pick, put, same, slotOf, startStack, statusOf } from "./session.ts";

const uploadThroughMoto: Journey = {
  title: "a consumer asks for an upload URL, a client PUTs the bytes, and boto3 finds them in the bucket",
  entryPoint: "`CreateUploadUrl` through core against Moto",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [{ filename: "smoke.txt", size: 5, mimetype: "text/plain" }]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    const uploaded = await put(context, "PUT smoke", slot, "smoke");
    context.expect(uploaded.folder, [same("the storage accepted the upload", statusOf(uploaded), "200")]);
    const stored = await objectInfo(context, "boto3 reads the object", PUBLIC_BUCKET, slot.resourceKey);
    context.expect(stored.folder, [same("the bytes are the ones sent", pick(stored.info, "body"), "smoke")]);
  },
};

export const smokeJourneys = { "upload-through-moto": uploadThroughMoto };
