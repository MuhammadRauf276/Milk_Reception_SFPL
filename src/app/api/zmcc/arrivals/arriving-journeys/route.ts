import { NextResponse } from 'next/server';
import { getArrivingMotJourneys } from '@/backend/services/zmccArrivalService';

export async function GET(req: Request) {
  try {
    const result = await getArrivingMotJourneys(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/arriving-journeys error:', err);
    return NextResponse.json({ error: 'Failed to fetch arriving journeys.' }, { status: 500 });
  }
}
