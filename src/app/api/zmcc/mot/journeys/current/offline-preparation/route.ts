import { NextResponse } from 'next/server';
import { resolveMotAuth, getCurrentMotJourney } from '@/backend/services/motService';
import { createMotOfflinePreparationToken } from '@/backend/core/auth';

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ_CURRENT_JOURNEY');
  if (errorResponse || !auth) return NextResponse.json({ error: errorResponse?.error || 'Unauthorized.' }, { status: errorResponse?.status || 401 });
  const current = await getCurrentMotJourney(auth);
  const journey = current.data?.journey;
  if (current.status !== 200 || !journey || journey.status !== 'COLLECTING') return NextResponse.json({ error: 'An active collecting journey is required for offline preparation.' }, { status: 400 });
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const receipt = await createMotOfflinePreparationToken({ userId: auth.actorUserId.toString(), journeyId: journey.id.toString(), zmccId: auth.effectiveZmccId!.toString(), expiresAt });
  return NextResponse.json({ userId: auth.actorUserId.toString(), journeyId: journey.id.toString(), zmccId: auth.effectiveZmccId!.toString(), expiresAt: expiresAt.toISOString(), receipt }, { headers: { 'Cache-Control': 'no-store' } });
}
