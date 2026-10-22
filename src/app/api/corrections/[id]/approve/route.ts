import { NextResponse } from 'next/server';
import { requireCorrectionAuthority } from '@/backend/core/route-guards';
import { approveCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { getErrorMessage } from '@/lib/errors';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireCorrectionAuthority(req);
  if ('response' in guard) return guard.response;
  const { user } = guard;

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid request ID format.' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note : null;
    const updated = await approveCorrectionRequest(BigInt(id), user, note);
    return NextResponse.json({
      success: true,
      message: 'Correction request approved.',
      request: { id: updated.id.toString(), status: updated.status },
    });
  } catch (err) {
    console.error(`POST /api/corrections/${id}/approve error:`, err);
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to approve correction request.' }, { status: 400 });
  }
}
