import { NextResponse } from 'next/server';
import { getSessionById, updateDraftResults } from '@/backend/services/zmccLabService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getSessionById(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, {
      status: result.status,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (err: any) {
    console.error('GET /api/zmcc/lab/sessions/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch lab session.' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateDraftResults(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/lab/sessions/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update draft results.' }, { status: 500 });
  }
}
