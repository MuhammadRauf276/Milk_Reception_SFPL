import { NextResponse } from 'next/server';
import { correctCompletedSession } from '@/backend/services/zmccLabService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await correctCompletedSession(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/lab/sessions/[id]/correction error:', err);
    return NextResponse.json({ error: 'Failed to correct lab session.' }, { status: 500 });
  }
}
