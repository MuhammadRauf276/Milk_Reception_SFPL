import { NextResponse } from 'next/server';
import { parseDateBasis } from '@/backend/core/business-day';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { parseLossQuery, resolveLossRange } from '@/backend/services/lossCalculationService';
import { getZmccStageChain } from '@/backend/services/zmccStageChainService';
import { generateStageChainExcel } from '@/backend/services/stageChainExcel';
import { getStageDrill } from '@/backend/services/zmccStageDrillService';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'EXECUTIVE_MANAGEMENT', 'FINANCE_ACCOUNTS', 'ZMCC_MANAGER', 'DATA_EXECUTIVE', 'QA_HEAD', 'ADMIN'];

/** Stage by stage as Excel, for the same filters as the screen. */
export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!user || !ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

  const searchParams = new URL(req.url).searchParams;
  const parsed = parseLossQuery(searchParams, { role: user.role, managerZmccId: user.procurement_source_id, defaultPreset: 'LAST_30' });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  try {
    const range = resolveLossRange(parsed.filters);
    const zmccIds = (parsed.filters.zmccIds ?? []).map(String);
    const basis = parseDateBasis(searchParams.get('basis'));
    const args = { from: range.from, to: range.to, zmccIds, basis };
    const [report, testers, routes, hc] = await Promise.all([
      getZmccStageChain(args),
      getStageDrill({ ...args, level: 'TESTER' }),
      getStageDrill({ ...args, level: 'ROUTE' }),
      getStageDrill({ ...args, level: 'HC' }),
    ]);
    const filterText = zmccIds.length ? report.zmccs.map((z) => z.zmccName).join(', ') || 'Chosen ZMCCs' : 'All ZMCCs';
    const buffer = await generateStageChainExcel(report, filterText, {
      testers: testers.testers ?? [],
      routes: routes.routes ?? [],
      hcSuppliers: hc.hcSuppliers ?? [],
    });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Milk_Stages_${report.from}_${report.to}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    console.error('GET /api/management/reports/loss-reconciliation/stages/export error:', error);
    return NextResponse.json({ error: 'The Excel file could not be made.' }, { status: 500 });
  }
}
