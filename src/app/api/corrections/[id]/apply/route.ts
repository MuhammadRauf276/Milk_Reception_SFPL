import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { applyCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { getErrorMessage } from '@/lib/errors';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const allowedRoles = ['DATA_EXECUTIVE', 'SUPER_ADMIN'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden. Only Data Executive or Super Admin may apply system corrections.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid request ID format.' }, { status: 400 });
  }

  try {
    const result = await applyCorrectionRequest(BigInt(id), user);
    return NextResponse.json({
      success: true,
      message: 'Correction applied successfully to operational database.',
      request: {
        id: result.request.id.toString(),
        status: result.request.status,
      },
      data: result.result,
    });
  } catch (err) {
    console.error(`POST /api/corrections/${id}/apply error:`, err);
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to apply correction.' }, { status: 400 });
  }
}
