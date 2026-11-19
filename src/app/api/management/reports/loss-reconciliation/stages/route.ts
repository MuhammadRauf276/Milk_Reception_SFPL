import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { parseLossQuery, resolveLossRange } from '@/backend/services/lossCalculationService';
import { getZmccStageChain } from '@/backend/services/zmccStageChainService';

export const dynamic = 'force-dynamic';

// The same people who see Loss / Gain. A ZMCC manager is locked to their own ZMCC.
const ALLOWED_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'EXECUTIVE_MANAGEMENT', 'FINANCE_ACCOUNTS', 'ZMCC_MANAGER', 'DATA_EXECUTIVE', 'QA_HEAD', 'ADMIN'];

/** Stage by stage per ZMCC: shops, ZMCC intake, tank, dispatch slip, plant; same filters as Loss / Gain. */
export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!user || !ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

  const parsed = parseLossQuery(new URL(req.url).searchParams, {
    role: user.role,
    managerZmccId: user.procurement_source_id,
    defaultPreset: 'LAST_30',
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  try {
    const range = resolveLossRange(parsed.filters);
    const report = await getZmccStageChain({
      from: range.from,
      to: range.to,
      zmccIds: (parsed.filters.zmccIds ?? []).map(String),
    });
    return NextResponse.json({ report }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    console.error('GET /api/management/reports/loss-reconciliation/stages error:', error);
    return NextResponse.json({ error: 'Stage by stage figures could not be calculated.' }, { status: 500 });
  }
}
