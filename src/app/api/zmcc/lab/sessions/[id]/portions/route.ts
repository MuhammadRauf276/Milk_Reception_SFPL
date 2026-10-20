import { NextResponse } from 'next/server';
import { getLabPortions, setupLabPortions } from '@/backend/services/zmccLabService';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const result = await getLabPortions(req, id);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/lab/sessions/[id]/portions error:', err);
    return NextResponse.json({ error: 'Failed to load portions.' }, { status: 500 });
  }
}

/** Body: { test_mode: 'COMPOSITE' | 'PORTION_WISE', portion_count?: number } */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const result = await setupLabPortions(req, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/sessions/[id]/portions error:', err);
    return NextResponse.json({ error: 'Failed to set up portions.' }, { status: 500 });
  }
}
