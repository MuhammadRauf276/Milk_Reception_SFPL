import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listMotShopExceptions } from '@/backend/services/mot/motShopReviewService';

export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, ['ZMCC_MANAGER']);
    if ('response' in guard) return guard.response;

    const url = new URL(req.url);
    const status = url.searchParams.get('status')?.toUpperCase() === 'DECIDED' ? 'DECIDED' : 'PENDING';
    const items = await listMotShopExceptions(guard.acting, { status });
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error('GET /api/zmcc/mot/collections/exceptions error:', err);
    return NextResponse.json({ error: 'Failed to load shop exceptions.' }, { status: 500 });
  }
}
