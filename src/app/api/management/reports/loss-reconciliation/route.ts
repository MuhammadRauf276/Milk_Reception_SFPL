import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getSupplyChainLossHierarchy } from '@/backend/services/lossCalculationService';

export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(current.id) },
  });

  const allowedRoles = [
    'HEAD_OF_MPD',
    'SUPER_ADMIN',
    'EXECUTIVE_MANAGEMENT',
    'FINANCE_ACCOUNTS',
    'ZMCC_MANAGER',
    'DATA_EXECUTIVE',
    'QA_MANAGER',
    'QA_HEAD',
    'ADMIN',
  ];

  if (!user || !allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const rawPeriod = searchParams.get('period');
  const period = (rawPeriod === 'wtd' || rawPeriod === 'mtd' || rawPeriod === 'custom') ? rawPeriod : 'today';
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  let zmccId: string | undefined = undefined;
  if (user.role === 'ZMCC_MANAGER' && user.procurement_source_id) {
    zmccId = user.procurement_source_id.toString();
  } else if (searchParams.get('zmccId')) {
    zmccId = searchParams.get('zmccId') || undefined;
  }

  try {
    const result = await getSupplyChainLossHierarchy({
      period,
      from,
      to,
      zmccId,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to calculate supply chain loss report.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
