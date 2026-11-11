import { NextResponse } from 'next/server';
import { correctLabPortion } from '@/backend/services/zmcc/labPortionCorrectionService';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';

/** Body: { reason, version, lr?, fat?, net_weight_kg?, idempotency_key? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const result = await correctLabPortion(req, id, body);
    if ('error' in result && result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json('data' in result ? result.data : {}, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/portions/[id]/correction error:', err);
    return NextResponse.json({ error: 'Could not save the correction. Nothing was changed.' }, { status: 500 });
  }
}
