/**
 * Shared helpers for the Visuals loaders. The rules that keep the live system safe live here:
 * every query runs read-only with a statement timeout, and results are kept for a minute so repeated views and
 * concurrent viewers share one computation. Nothing is stored in the database.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { pkLocal } from '@/backend/core/sqlTime';
import { createTtlCache } from '@/backend/services/ttlCache';
import type { DayBasis, QtyPair } from '@/backend/modules/management-reporting/visuals/common';

export type VisualsDb = Prisma.TransactionClient;

/** A single query may run this long before PostgreSQL stops it. */
export const VISUALS_STATEMENT_TIMEOUT_MS = 8_000;
/** The figures are kept this long per tab and filter set. */
export const VISUALS_CACHE_MS = 60_000;
/** At most this many named rows (Mobile Testers, shops, suppliers …) are sent; the rest is added up as "Others". */
export const VISUALS_TOP_N = 50;

const cache = createTtlCache<unknown>({ ttlMs: VISUALS_CACHE_MS });

/** The same request within a minute is answered from memory; concurrent identical requests share one run. */
export function cachedVisual<T>(key: string, load: () => Promise<T>): Promise<T> {
  return cache.get(key, load) as Promise<T>;
}

/** Runs the loader in a read-only transaction with a statement timeout, so a heavy view can never hold the database. */
export async function runVisualsQuery<T>(load: (db: VisualsDb) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${VISUALS_STATEMENT_TIMEOUT_MS}`);
      return load(tx);
    },
    { timeout: VISUALS_STATEMENT_TIMEOUT_MS * 3, maxWait: 10_000 }
  );
}

const DAY_MS = 86_400_000;
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Days from first to last, both counted. */
export function dayCount(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
}

/** The period of the same length that ends the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const n = dayCount(from, to);
  const prevTo = dayMs(from) - DAY_MS;
  return { from: toDay(prevTo - (n - 1) * DAY_MS), to: toDay(prevTo) };
}

/** Every day key from `from` to `to`, so a chart shows the quiet days as zero instead of skipping them. */
export function allDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = dayMs(from), end = dayMs(to); t <= end; t += DAY_MS) out.push(toDay(t));
  return out;
}

/**
 * SQL for the day a timestamp falls on: the Pakistan calendar date, or the plant business day (08:00 to 08:00,
 * so 07:59 belongs to the day before).
 */
export function daySql(col: string, basis: DayBasis): Prisma.Sql {
  return basis === 'business'
    ? Prisma.sql`((${pkLocal(col)}) - interval '8 hours')::date`
    : Prisma.sql`(${pkLocal(col)})::date`;
}

/** Day key text (YYYY-MM-DD) for a date value read back from PostgreSQL. */
export function dayKey(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const qty = (liters: unknown, at13: unknown): QtyPair => ({ liters: round2(num(liters)), at13ts: round2(num(at13)) });
/** TS worked back from a pair: @13 TS × 13 / litres. */
export const tsOfPair = (p: QtyPair): number | null => (p.liters > 0 ? round2((p.at13ts * 13) / p.liters) : null);

/** The ZMCC sources in view: the picked ones that exist, or every ZMCC when none is picked. */
export async function resolveZmccIds(picked: string[]): Promise<bigint[]> {
  const ids = picked.filter((id) => /^\d{1,18}$/.test(id)).map((id) => BigInt(id));
  const rows = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', ...(ids.length ? { id: { in: ids } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Median of a list (null when empty). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
