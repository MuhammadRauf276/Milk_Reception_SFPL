import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Lightweight health check endpoint for client-side API reachability probing.
 * Responds in <5ms without database queries or session token validation.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
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
