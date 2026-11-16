import { parseDateBasis } from '@/backend/core/business-day';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import {
  getSupplyChainLossHierarchy,
  generateLossReconciliationExcel,
  parseLossQuery,
} from '@/backend/services/lossCalculationService';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = [
  'HEAD_OF_MPD',
  'SUPER_ADMIN',
  'EXECUTIVE_MANAGEMENT',
  'FINANCE_ACCOUNTS',
  'ZMCC_MANAGER',
  'DATA_EXECUTIVE',
  'QA_HEAD',
  'ADMIN',
];

/** The same filters as the report itself; one sheet per level plus a Summary. */
export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(current.id) },
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const parsed = parseLossQuery(searchParams, {
    role: user.role,
    managerZmccId: user.procurement_source_id,
    defaultPreset: 'LAST_30',
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  try {
    const data = await getSupplyChainLossHierarchy({
      ...parsed.filters,
      dateBasis: parseDateBasis(searchParams.get('basis')),
    });

    const excelBuffer = await generateLossReconciliationExcel(data);
    const filename = `Loss_Gain_Report_${data.levels.filters.from}_${data.levels.filters.to}.xlsx`;

    return new Response(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to generate Excel export.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
