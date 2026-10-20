import { NextResponse } from 'next/server';
import { ACTING_AS_HEADER, requireRoles } from '@core/route-guards';
import { DISPATCH_APPROVAL_READ_ROLES } from '@/backend/services/dispatchScope';
import { decideDispatchApproval } from '@/backend/services/dispatch/dispatchDecisionService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRoles(req, DISPATCH_APPROVAL_READ_ROLES);
  if ('response' in guard) return guard.response;
  const requestedAs = req.headers.get(ACTING_AS_HEADER);

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid dispatch ID.' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { verdict, remarks, version } = body;

    const result = await decideDispatchApproval(guard.user, requestedAs, BigInt(id), {
      verdict,
      remarks,
      version: Number(version),
    });

    if (result.error) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      );
    }

    return NextResponse.json(result.data, { status: result.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to process approver decision.' },
      { status: 500 }
    );
  }
}
