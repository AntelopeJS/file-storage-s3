import { join } from "node:path";

import {
  equal,
  type App,
  type CallResult,
  type Check,
  type CommandResult,
  type HttpResult,
  type JourneyContext,
} from "@antelopejs/tooling-configs/verify";

import { canonical, isString, parseJson, pick, tuple, type Json } from "./json.ts";

export { pick, tuple, type Json } from "./json.ts";
export type ModuleConfig = NonNullable<NonNullable<Parameters<JourneyContext["fixture"]>[0]>["moduleConfig"]>;

export const PUBLIC_BUCKET = "public-bucket";
export const PRIVATE_BUCKET = "private-bucket";
export const ACCESS_KEY = "test-access-key";
export const SECRET_KEY = "test-secret-key";
export const SERVICE = "moto";
const CONTAINER_ENDPOINT = "http://localhost:5000";

const PREAMBLE = `import boto3, json
s3 = boto3.client("s3", endpoint_url="${CONTAINER_ENDPOINT}", region_name="us-east-1", aws_access_key_id="${ACCESS_KEY}", aws_secret_access_key="${SECRET_KEY}")
`;

const BLOCK_ALL = `{"BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True}`;

const PUBLIC_READ_POLICY = `json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::${PUBLIC_BUCKET}/*"}]})`;

export function endpointOf(context: JourneyContext): string {
  const moto = context.service(SERVICE);
  return `http://${moto.host}:${moto.port}`;
}

/** The module config pointing the default storage at the run's Moto container; `overrides` replace keys of the default storage. */
export function storageConfig(context: JourneyContext, overrides: ModuleConfig = {}): ModuleConfig {
  const endpoint = endpointOf(context);
  return {
    endpoint,
    region: "us-east-1",
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    bucket: PUBLIC_BUCKET,
    attachmentPrivateBucket: PRIVATE_BUCKET,
    publicUrl: `${endpoint}/${PUBLIC_BUCKET}`,
    defaultVisibility: "public",
    defaultUploadExpiration: 3600,
    defaultReadExpiration: 300,
    ...overrides,
  };
}

/** Runs a Python snippet with a boto3 client `s3` inside the Moto container, the second view every journey reads state back through. */
export function boto(context: JourneyContext, name: string, script: string): Promise<CommandResult> {
  return context.native(name, SERVICE, ["python", "-c", `${PREAMBLE}${script}`]);
}

/** Creates the public bucket (anonymous reads allowed) and the private bucket (every public-access-block flag on). */
export async function createBuckets(context: JourneyContext): Promise<void> {
  const created = await boto(
    context,
    "boto3 creates the buckets",
    `s3.create_bucket(Bucket="${PUBLIC_BUCKET}")
s3.create_bucket(Bucket="${PRIVATE_BUCKET}")
s3.put_public_access_block(Bucket="${PRIVATE_BUCKET}", PublicAccessBlockConfiguration=${BLOCK_ALL})
s3.put_bucket_policy(Bucket="${PUBLIC_BUCKET}", Policy=${PUBLIC_READ_POLICY})
print("created")
`,
  );
  context.expect(created.folder, [equal("the buckets were created", created.stdout.trim(), "created")], { critical: true });
}

export interface Stack {
  context: JourneyContext;
  app: App;
  endpoint: string;
}

/** Creates the buckets, writes the fixture project with `config` as the module config and starts `ajs project dev`. */
export async function startStack(context: JourneyContext, config?: ModuleConfig): Promise<Stack> {
  await createBuckets(context);
  const project = context.fixture({ moduleConfig: config ?? { default: storageConfig(context) } });
  const app = await context.dev("ajs-project-dev", project);
  return { context, app, endpoint: endpointOf(context) };
}

export function call(stack: Stack, name: string, path: string, args: Json[]): Promise<CallResult> {
  return stack.context.call(name, stack.app, { path: [path], args });
}

/** The name and message of the error a call threw, or `null` when it returned. */
export function thrown(result: CallResult): Json {
  return [pick(result.json, "error", "name") ?? null, pick(result.json, "error", "message") ?? null];
}

export function answered(result: CallResult): Check {
  return { name: "the call through core answered", pass: result.ok, detail: result.ok ? "ok" : `${result.body}` };
}

/** `equal` that ignores key order; an absent value, also inside an array, reads as `null`. */
export function same(name: string, actual: Json | undefined | (Json | undefined)[], expected: Json): Check {
  return equal(name, canonical(Array.isArray(actual) ? tuple(...actual) : actual), canonical(expected));
}

/** The headers a client must send with the PUT, by name. */
export interface UploadHeaders {
  [name: string]: string;
}

export interface Slot {
  uploadUrl: string;
  resourceKey: string;
  headers: UploadHeaders;
}

function headerRecord(value: Json | undefined): UploadHeaders {
  const headers: UploadHeaders = {};
  if (value === undefined || value === null || Array.isArray(value)) return headers;
  for (const name of Object.keys(value)) {
    const entry = pick(value, name);
    if (isString(entry)) headers[name] = entry;
  }
  return headers;
}

/** The upload slot a `CreateUploadUrl` answer holds, or `undefined` when the call threw. */
export function slotOf(result: CallResult): Slot | undefined {
  const uploadUrl = pick(result.value, "uploadUrl");
  const resourceKey = pick(result.value, "resourceKey");
  if (!isString(uploadUrl) || !isString(resourceKey)) return undefined;
  return { uploadUrl, resourceKey, headers: headerRecord(pick(result.value, "headers")) };
}

/** Sends `body` to the presigned URL as a browser would: one PUT with exactly the headers the module returned. Prints the HTTP status. */
export async function put(context: JourneyContext, name: string, slot: Slot, body: string): Promise<CommandResult> {
  const file = join(context.work, `${name.replace(/\W+/g, "-")}.bin`);
  context.edit(`${name} body`, file, body);
  const headers = Object.entries(slot.headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  return context.command(name, "curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT", ...headers, "--data-binary", `@${file}`, slot.uploadUrl]);
}

export function statusOf(result: CommandResult): string {
  return result.stdout.trim();
}

/** What boto3 sees of an object: its size, type, user metadata and body, or `null` when it does not exist. */
export async function objectInfo(context: JourneyContext, name: string, bucket: string, key: string): Promise<{ folder: string; info: Json }> {
  const read = await boto(
    context,
    name,
    `try:
    head = s3.head_object(Bucket="${bucket}", Key=${JSON.stringify(key)})
    body = s3.get_object(Bucket="${bucket}", Key=${JSON.stringify(key)})["Body"].read().decode()
    print(json.dumps({"size": head["ContentLength"], "type": head["ContentType"], "metadata": head["Metadata"], "body": body}))
except Exception:
    print("null")
`,
  );
  return { folder: read.folder, info: parseJson(read.stdout.trim()) };
}

/** Every key boto3 lists in a bucket, sorted. */
export async function keysIn(context: JourneyContext, name: string, bucket: string): Promise<{ folder: string; keys: Json }> {
  const read = await boto(
    context,
    name,
    `print(json.dumps(sorted(entry["Key"] for entry in s3.list_objects_v2(Bucket="${bucket}").get("Contents", []))))
`,
  );
  return { folder: read.folder, keys: parseJson(read.stdout.trim()) };
}

export function fetched(result: HttpResult): Json {
  return [result.status, result.body];
}
