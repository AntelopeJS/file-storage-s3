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

interface ErrorMetadata {
  httpStatusCode?: number;
}

interface ErrorLike {
  name?: string;
  $metadata?: ErrorMetadata;
}

type BucketVerifier = (client: S3Client, bucket: string) => Promise<void>;

function isNotImplementedError(error: ErrorLike): boolean {
  return (
    error.name === NotImplementedErrorName ||
    error.$metadata?.httpStatusCode === NotImplementedStatusCode
  );
}

function isErrorLike(error: unknown): error is ErrorLike {
  return typeof error === "object" && error !== null;
}

function isAclUnavailable(error: unknown): boolean {
  return isErrorLike(error) && isNotImplementedError(error);
}

function isPolicyStatusUnavailable(error: unknown): boolean {
  return (
    isErrorLike(error) &&
    (isNotImplementedError(error) || error.name === NoBucketPolicyErrorName)
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
    if (isAclUnavailable(error)) return false;
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
    if (isPolicyStatusUnavailable(error)) return false;
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
