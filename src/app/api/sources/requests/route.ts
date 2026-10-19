import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { createErpCodeRequest } from '@/backend/services/milkSourceService';

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const zmccId = body.zmcc_id || user.procurement_source_id;
    if (!zmccId) {
      return NextResponse.json({ error: 'zmcc_id is required.' }, { status: 400 });
    }

    const proposedName = body.proposed_name?.trim();
    if (!proposedName) {
      return NextResponse.json({ error: 'proposed_name is required.' }, { status: 400 });
    }

    const result = await createErpCodeRequest(BigInt(user.id), {
      zmcc_id: zmccId,
      proposed_name: proposedName,
      proposed_code: body.proposed_code,
      request_context: body.request_context,
      notes: body.notes,
    });

    return NextResponse.json({ request: result }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to submit ERP code request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
