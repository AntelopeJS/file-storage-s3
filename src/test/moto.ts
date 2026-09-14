import assert from "node:assert/strict";
import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const MotoEndpoint =
  process.env.S3_UPLOAD_TEST_ENDPOINT ?? "http://127.0.0.1:5005";
export const PublicBucket = "public-bucket";
export const PrivateBucket = "visibility-private-bucket";
export const PublicUrl = `${MotoEndpoint}/${PublicBucket}`;
export const TestCredentials = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

/** Provision only disposable loopback S3 storage for the module tests. */
export async function setupMoto(): Promise<void> {
  assert.ok(
    ["127.0.0.1", "localhost"].includes(new URL(MotoEndpoint).hostname),
    "Tests may only write local disposable storage",
  );
  const client = new S3Client({
    endpoint: MotoEndpoint,
    region: "us-east-1",
    credentials: TestCredentials,
    forcePathStyle: true,
  });
  try {
    for (const Bucket of [PublicBucket, PrivateBucket]) {
      await client.send(new CreateBucketCommand({ Bucket }));
    }
    await client.send(
      new PutPublicAccessBlockCommand({
        Bucket: PrivateBucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
    await allowPublicReads(client);
  } finally {
    client.destroy();
  }
}

async function allowPublicReads(client: S3Client): Promise<void> {
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: PublicBucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${PublicBucket}/*`,
          },
        ],
      }),
    }),
  );
}
