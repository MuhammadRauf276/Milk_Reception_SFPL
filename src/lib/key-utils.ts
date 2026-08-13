/**
 * Reusable Key & Array Normalization Helpers
 */

/**
 * Normalizes an array of items by ensuring each item has a unique string key.
 */
export function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  if (!Array.isArray(items)) return [];
  const map = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Development-only duplicate key detector.
 * Logs warnings if duplicate React keys are passed to a component renderer.
 */
export function warnDuplicateKeys(label: string, keys: string[]): void {
  if (process.env.NODE_ENV !== 'production') {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const key of keys) {
      if (seen.has(key)) {
        duplicates.add(key);
      } else {
        seen.add(key);
      }
    }

    if (duplicates.size > 0) {
      console.warn(`[React Duplicate Key Warning: ${label}] Found duplicate key(s):`, Array.from(duplicates));
    }
  }
}
