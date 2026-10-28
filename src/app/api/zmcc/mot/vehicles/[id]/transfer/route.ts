import { NextResponse } from 'next/server';
import { resolveMotAuth, transferMotVehicle } from '@/backend/services/motService';
import { getErrorMessage } from '@/lib/errors';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'TRANSFER_VEHICLE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const targetZmccId = body.target_zmcc_id || body.targetZmccId;
    if (!targetZmccId) {
      return NextResponse.json({ error: 'Target ZMCC ID (target_zmcc_id) is required.' }, { status: 400 });
    }

    const result = await transferMotVehicle(auth!, id, String(targetZmccId));
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ vehicle: result.data }, { status: result.status });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) || 'An unexpected error occurred while transferring Mobile Tester vehicle.' }, { status: 500 });
  }
}
