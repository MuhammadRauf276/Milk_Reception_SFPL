import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { prisma } from '@/backend/core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getZmccManagerOverview } from '@/backend/services/zmccManagerOverviewService';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // A Zonal Manager sees their own ZMCC. A system-wide superior covering the Zonal Manager station
  // (Super Admin, Data Executive, MPD Head) has no ZMCC of their own, so the one they picked is used.
  const ownSourceId =
    user.procurement_source_id && user.procurement_source?.source_type === 'ZMCC' ? user.procurement_source_id : null;
  const isSystemSuperior = !ownSourceId && canActAs(user.role, 'ZMCC_MANAGER');
  if (!ownSourceId && !isSystemSuperior) {
    return NextResponse.json({ error: 'An assigned active ZMCC source is required.' }, { status: 403 });
  }

  let trustedSourceId: string | null = ownSourceId ? String(ownSourceId) : null;
  if (isSystemSuperior) {
    const params = new URL(req.url).searchParams;
    const requested = (params.get('sourceId') || params.get('zmccId') || req.headers.get('x-acting-source-id') || '').trim();
    if (!/^\d+$/.test(requested)) return NextResponse.json({ error: 'Select a ZMCC source.' }, { status: 400 });
    const found = await prisma.procurementSource.findFirst({
      where: { id: BigInt(requested), is_active: true, source_type: 'ZMCC' },
      select: { id: true },
    });
    if (!found) return NextResponse.json({ error: 'Select a ZMCC source.' }, { status: 400 });
    trustedSourceId = found.id.toString();
  }
  if (!trustedSourceId) return NextResponse.json({ error: 'Select a ZMCC source.' }, { status: 400 });

  const access = await requireCapability('VIEW', { kind: 'SOURCE', sourceId: trustedSourceId }, { request: req });
  if (!access.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });

  try {
    return NextResponse.json({ overview: await getZmccManagerOverview(BigInt(trustedSourceId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load ZMCC manager overview.' }, { status: 500 });
  }
}
