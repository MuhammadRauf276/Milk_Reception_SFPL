import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { managerDecideCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { getErrorMessage } from '@/lib/errors';

/**
 * The manager step of a correction request. Body: { decision: APPROVE or REJECT, note }.
 * Approve sends it on to the Data Executive and Super Admin; reject closes it. A reject needs a reason.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid request ID format.' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return NextResponse.json({ error: 'Decision must be APPROVE or REJECT.' }, { status: 400 });
  }
  if (decision === 'REJECT' && note.length < 3) {
    return NextResponse.json({ error: 'Write why you are rejecting it (at least 3 letters).' }, { status: 400 });
  }

  try {
    const result = await managerDecideCorrectionRequest(BigInt(id), user, decision, note);
    return NextResponse.json({ success: true, request: { id: result.id.toString(), status: result.status } });
  } catch (err) {
    const message = getErrorMessage(err) || 'Could not save the decision.';
    const status = message.startsWith('Forbidden') ? 403 : message.includes('not found') ? 404 : message.includes('no longer waiting') ? 409 : 400;
    if (status === 400) console.error(`POST /api/corrections/${id}/manager-decision error:`, err);
    return NextResponse.json({ error: message }, { status });
  }
}
