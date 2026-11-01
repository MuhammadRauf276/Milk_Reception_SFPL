import { NextResponse } from 'next/server';
import { prisma } from '@core/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health check endpoint for client-side API reachability and database availability probing.
 * Tests DB connectivity with a strict 2.5-second timeout boundary.
 *
 * NOTE / DOCUMENTED DRIVER LIMITATION:
 * Promise.race() does NOT cancel the underlying Prisma query or close its PostgreSQL socket
 * when the timeout branch wins. In the Node.js pg driver / Prisma engine, in-flight queries
 * continue running on the server until completion or until cancelled by the server-side
 * PostgreSQL `statement_timeout`. Detached promise error suppression (.catch(() => {}))
 * is attached to the in-flight query promise to ensure that subsequent query settlement or
 * connection failure does not cause an unhandled promise rejection at process level.
 * We do NOT claim driver-level query cancellation.
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
