import { NextResponse } from 'next/server';
import { resumeMotJourneyCollection } from '@/backend/services/motService';

export async function POST(req: Request) {
  try {
    const rawJourneyId = new URL(req.url).searchParams.get('journeyId');
    const result = await resumeMotJourneyCollection(req, {
      journeyId: rawJourneyId || undefined,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/mot/journeys/current/resume-collection error:', err);
    return NextResponse.json({ error: 'Failed to resume journey collection.' }, { status: 500 });
  }
}
