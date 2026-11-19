import { NextResponse } from 'next/server';
import { parseDateBasis } from '@/backend/core/business-day';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { parseLossQuery, resolveLossRange } from '@/backend/services/lossCalculationService';
import { getStageDrill } from '@/backend/services/zmccStageDrillService';
import type { StageDrillLevel } from '@/backend/modules/management-reporting/stageChainContracts';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'EXECUTIVE_MANAGEMENT', 'FINANCE_ACCOUNTS', 'ZMCC_MANAGER', 'DATA_EXECUTIVE', 'QA_HEAD', 'ADMIN'];
const LEVELS: StageDrillLevel[] = ['TESTER', 'ROUTE', 'HC'];

/** Mobile Testers, routes or HC suppliers for the same filters as Stage by stage. ?level=TESTER|ROUTE|HC */
export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!user || !ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

  const searchParams = new URL(req.url).searchParams;
  const level = (searchParams.get('level') ?? '').toUpperCase() as StageDrillLevel;
  if (!LEVELS.includes(level)) return NextResponse.json({ error: 'Pick Mobile Tester, route or HC supplier.' }, { status: 400 });
  const parsed = parseLossQuery(searchParams, { role: user.role, managerZmccId: user.procurement_source_id, defaultPreset: 'LAST_30' });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  try {
    const range = resolveLossRange(parsed.filters);
    const drill = await getStageDrill({
      level,
      from: range.from,
      to: range.to,
      zmccIds: (parsed.filters.zmccIds ?? []).map(String),
      basis: parseDateBasis(searchParams.get('basis')),
    });
    return NextResponse.json({ drill }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    console.error('GET /api/management/reports/loss-reconciliation/stages/drill error:', error);
    return NextResponse.json({ error: 'These figures could not be calculated.' }, { status: 500 });
  }
}
