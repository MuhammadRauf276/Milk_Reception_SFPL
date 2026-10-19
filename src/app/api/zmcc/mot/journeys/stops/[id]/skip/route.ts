import { NextResponse } from 'next/server';
import { resolveMotAuth, skipJourneyStop } from '@/backend/services/motService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'SKIP_STOP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const skipReason = typeof body.skip_reason === 'string' ? body.skip_reason : typeof body.reason === 'string' ? body.reason : '';
    const result = await skipJourneyStop(auth!, id, skipReason);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ stop: result.data, data: result.data });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while skipping journey stop.' }, { status: 500 });
  }
}
