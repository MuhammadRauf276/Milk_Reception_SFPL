import { NextResponse } from 'next/server';
import { getLabPortions, setupLabPortions, discardEmptyPortion, addLabPortion } from '@/backend/services/zmccLabService';

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
    if (body.action === 'ADD_PORTION') {
      const result = await addLabPortion(req, id);
      if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result.data, { status: result.status });
    }
    const result = await setupLabPortions(req, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/sessions/[id]/portions error:', err);
    return NextResponse.json({ error: 'Failed to set up portions.' }, { status: 500 });
  }
}

/** Query: ?portionNumber=3 or Body: { portion_number: 3 } */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    let portionNum = url.searchParams.get('portionNumber') || url.searchParams.get('portion_number');
    if (!portionNum) {
      const body = await req.json().catch(() => null);
      if (body && typeof body === 'object') {
        portionNum = String(body.portion_number || body.portionNumber || '');
      }
    }
    if (!portionNum) {
      return NextResponse.json({ error: 'Missing portionNumber parameter.' }, { status: 400 });
    }
    const result = await discardEmptyPortion(req, id, portionNum);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('DELETE /api/zmcc/lab/sessions/[id]/portions error:', err);
    return NextResponse.json({ error: 'Failed to discard empty portion.' }, { status: 500 });
  }
}
