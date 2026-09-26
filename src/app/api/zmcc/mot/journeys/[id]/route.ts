import { NextResponse } from 'next/server';
import { resolveMotAuth, getMotJourneyById } from '@/backend/services/motService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const result = await getMotJourneyById(auth!, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ journey: result.data });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching MOT journey.' }, { status: 500 });
  }
}
