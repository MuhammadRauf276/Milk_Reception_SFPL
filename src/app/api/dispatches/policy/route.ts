import { NextResponse } from 'next/server';
import { requireRoles } from '@core/route-guards';
import { DISPATCH_READ_ROLES, type DispatchPoint } from '@/backend/services/dispatchScope';
import { loadDispatchPolicy } from '@/backend/services/dispatch/dispatchDecisionService';

export async function GET(req: Request) {
  const guard = await requireRoles(req, DISPATCH_READ_ROLES);
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const point = searchParams.get('point');

  if (point !== 'ZMCC_DISPATCH' && point !== 'CONTRACTOR_DISPATCH') {
    return NextResponse.json(
      { error: "Invalid dispatch testing point. Expected 'ZMCC_DISPATCH' or 'CONTRACTOR_DISPATCH'." },
      { status: 400 }
    );
  }

  try {
    const snapshot = await loadDispatchPolicy(point as DispatchPoint);
    return NextResponse.json(snapshot);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to load dispatch policy' },
      { status: 500 }
    );
  }
}
