import { NextResponse } from 'next/server';
import { submitPortionDecision } from '@/backend/services/zmccLabService';

/** Body: { version, person_decision: 'ACCEPT' | 'REJECT', remarks?, quantity_value?, quantity_unit?, tests: [{ lab_test_id, value?, text_value? }] } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; portionId: string }> }) {
  try {
    const { id, portionId } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const result = await submitPortionDecision(req, id, portionId, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/sessions/[id]/portions/[portionId]/decision error:', err);
    return NextResponse.json({ error: 'Failed to save the portion decision.' }, { status: 500 });
  }
}
