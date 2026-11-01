import { NextResponse } from 'next/server';
import { prisma } from '@core/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health check endpoint for client-side API reachability and database availability probing.
 * Tests DB connectivity with a strict 2.5-second timeout boundary.
 */
export async function GET() {
  const checkDb = async (): Promise<boolean> => {
    try {
      const dbPromise = prisma.$queryRawUnsafe('SELECT 1');
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database check timeout')), 2500)
      );
      await Promise.race([dbPromise, timeoutPromise]);
      return true;
    } catch {
      return false;
    }
  };

  const dbOk = await checkDb();

  if (!dbOk) {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'disconnected',
        error: 'Database unavailable',
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
