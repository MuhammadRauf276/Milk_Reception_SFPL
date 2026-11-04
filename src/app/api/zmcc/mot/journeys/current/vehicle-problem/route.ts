import { NextResponse } from 'next/server';
import { listJourneyVehicleChanges, requestVehicleChange } from '@/backend/services/motService';

export async function GET(req: Request) {
  try {
    const journeyId = new URL(req.url).searchParams.get('journeyId');
    const result = await listJourneyVehicleChanges(req, { journeyId });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/mot/journeys/current/vehicle-problem error:', err);
    return NextResponse.json({ error: 'Failed to load vehicle requests.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const journeyId = new URL(req.url).searchParams.get('journeyId');
    const body = await req.json().catch(() => null);
    const result = await requestVehicleChange(req, { journeyId, reason: body?.reason });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/mot/journeys/current/vehicle-problem error:', err);
    return NextResponse.json({ error: 'Failed to send the vehicle problem.' }, { status: 500 });
  }
}
