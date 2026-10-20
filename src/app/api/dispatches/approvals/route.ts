import { NextResponse } from 'next/server';
import { requireRoles } from '@core/route-guards';
import { DISPATCH_APPROVAL_READ_ROLES } from '@/backend/services/dispatchScope';
import { listDispatchApprovals } from '@/backend/services/dispatch/dispatchDecisionService';

export async function GET(req: Request) {
  const guard = await requireRoles(req, DISPATCH_APPROVAL_READ_ROLES);
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status')?.toUpperCase();
  const status = statusParam === 'DECIDED' ? 'DECIDED' : 'PENDING';

  const limitParam = searchParams.get('limit');
  const limit = limitParam && /^\d+$/.test(limitParam) ? parseInt(limitParam, 10) : undefined;

  try {
    const items = await listDispatchApprovals(guard.acting, { status, limit });
    return NextResponse.json({ items });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to list dispatch approvals' },
      { status: 500 }
    );
  }
}
