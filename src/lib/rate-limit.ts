/**
 * Minimal in-memory failure counter (per server process).
 * Good enough for a single-node deployment; use a shared store (Redis/DB) if you scale out.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Seconds until `key` may try again, or 0 if it is not currently blocked. */
export function blockedForSeconds(key: string, max: number): number {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return 0;
  return bucket.count >= max ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
}

export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    bucket.count += 1;
  }
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || 'unknown';
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
