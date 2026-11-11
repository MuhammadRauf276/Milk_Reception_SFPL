import { NextResponse } from 'next/server';
import {
  getLocalSupplierArrivalById,
  correctLocalSupplierArrival,
} from '@/backend/services/zmccArrivalService';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getLocalSupplierArrivalById(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/arrivals/hc/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch HC arrival details.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await correctLocalSupplierArrival(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('PATCH /api/zmcc/arrivals/hc/[id] error:', err);
    return NextResponse.json({ error: 'Failed to correct HC arrival.' }, { status: 500 });
  }
}
