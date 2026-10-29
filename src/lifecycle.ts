import { STAGING_PREFIX } from "@antelopejs/interface-file-storage";
import {
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
  PutBucketLifecycleConfigurationCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

const StagingLifecycleRuleId = "antelopejs-staging-expiration";
const NoLifecycleConfigErrorName = "NoSuchLifecycleConfiguration";
const EnabledStatus = "Enabled";

interface NoLifecycleConfigError {
  name: typeof NoLifecycleConfigErrorName;
}

function isNoLifecycleConfigError(
  error: unknown,
): error is NoLifecycleConfigError {
  if (typeof error !== "object" || !error) {
    return false;
  }
  return "name" in error && error.name === NoLifecycleConfigErrorName;
}

async function getExistingRules(
  client: S3Client,
  bucket: string,
): Promise<LifecycleRule[]> {
  try {
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    return response.Rules ?? [];
  } catch (error: unknown) {
    if (isNoLifecycleConfigError(error)) {
      return [];
    }
    throw error;
  }
}

function buildStagingRule(expirationDays: number): LifecycleRule {
  return {
    ID: StagingLifecycleRuleId,
    Status: EnabledStatus,
    Filter: { Prefix: STAGING_PREFIX },
    Expiration: { Days: expirationDays },
  };
}

export async function applyStagingLifecycleRule(
  client: S3Client,
  bucket: string,
  expirationDays: number,
): Promise<void> {
  const existingRules = await getExistingRules(client, bucket);
  const otherRules = existingRules.filter(
    (rule) => rule.ID !== StagingLifecycleRuleId,
  );
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [...otherRules, buildStagingRule(expirationDays)],
      },
    }),
  );
}
