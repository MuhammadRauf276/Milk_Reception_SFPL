import { NextResponse } from 'next/server';
import { prisma } from '@core/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health check endpoint for client-side API reachability and database availability probing.
 * Tests DB connectivity with a strict 2.5-second timeout boundary.
 *
 * NOTE / KNOWN LIMITATION: Prisma client and pg driver do not support runtime cancellation
 * tokens for in-flight queries. A query that times out cannot be forcibly cancelled at the driver
 * level; its promise rejection is safely handled to prevent unhandled rejections, and PostgreSQL's
 * server-side statement_timeout governs eventual execution cancellation on the backend.
 */
export async function GET() {
  type DbCheckResult =
    | { ok: true }
    | { ok: false; reason: 'timeout' | 'unavailable'; error: string };

  const checkDb = async (): Promise<DbCheckResult> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT')), 2500);
      });

      // Guard raw query with local error capture and safe detached catch
      const queryPromise = prisma.$queryRawUnsafe('SELECT 1');
      // Detached catch ensures no unhandled rejection if timeout triggers before query settles
      queryPromise.catch(() => {});

      await Promise.race([queryPromise, timeoutPromise]);
      return { ok: true };
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.message === 'TIMEOUT';
      return {
        ok: false,
        reason: isTimeout ? 'timeout' : 'unavailable',
        error: isTimeout ? 'Database check timed out after 2.5s' : 'Database connection failed',
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  const dbStatus = await checkDb();

  if (!dbStatus.ok) {
    return NextResponse.json(
      {
        status: 'degraded',
        database: dbStatus.reason,
        error: dbStatus.error,
        timestamp: Date.now(),
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  }

  return NextResponse.json(
    {
      status: 'ok',
      database: 'connected',
      timestamp: Date.now(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}
