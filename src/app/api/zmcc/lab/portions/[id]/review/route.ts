import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { reviewPortionException } from '@/backend/services/zmcc/labPortionReviewService';

/** Body: { verdict: 'OKAY' | 'NO', remarks?, version } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['ZMCC_MANAGER']);
    if ('response' in guard) return guard.response;

    const { id } = await params;
    if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: 'Invalid portion id.' }, { status: 400 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const verdict = body.verdict;
    if (verdict !== 'OKAY' && verdict !== 'NO') return NextResponse.json({ error: 'Choose OKAY or NO.' }, { status: 400 });
    const version = Number(body.version);
    if (!Number.isInteger(version)) return NextResponse.json({ error: 'Version is required.' }, { status: 400 });

    const result = await reviewPortionException(guard.acting, BigInt(id), {
      verdict,
      remarks: typeof body.remarks === 'string' ? body.remarks : null,
      version,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/portions/[id]/review error:', err);
    return NextResponse.json({ error: 'Failed to save the decision.' }, { status: 500 });
  }
}
