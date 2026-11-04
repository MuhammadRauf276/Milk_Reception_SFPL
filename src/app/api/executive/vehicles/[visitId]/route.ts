import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getOperationalVisitLogs } from '@/backend/services/operationalReadModelService';

/** All portions of one visit, for opening Inspect from a report row. */
export async function GET(req: Request, ctx: { params: Promise<{ visitId: string }> }) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const { visitId } = await ctx.params;
  if (!/^\d+$/.test(visitId)) {
    return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  }
  const items = await getOperationalVisitLogs(BigInt(visitId));
  if (items.length === 0) {
    return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  }
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } });
}
