import { parseDateBasis } from '@/backend/core/business-day';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getSupplyChainLossHierarchy, parseLossQuery } from '@/backend/services/lossCalculationService';

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

/**
 * Loss / Gain: MOT, Area, Transit (At ZMCC, On road), Whole and Contractor Transit, with the older tier figures beside them.
 * Filters: preset (TODAY, YESTERDAY, LAST_7, LAST_30, MTD) or from / to (Pakistan dates, up to 366 days), zmccIds,
 * contractorIds, motProfileId. A ZMCC manager is always locked to their own ZMCC.
 */
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
    const result = await getSupplyChainLossHierarchy({
      ...parsed.filters,
      dateBasis: parseDateBasis(searchParams.get('basis')),
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to calculate the loss report.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
