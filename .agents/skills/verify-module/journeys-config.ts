import type { Journey } from "@antelopejs/tooling-configs/verify";

import { parseJson } from "./json.ts";
import { PUBLIC_BUCKET, endpointOf, answered, boto, call, createBuckets, pick, same, slotOf, startStack, storageConfig, thrown } from "./session.ts";

const lifecycleRule: Journey = {
  title: "with stagingExpirationDays the module adds one expiration rule for the staging prefix at start and keeps the bucket's other rules",
  entryPoint: "`ajs project dev` with `stagingExpirationDays: 3` on a bucket that already has a lifecycle rule",
  async run(context) {
    await createBuckets(context);
    const prepared = await boto(
      context,
      "boto3 adds an unrelated lifecycle rule",
      `s3.put_bucket_lifecycle_configuration(Bucket="${PUBLIC_BUCKET}", LifecycleConfiguration={"Rules": [{"ID": "keep-logs", "Status": "Enabled", "Filter": {"Prefix": "logs/"}, "Expiration": {"Days": 30}}]})\nprint("prepared")\n`,
    );
    context.expect(prepared.folder, [same("the existing rule is in place", prepared.stdout.trim(), "prepared")], { critical: true });
    const project = context.fixture({ moduleConfig: { default: storageConfig(context, { stagingExpirationDays: 3 }) } });
    await context.dev("ajs-project-dev", project);
    const rules = await boto(
      context,
      "boto3 reads the lifecycle rules",
      `rules = s3.get_bucket_lifecycle_configuration(Bucket="${PUBLIC_BUCKET}")["Rules"]\nprint(json.dumps(sorted([[rule["ID"], rule["Filter"]["Prefix"], rule["Expiration"]["Days"], rule["Status"]] for rule in rules])))\n`,
    );
    context.expect(rules.folder, [
      same("the staging rule was added beside the existing one", parseJson(rules.stdout.trim()), [
        ["antelopejs-staging-expiration", "__staging__/", 3, "Enabled"],
        ["keep-logs", "logs/", 30, "Enabled"],
      ]),
    ]);
  },
};

const namedStorage: Journey = {
  title: "a call that names a configured storage uses that storage's bucket, and an unknown storage is refused",
  entryPoint: "`CreateUploadUrl` with a storage id, through core",
  async run(context) {
    await createBuckets(context);
    const media = await boto(context, "boto3 creates the media bucket", `s3.create_bucket(Bucket="media-bucket")\nprint("created")\n`);
    context.expect(media.folder, [same("the media bucket exists", media.stdout.trim(), "created")], { critical: true });
    const stack = await startStack(context, { default: storageConfig(context), storages: { media: storageConfig(context, { bucket: "media-bucket", publicUrl: `${endpointOf(context)}/media-bucket` }) } });
    const named = await call(stack, "CreateUploadUrl on media", "CreateUploadUrl", [{ filename: "m.txt", size: 1, mimetype: "text/plain" }, null, "media"]);
    const slot = slotOf(named);
    context.expect(named.folder, [answered(named), same("the upload URL targets the media bucket", slot?.uploadUrl.includes("/media-bucket/"), true)]);
    const regular = await call(stack, "CreateUploadUrl on the default storage", "CreateUploadUrl", [{ filename: "d.txt", size: 1, mimetype: "text/plain" }]);
    context.expect(regular.folder, [same("without a storage id the default bucket is used", slotOf(regular)?.uploadUrl.includes(`/${PUBLIC_BUCKET}/`), true)]);
    const unknown = await call(stack, "CreateUploadUrl on an unknown storage", "CreateUploadUrl", [{ filename: "u.txt", size: 1, mimetype: "text/plain" }, null, "nowhere"]);
    context.expect(unknown.folder, [same("the call was refused naming the storage", pick(thrown(unknown), 1), "Storage 'nowhere' not found in configuration")]);
  },
};

export const configJourneys = { "lifecycle-rule": lifecycleRule, "named-storage": namedStorage };
