import { Prisma } from '@prisma/client';
import { prisma } from '@/backend/core/db';

/** Longest a single report aggregation may run before the database cancels it. */
export const REPORT_STATEMENT_TIMEOUT_MS = 20_000;

export class ReportTimeoutError extends Error {
  constructor() {
    super('This report took too long to build. Narrow the date range or pick one ZMCC and try again.');
    this.name = 'ReportTimeoutError';
  }
}

function isStatementTimeout(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ''}` : String(error);
  return /57014|statement timeout|canceling statement/i.test(text);
}

/**
 * Runs read-only report queries in one transaction with a statement timeout (SET LOCAL, so it ends with the
 * transaction). A timeout surfaces as a ReportTimeoutError with a plain message.
 */
export async function withReportTimeout<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  timeoutMs: number = REPORT_STATEMENT_TIMEOUT_MS
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(Math.max(1, Math.floor(timeoutMs)))}, true)`;
        return run(tx);
      },
      { timeout: timeoutMs + 5_000, maxWait: 5_000 }
    );
  } catch (error) {
    if (isStatementTimeout(error)) throw new ReportTimeoutError();
    throw error;
  }
}

/** The longest date range a history report may read in one request. */
export const MAX_REPORT_RANGE_DAYS = 366;

/** Plain message when a requested range is too long; null when it is fine (or open-ended, which the caller defaults). */
export function reportRangeError(from: string | undefined, to: string | undefined, today: string, maxDays = MAX_REPORT_RANGE_DAYS): string | null {
  if (!from) return null;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to || today}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 86400000 > maxDays ? `Pick a range of at most ${maxDays} days.` : null;
}
