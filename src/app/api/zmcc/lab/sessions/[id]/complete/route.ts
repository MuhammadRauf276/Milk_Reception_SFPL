import { NextResponse } from 'next/server';
import { completeSession } from '@/backend/services/zmccLabService';

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

    const result = await completeSession(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/lab/sessions/[id]/complete error:', err);
    return NextResponse.json({ error: 'Failed to complete lab session.' }, { status: 500 });
  }
}
