import assert from "node:assert/strict";
import {
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { assertPrivateBucket } from "../implementations/file-storage/private-bucket";

const Bucket = "private-bucket";
const NotImplementedStatus = 501;
const ForbiddenStatus = 403;
const NotFoundStatus = 404;
const FullBlock = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};

type CommandHandler = () => Promise<unknown>;

interface ProviderBehavior {
  publicAccessBlock?: CommandHandler;
  policyStatus?: CommandHandler;
}

interface MockProvider {
  client: S3Client;
  sentCommands: string[];
}

function providerError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode },
  });
}

function rejectWith(name: string, httpStatusCode: number): CommandHandler {
  return () => Promise.reject(providerError(name, httpStatusCode));
}

function resolveWith(response: unknown): CommandHandler {
  return () => Promise.resolve(response);
}

function createMockProvider(behavior: ProviderBehavior): MockProvider {
  const sentCommands: string[] = [];
  const unexpected = rejectWith("UnexpectedCommand", NotImplementedStatus);
  const send = (command: unknown): Promise<unknown> => {
    sentCommands.push(String(command?.constructor.name));
    if (command instanceof GetPublicAccessBlockCommand)
      return (behavior.publicAccessBlock ?? unexpected)();
    if (command instanceof GetBucketPolicyStatusCommand)
      return (behavior.policyStatus ?? unexpected)();
    return unexpected();
  };
  const client = Object.assign(new S3Client({ region: "us-east-1" }), {
    send,
  });
  return { client, sentCommands };
}

describe("private bucket verification", () => {
  describe("strict mode (default)", () => {
    it("accepts a bucket blocking all public access", async () => {
      const provider = createMockProvider({
        publicAccessBlock: resolveWith({
          PublicAccessBlockConfiguration: FullBlock,
        }),
      });

      await assertPrivateBucket(provider.client, Bucket, false);

      assert.deepEqual(provider.sentCommands, ["GetPublicAccessBlockCommand"]);
    });

    it("rejects a bucket missing a public access block flag", async () => {
      const provider = createMockProvider({
        publicAccessBlock: resolveWith({
          PublicAccessBlockConfiguration: {
            ...FullBlock,
            RestrictPublicBuckets: false,
          },
        }),
      });

      await assert.rejects(
        assertPrivateBucket(provider.client, Bucket, false),
        /must block all public access/,
      );
    });

    it("keeps failing when the provider does not implement the check", async () => {
      const provider = createMockProvider({
        publicAccessBlock: rejectWith("NotImplemented", NotImplementedStatus),
      });

      await assert.rejects(
        assertPrivateBucket(provider.client, Bucket, false),
        { name: "NotImplemented" },
      );
    });

    it("verifies each bucket once per client", async () => {
      const provider = createMockProvider({
        publicAccessBlock: resolveWith({
          PublicAccessBlockConfiguration: FullBlock,
        }),
      });

      await assertPrivateBucket(provider.client, Bucket, false);
      await assertPrivateBucket(provider.client, Bucket, false);

      assert.equal(provider.sentCommands.length, 1);
    });
  });

  describe("assumed private buckets", () => {
    it("skips the public access block verification", async () => {
      const provider = createMockProvider({
        publicAccessBlock: rejectWith("NotImplemented", NotImplementedStatus),
        policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
      });

      await assertPrivateBucket(provider.client, Bucket, true);

      assert.deepEqual(provider.sentCommands, ["GetBucketPolicyStatusCommand"]);
    });

    it("rejects a bucket whose policy status is reported public", async () => {
      const provider = createMockProvider({
        policyStatus: resolveWith({ PolicyStatus: { IsPublic: true } }),
      });

      await assert.rejects(
        assertPrivateBucket(provider.client, Bucket, true),
        /reported public/,
      );
    });

    it("continues when the policy status is not implemented", async () => {
      const provider = createMockProvider({
        policyStatus: rejectWith("NotImplemented", NotImplementedStatus),
      });

      await assertPrivateBucket(provider.client, Bucket, true);
    });

    it("continues when the provider answers 501 under another name", async () => {
      const provider = createMockProvider({
        policyStatus: rejectWith("UnknownError", NotImplementedStatus),
      });

      await assertPrivateBucket(provider.client, Bucket, true);
    });

    it("continues when the bucket has no policy", async () => {
      const provider = createMockProvider({
        policyStatus: rejectWith("NoSuchBucketPolicy", NotFoundStatus),
      });

      await assertPrivateBucket(provider.client, Bucket, true);
    });

    it("propagates other policy status failures", async () => {
      const provider = createMockProvider({
        policyStatus: rejectWith("AccessDenied", ForbiddenStatus),
      });

      await assert.rejects(assertPrivateBucket(provider.client, Bucket, true), {
        name: "AccessDenied",
      });
    });
  });
});
