import {
  GetBucketAclCommand,
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  type Grant,
  type S3Client,
} from "@aws-sdk/client-s3";

const NotImplementedStatusCode = 501;
const NotImplementedErrorName = "NotImplemented";
const NoBucketPolicyErrorName = "NoSuchBucketPolicy";
const PublicGranteeUris = new Set([
  "http://acs.amazonaws.com/groups/global/AllUsers",
  "http://acs.amazonaws.com/groups/global/AuthenticatedUsers",
]);
const validatedBuckets = new WeakMap<S3Client, Set<string>>();

type BucketVerifier = (client: S3Client, bucket: string) => Promise<void>;

function isPropertyHolder(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

interface NamedError<Name extends string> {
  name: Name;
}

interface StatusCodeError<StatusCode extends number> {
  $metadata: { httpStatusCode: StatusCode };
}

function hasName<Name extends string>(
  error: unknown,
  name: Name,
): error is NamedError<Name> {
  return isPropertyHolder(error) && "name" in error && error.name === name;
}

function hasStatusCode<StatusCode extends number>(
  error: unknown,
  statusCode: StatusCode,
): error is StatusCodeError<StatusCode> {
  if (!isPropertyHolder(error) || !("$metadata" in error)) return false;
  const metadata = error.$metadata;
  return (
    isPropertyHolder(metadata) &&
    "httpStatusCode" in metadata &&
    metadata.httpStatusCode === statusCode
  );
}

type NotImplementedError =
  | NamedError<typeof NotImplementedErrorName>
  | StatusCodeError<typeof NotImplementedStatusCode>;

function isNotImplementedError(error: unknown): error is NotImplementedError {
  return (
    hasName(error, NotImplementedErrorName) ||
    hasStatusCode(error, NotImplementedStatusCode)
  );
}

function isErrorLike(error: unknown): error is object {
  return typeof error === "object" && error !== null;
}

function isPolicyStatusUnavailable(
  error: unknown,
): error is NotImplementedError | NamedError<typeof NoBucketPolicyErrorName> {
  return (
    isNotImplementedError(error) || hasName(error, NoBucketPolicyErrorName)
  );
}

function isPublicGrant(grant: Grant): boolean {
  return PublicGranteeUris.has(grant.Grantee?.URI ?? "");
}

async function verifyPublicAccessBlock(
  client: S3Client,
  bucket: string,
): Promise<void> {
  const response = await client.send(
    new GetPublicAccessBlockCommand({ Bucket: bucket }),
  );
  const block = response.PublicAccessBlockConfiguration;
  if (
    !block?.BlockPublicAcls ||
    !block.IgnorePublicAcls ||
    !block.BlockPublicPolicy ||
    !block.RestrictPublicBuckets
  )
    throw new Error(`Bucket '${bucket}' must block all public access`);
}

async function hasPublicAclGrant(
  client: S3Client,
  bucket: string,
): Promise<boolean> {
  try {
    const response = await client.send(
      new GetBucketAclCommand({ Bucket: bucket }),
    );
    return (response.Grants ?? []).some(isPublicGrant);
  } catch (error: unknown) {
    if (isErrorLike(error) && isNotImplementedError(error)) return false;
    throw error;
  }
}

async function isBucketReportedPublic(
  client: S3Client,
  bucket: string,
): Promise<boolean> {
  try {
    const response = await client.send(
      new GetBucketPolicyStatusCommand({ Bucket: bucket }),
    );
    return response.PolicyStatus?.IsPublic === true;
  } catch (error: unknown) {
    if (isErrorLike(error) && isPolicyStatusUnavailable(error)) return false;
    throw error;
  }
}

async function verifyPolicyStatus(
  client: S3Client,
  bucket: string,
): Promise<void> {
  if (await isBucketReportedPublic(client, bucket))
    throw new Error(`Bucket '${bucket}' is reported public by its policy`);
}

async function verifyAcl(client: S3Client, bucket: string): Promise<void> {
  if (await hasPublicAclGrant(client, bucket))
    throw new Error(`Bucket '${bucket}' grants public access through its ACL`);
}

async function verifyAssumedPrivacy(
  client: S3Client,
  bucket: string,
): Promise<void> {
  await verifyAcl(client, bucket);
  await verifyPolicyStatus(client, bucket);
}

/**
 * Ensures a bucket is safe to hold private objects, once per client and bucket.
 * Strict mode requires all four public access block flags. When the operator
 * assumes private buckets, the bucket is rejected if its ACL grants access to
 * all users or to any authenticated user, or if its policy status is reported
 * public. Providers that do not implement either call are tolerated.
 */
export async function assertPrivateBucket(
  client: S3Client,
  bucket: string,
  isPrivacyAssumed: boolean,
): Promise<void> {
  const validated = validatedBuckets.get(client) ?? new Set<string>();
  validatedBuckets.set(client, validated);
  if (validated.has(bucket)) return;
  const verify: BucketVerifier = isPrivacyAssumed
    ? verifyAssumedPrivacy
    : verifyPublicAccessBlock;
  await verify(client, bucket);
  validated.add(bucket);
}
