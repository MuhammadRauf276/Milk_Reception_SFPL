import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { auditActorFromUser } from '@/backend/core/audit';
import { deleteMotJourney, JourneyDeleteError } from '@/backend/services/admin/journeyAdmin';

/** Super Admin removes a journey assigned by mistake (never one that carried milk). Body: { reason }. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, ['SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  if (guard.acting.actorRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Only the Super Admin can remove a journey.' }, { status: 403 });

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Journey not found.' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };

  try {
    const result = await deleteMotJourney(auditActorFromUser(guard.user), BigInt(id), typeof body.reason === 'string' ? body.reason : '');
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof JourneyDeleteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('DELETE /api/super-admin/journeys/[id] error:', err);
    return NextResponse.json({ error: 'Could not remove the journey.' }, { status: 500 });
  }
}
