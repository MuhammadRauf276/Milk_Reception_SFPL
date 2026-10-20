import { NextResponse } from 'next/server';
import { resolveMotAuth, getCurrentMotJourney } from '@/backend/services/motService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ_CURRENT_JOURNEY');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  // Optional ?journeyId= lets a superior covering MOT work open a chosen journey (scope checked in the service).
  const rawJourneyId = new URL(req.url).searchParams.get('journeyId');
  let journeyId: bigint | undefined;
  if (rawJourneyId !== null && rawJourneyId.trim() !== '') {
    if (!/^\d+$/.test(rawJourneyId.trim())) {
      return NextResponse.json({ error: 'Invalid journey id.' }, { status: 400 });
    }
    journeyId = BigInt(rawJourneyId.trim());
  }

  try {
    const result = await getCurrentMotJourney(auth!, { journeyId });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching current journey.' }, { status: 500 });
  }
}
