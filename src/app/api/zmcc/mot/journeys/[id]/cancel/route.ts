import { NextResponse } from 'next/server';
import { resolveMotAuth, cancelMotJourney } from '@/backend/services/motService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'CANCEL_JOURNEY');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const reason = body.reason || body.cancellation_reason || '';
    const result = await cancelMotJourney(auth!, id, reason);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ journey: result.data });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while cancelling journey.' }, { status: 500 });
  }
}
