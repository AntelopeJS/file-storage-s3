import {
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

const NotImplementedStatusCode = 501;
const NotImplementedErrorName = "NotImplemented";
const NoBucketPolicyErrorName = "NoSuchBucketPolicy";
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

function isPolicyStatusUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const candidate = error as ErrorLike;
  return (
    isNotImplementedError(candidate) ||
    candidate.name === NoBucketPolicyErrorName
  );
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

/**
 * Ensures a bucket is safe to hold private objects, once per client and bucket.
 * Strict mode requires all four public access block flags. When the operator
 * assumes private buckets, only a policy status reported public is rejected.
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
    ? verifyPolicyStatus
    : verifyPublicAccessBlock;
  await verify(client, bucket);
  validated.add(bucket);
}
