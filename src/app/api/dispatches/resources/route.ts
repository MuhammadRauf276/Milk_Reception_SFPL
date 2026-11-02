import { NextResponse } from 'next/server';
import { requireRoles } from '@core/route-guards';
import { DISPATCH_READ_ROLES } from '@/backend/services/dispatchScope';
import { getDispatchResources } from '@/backend/services/dispatch/dispatchResourceService';

export async function GET(req: Request) {
  const guard = await requireRoles(req, DISPATCH_READ_ROLES);
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const sourceIdParam = searchParams.get('sourceId');

  if (!sourceIdParam) {
    return NextResponse.json(
      { error: 'Query parameter sourceId is required.' },
      { status: 400 }
    );
  }

  let sourceId: bigint;
  try {
    sourceId = BigInt(sourceIdParam);
  } catch {
    return NextResponse.json(
      { error: 'Invalid sourceId format.' },
      { status: 400 }
    );
  }

  try {
    const resources = await getDispatchResources(sourceId);
    return NextResponse.json(resources);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to load dispatch resources.' },
      { status: 500 }
    );
  }
}
