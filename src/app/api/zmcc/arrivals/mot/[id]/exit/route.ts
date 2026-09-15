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

    const result = await recordGateExit(req, 'MOT', id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.message || result.error }, { status: result.status });
    }
    return NextResponse.json({ arrival: result.data, ...result.data }, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/arrivals/mot/[id]/exit error:', err);
    return NextResponse.json({ error: 'Failed to record MOT gate exit.', message: 'Failed to record MOT gate exit.' }, { status: 500 });
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

    const result = await correctGateExit(req, 'MOT', id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.message || result.error }, { status: result.status });
    }
    return NextResponse.json({ arrival: result.data, ...result.data }, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/arrivals/mot/[id]/exit error:', err);
    return NextResponse.json({ error: 'Failed to correct MOT gate exit.' }, { status: 500 });
  }
}
