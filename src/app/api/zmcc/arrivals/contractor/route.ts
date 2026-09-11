import { NextResponse } from 'next/server';
import {
  submitContractorArrival,
  listContractorArrivals,
} from '@/backend/services/zmccArrivalService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    const contractor_source_id = searchParams.get('contractor_source_id') || undefined;
    const vehicle_number = searchParams.get('vehicle_number') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
    const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined;

    const result = await listContractorArrivals(req, {
      date,
      contractor_source_id,
      vehicle_number,
      search,
      page,
      pageSize,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/contractor error:', err);
    return NextResponse.json({ error: 'Failed to fetch contractor arrivals.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await submitContractorArrival(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/arrivals/contractor error:', err);
    return NextResponse.json({ error: 'Failed to submit contractor arrival.' }, { status: 500 });
  }
}
