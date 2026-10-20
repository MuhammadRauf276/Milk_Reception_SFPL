import { NextResponse } from 'next/server';
import { requireCorrectionAuthority } from '@/backend/core/route-guards';
import { rejectCorrectionRequest } from '@/backend/services/correctionGovernanceService';
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
    const body = await req.json();
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length < 3) {
      return NextResponse.json({ error: 'Rejection reason of at least 3 characters is required.' }, { status: 400 });
    }

    const updated = await rejectCorrectionRequest(BigInt(id), user, reason);
    return NextResponse.json({
      success: true,
      message: 'Correction request rejected.',
      request: {
        id: updated.id.toString(),
        status: updated.status,
      },
    });
  } catch (err) {
    console.error(`POST /api/corrections/${id}/reject error:`, err);
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to reject correction request.' }, { status: 400 });
  }
}
