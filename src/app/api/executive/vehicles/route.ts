import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getPaginatedOperationalLogs } from '@/backend/services/operationalReadModelService';

const VEHICLES_PER_PAGE = 12;
const MAX_SEARCH_LENGTH = 100;

/**
 * Vehicles dispatched in the last 7 days, plus any still inside the plant, one page at a time. The window is fixed
 * here on purpose: 'recent' mode with no dates means the last 7 calendar days, and this route accepts no date from
 * the client.
 */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const params = new URL(req.url).searchParams;
  try {
    const result = await getPaginatedOperationalLogs(
      {
        mode: 'recent',
        includeStillInPlant: true,
        page: Number(params.get('page')) || 1,
        pageSize: VEHICLES_PER_PAGE,
        search: params.get('search')?.slice(0, MAX_SEARCH_LENGTH) || undefined,
      },
      null,
      { kind: 'ALL' }
    );
    return NextResponse.json(
      {
        items: result.items,
        pagination: result.pagination,
        fromDate: result.metadata.fromDate,
        toDate: result.metadata.toDate,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load vehicles' }, { status: 500 });
  }
}
