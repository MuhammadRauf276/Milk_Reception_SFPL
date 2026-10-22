import { NextResponse } from 'next/server';
import { returnMotJourneyToPhe } from '@/backend/services/motService';

export async function POST(req: Request) {
  try {
    const rawJourneyId = new URL(req.url).searchParams.get('journeyId');
    const result = await returnMotJourneyToPhe(req, {
      journeyId: rawJourneyId || undefined,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/mot/journeys/current/return-to-phe error:', err);
    return NextResponse.json({ error: 'Failed to return journey to PHE.' }, { status: 500 });
  }
}
