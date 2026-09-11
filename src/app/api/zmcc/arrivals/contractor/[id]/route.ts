import { NextResponse } from 'next/server';
import {
  getContractorArrivalById,
  correctContractorArrival,
} from '@/backend/services/zmccArrivalService';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const result = await getContractorArrivalById(req, params.id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/contractor/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch contractor arrival details.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await correctContractorArrival(req, params.id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/arrivals/contractor/[id] error:', err);
    return NextResponse.json({ error: 'Failed to correct contractor arrival.' }, { status: 500 });
  }
}
