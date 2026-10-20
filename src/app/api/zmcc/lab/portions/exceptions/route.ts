import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listLabPortionExceptions } from '@/backend/services/zmcc/labPortionReviewService';

export async function GET(req: Request) {
  try {
    // Zonal Manager queue (superiors by delegation; Data Executive may only read via its own screens).
    const guard = await requireRoles(req, ['ZMCC_MANAGER', 'DATA_EXECUTIVE']);
    if ('response' in guard) return guard.response;

    const url = new URL(req.url);
    const status = url.searchParams.get('status')?.toUpperCase() === 'DECIDED' ? 'DECIDED' : 'PENDING';
    const items = await listLabPortionExceptions(guard.acting, { status });
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error('GET /api/zmcc/lab/portions/exceptions error:', err);
    return NextResponse.json({ error: 'Failed to load lab exceptions.' }, { status: 500 });
  }
}
