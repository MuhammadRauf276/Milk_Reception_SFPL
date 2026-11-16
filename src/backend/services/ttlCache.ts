/**
 * A small in-process cache with a short lifetime. Concurrent callers for the same key share one computation, and a
 * failed computation is never kept. The clock can be replaced so tests do not need to wait.
 */
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createTtlCache<T>(options: { ttlMs: number; now?: () => number }): TtlCache<T> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      const value = load();
      entries.set(key, { expiresAt: now() + options.ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
