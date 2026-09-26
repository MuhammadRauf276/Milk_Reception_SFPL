import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { getZmccManagerOverview } from '@/backend/services/zmccManagerOverviewService';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sourceId = user.procurement_source_id;
  if (user.role !== 'SUPER_ADMIN' && (!sourceId || !user.procurement_source || user.procurement_source.source_type !== 'ZMCC')) {
    return NextResponse.json({ error: 'An assigned active ZMCC source is required.' }, { status: 403 });
  }

  const requestedSource = new URL(req.url).searchParams.get('sourceId');
  const trustedSourceId = user.role === 'SUPER_ADMIN' && requestedSource ? requestedSource : sourceId;
  if (!trustedSourceId) return NextResponse.json({ error: 'Select a ZMCC source.' }, { status: 400 });

  const access = await requireCapability('VIEW', { kind: 'SOURCE', sourceId: trustedSourceId }, { request: req });
  if (!access.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });

  try {
    return NextResponse.json({ overview: await getZmccManagerOverview(BigInt(trustedSourceId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load ZMCC manager overview.' }, { status: 500 });
  }
}
