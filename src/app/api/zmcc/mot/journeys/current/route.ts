import { NextResponse } from 'next/server';
import { resolveMotAuth, getCurrentMotJourney } from '@/backend/services/motService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ_CURRENT_JOURNEY');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const result = await getCurrentMotJourney(auth!);
    return NextResponse.json(result.data, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching current journey.' }, { status: 500 });
  }
}
