import assert from "node:assert/strict";
import {
  GetBucketAclCommand,
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
const AllUsersGroup = "http://acs.amazonaws.com/groups/global/AllUsers";
const AuthenticatedUsersGroup =
  "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
const OwnerGrant = {
  Grantee: { ID: "owner-id", Type: "CanonicalUser" },
  Permission: "FULL_CONTROL",
};
const OwnerOnlyAcl = { Grants: [OwnerGrant] };

type CommandHandler = () => Promise<unknown>;

interface ProviderBehavior {
  publicAccessBlock?: CommandHandler;
  acl?: CommandHandler;
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

function aclGrantingGroup(uri: string, permission: string): unknown {
  return {
    Grants: [
      OwnerGrant,
      { Grantee: { Type: "Group", URI: uri }, Permission: permission },
    ],
  };
}

function createMockProvider(behavior: ProviderBehavior): MockProvider {
  const sentCommands: string[] = [];
  const unexpected = rejectWith("UnexpectedCommand", NotImplementedStatus);
  const send = (command: unknown): Promise<unknown> => {
    sentCommands.push(String(command?.constructor.name));
    if (command instanceof GetPublicAccessBlockCommand)
      return (behavior.publicAccessBlock ?? unexpected)();
    if (command instanceof GetBucketAclCommand)
      return (behavior.acl ?? resolveWith(OwnerOnlyAcl))();
    if (command instanceof GetBucketPolicyStatusCommand)
      return (behavior.policyStatus ?? unexpected)();
    return unexpected();
  };
  const client = Object.assign(new S3Client({ region: "us-east-1" }), {
    send,
  });
  return { client, sentCommands };
}

function strictModeSuite(): void {
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

    await assert.rejects(assertPrivateBucket(provider.client, Bucket, false), {
      name: "NotImplemented",
    });
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
}

function assumedAclSuite(): void {
  it("skips the public access block verification", async () => {
    const provider = createMockProvider({
      publicAccessBlock: rejectWith("NotImplemented", NotImplementedStatus),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assertPrivateBucket(provider.client, Bucket, true);

    assert.deepEqual(provider.sentCommands, [
      "GetBucketAclCommand",
      "GetBucketPolicyStatusCommand",
    ]);
  });

  it("accepts a bucket whose ACL only grants its owner", async () => {
    const provider = createMockProvider({
      acl: resolveWith(OwnerOnlyAcl),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assertPrivateBucket(provider.client, Bucket, true);
  });

  it("rejects a bucket whose ACL grants all users", async () => {
    const provider = createMockProvider({
      acl: resolveWith(aclGrantingGroup(AllUsersGroup, "READ")),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assert.rejects(
      assertPrivateBucket(provider.client, Bucket, true),
      /grants public access through its ACL/,
    );
  });

  it("rejects a bucket whose ACL grants any authenticated user", async () => {
    const provider = createMockProvider({
      acl: resolveWith(aclGrantingGroup(AuthenticatedUsersGroup, "WRITE")),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assert.rejects(
      assertPrivateBucket(provider.client, Bucket, true),
      /grants public access through its ACL/,
    );
  });

  it("continues when the ACL is not implemented", async () => {
    const provider = createMockProvider({
      acl: rejectWith("NotImplemented", NotImplementedStatus),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assertPrivateBucket(provider.client, Bucket, true);

    assert.deepEqual(provider.sentCommands, [
      "GetBucketAclCommand",
      "GetBucketPolicyStatusCommand",
    ]);
  });

  it("propagates other ACL failures", async () => {
    const provider = createMockProvider({
      acl: rejectWith("AccessDenied", ForbiddenStatus),
      policyStatus: resolveWith({ PolicyStatus: { IsPublic: false } }),
    });

    await assert.rejects(assertPrivateBucket(provider.client, Bucket, true), {
      name: "AccessDenied",
    });
  });
}

function assumedPolicyStatusSuite(): void {
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
}

describe("private bucket verification", () => {
  describe("strict mode (default)", strictModeSuite);
  describe("assumed private buckets", () => {
    assumedAclSuite();
    assumedPolicyStatusSuite();
  });
});
