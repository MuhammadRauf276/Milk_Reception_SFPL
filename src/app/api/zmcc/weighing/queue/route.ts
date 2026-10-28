import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listWeighingQueue, WEIGHING_ROLES } from '@/backend/services/zmccTankService';

export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    const url = new URL(req.url);
    const donePage = Number(url.searchParams.get('done_page') || 1);
    const range = (url.searchParams.get('range') as 'today' | '7days' | 'custom') || 'today';
    const fromDate = url.searchParams.get('from_date') || undefined;
    const toDate = url.searchParams.get('to_date') || undefined;
    const search = url.searchParams.get('search') || undefined;

    const result = await listWeighingQueue(guard.acting, {
      donePage: Number.isFinite(donePage) ? donePage : 1,
      range,
      fromDate,
      toDate,
      search,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/weighing/queue error:', err);
    return NextResponse.json({ error: 'Failed to load the weighing list.' }, { status: 500 });
  }
}
