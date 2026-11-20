import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { parseDateBasis } from '@/backend/core/business-day';
import { prisma } from '@/backend/core/db';
import { parseLossQuery, resolveLossRange } from '@/backend/services/lossCalculationService';
import { VISUAL_TABS, VISUALS_ROLES, type VisualTab, type VisualsQuery, type VisualsResponse } from '@/backend/modules/management-reporting/visuals/common';
import { VISUAL_LOADERS } from '@/backend/services/visuals/registry';
import { cachedVisual, dayCount, previousRange, resolveZmccIds, runVisualsQuery } from '@/backend/services/visuals/visualsCommon';

export const dynamic = 'force-dynamic';

const MAX_IDS = 200;

/**
 * Visuals page data, one tab at a time: the figures for the chosen days and for the same number of days before,
 * worked out in the database (daily rows only) and kept for a minute. Read-only.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tab: string }> }) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) }, select: { role: true, procurement_source_id: true } });
  if (!user || !(VISUALS_ROLES as readonly string[]).includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

  const tab = (await params).tab.toUpperCase() as VisualTab;
  if (!(VISUAL_TABS as readonly string[]).includes(tab)) return NextResponse.json({ error: 'Unknown view.' }, { status: 404 });

  const searchParams = new URL(req.url).searchParams;
  const parsed = parseLossQuery(searchParams, { role: user.role, managerZmccId: user.procurement_source_id, defaultPreset: 'LAST_30' });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const ids = (searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length > MAX_IDS || ids.some((id) => !/^\d{1,18}$/.test(id))) {
    return NextResponse.json({ error: 'The picked list is not valid.' }, { status: 400 });
  }

  try {
    const range = resolveLossRange(parsed.filters);
    const prev = previousRange(range.from, range.to);
    const basis = parseDateBasis(searchParams.get('basis'));
    const pickedZmccs = (parsed.filters.zmccIds ?? []).map(String);
    const zmccIds = await resolveZmccIds(pickedZmccs);
    const contractorIds = (parsed.filters.contractorIds ?? []).map((id) => BigInt(id));
    const base: Omit<VisualsQuery, 'from' | 'to'> = { basis, zmccIds, zmccPicked: pickedZmccs.length > 0, contractorIds, ids: [...ids].sort() };
    const load = VISUAL_LOADERS[tab];
    const run = (from: string, to: string) => {
      const q: VisualsQuery = { ...base, from, to };
      const key = JSON.stringify([tab, from, to, basis, zmccIds.map(String), contractorIds.map(String), q.ids]);
      return cachedVisual(key, () => runVisualsQuery((db) => load(q, db)));
    };
    const [cur, before] = await Promise.all([run(range.from, range.to), run(prev.from, prev.to)]);
    const body: VisualsResponse<unknown> = {
      meta: {
        tab,
        from: range.from,
        to: range.to,
        prevFrom: prev.from,
        prevTo: prev.to,
        basis,
        days: dayCount(range.from, range.to),
        computedAt: new Date().toISOString(),
      },
      current: cur,
      previous: before,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    console.error(`GET /api/management/visuals/${tab} error:`, error);
    const timedOut = error instanceof Error && /statement timeout|canceling statement/i.test(error.message);
    return NextResponse.json(
      { error: timedOut ? 'This view took too long. Pick fewer days or fewer ZMCCs.' : 'The figures could not be worked out.' },
      { status: timedOut ? 503 : 500 }
    );
  }
}
