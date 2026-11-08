const UnreadableKey = "__proto__";

/**
 * Lowercases metadata keys, as S3 and SigV4 canonicalise `x-amz-meta-*`
 * header names, and rejects keys that only differ by casing.
 *
 * Rejects `__proto__` too: the AWS SDK parses `x-amz-meta-*` response headers
 * into a plain object, so a stored `__proto__` entry would never read back.
 *
 * @throws Error if two keys collide once lowercased, or a key lowercases to
 * `__proto__`
 */
export function normalizeMetadataKeys(metadata: Record<string, string> = {}) {
  const originalKeys = new Map<string, string>();
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowercaseKey = key.toLowerCase();
    if (lowercaseKey === UnreadableKey) {
      throw new Error(
        `Metadata key '${key}' is not supported: S3 clients cannot read back a metadata key named '${UnreadableKey}'`,
      );
    }
    const collidingKey = originalKeys.get(lowercaseKey);
    if (collidingKey !== undefined) {
      throw new Error(
        `Metadata keys '${collidingKey}' and '${key}' collide: S3 stores metadata keys in lowercase as '${lowercaseKey}'`,
      );
    }
    originalKeys.set(lowercaseKey, key);
    normalized[lowercaseKey] = value;
  }
  return normalized;
}
