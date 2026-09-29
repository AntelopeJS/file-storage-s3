/**
 * Lowercases metadata keys, as S3 and SigV4 canonicalise `x-amz-meta-*`
 * header names, and rejects keys that only differ by casing.
 *
 * @throws Error if two keys collide once lowercased
 */
export function normalizeMetadataKeys(
  metadata: Record<string, string> = {},
): Record<string, string> {
  const originalKeys = new Map<string, string>();
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowercaseKey = key.toLowerCase();
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
