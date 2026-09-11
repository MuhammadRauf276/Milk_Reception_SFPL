import { NextResponse } from 'next/server';
import {
  submitMotArrival,
  listMotArrivals,
} from '@/backend/services/zmccArrivalService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    const journey_id = searchParams.get('journey_id') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
    const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined;

    const result = await listMotArrivals(req, { date, journey_id, search, page, pageSize });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/mot error:', err);
    return NextResponse.json({ error: 'Failed to fetch MOT arrivals.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await submitMotArrival(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/arrivals/mot error:', err);
    return NextResponse.json({ error: 'Failed to submit MOT arrival.' }, { status: 500 });
  }
}
