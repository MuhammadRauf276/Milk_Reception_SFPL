import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { listCorrectionRequests } from '@/backend/services/correctionGovernanceService';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Resolvers (Data Executive, Super Admin) and the MPD Head see every ticket.
  // Everyone else sees only the tickets they raised themselves.
  const seesAll = ['DATA_EXECUTIVE', 'SUPER_ADMIN', 'HEAD_OF_MPD'].includes(user.role);

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'ALL';
  const moduleName = url.searchParams.get('module') || 'ALL';
  const sourceIdStr = url.searchParams.get('sourceId');
  const sourceId = sourceIdStr && /^\d+$/.test(sourceIdStr) ? BigInt(sourceIdStr) : null;

  try {
    const items = await listCorrectionRequests({
      status,
      module: moduleName,
      sourceId: seesAll ? sourceId : null,
      requestedByUserId: seesAll ? null : BigInt(user.id),
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error('GET /api/corrections error:', err);
    return NextResponse.json({ error: 'Failed to fetch correction requests.' }, { status: 500 });
  }
}
