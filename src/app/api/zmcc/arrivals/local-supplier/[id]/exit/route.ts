import { NextResponse } from 'next/server';
import {
  recordGateExit,
  correctGateExit,
} from '@/backend/services/zmccArrivalService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await recordGateExit(req, 'LOCAL_SUPPLIER', id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.message || result.error }, { status: result.status });
    }
    return NextResponse.json({ arrival: result.data, ...result.data }, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/arrivals/local-supplier/[id]/exit error:', err);
    return NextResponse.json({ error: 'Failed to record local supplier gate exit.', message: 'Failed to record local supplier gate exit.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.', message: 'Invalid request body.' }, { status: 400 });
    }

    const result = await correctGateExit(req, 'LOCAL_SUPPLIER', id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.message || result.error }, { status: result.status });
    }
    return NextResponse.json({ arrival: result.data, ...result.data }, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/arrivals/local-supplier/[id]/exit error:', err);
    return NextResponse.json({ error: 'Failed to correct local supplier gate exit.' }, { status: 500 });
  }
}
