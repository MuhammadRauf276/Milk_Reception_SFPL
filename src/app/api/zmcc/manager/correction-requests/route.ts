import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { requireCorrectionAuthority } from '@/backend/core/route-guards';
import { prisma } from '@/backend/core/db';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ZMCC_MANAGER' && user.role !== 'SUPER_ADMIN' && user.role !== 'DATA_EXECUTIVE') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const isGlobal = user.role === 'SUPER_ADMIN' || user.role === 'DATA_EXECUTIVE';
  const sourceId = isGlobal ? new URL(req.url).searchParams.get('sourceId') : user.procurement_source_id;
  if (!sourceId && !isGlobal) return NextResponse.json({ error: 'ZMCC source is required.' }, { status: 400 });
  const requests = await prisma.correctionRequest.findMany({
    where: { ...(sourceId ? { source_id: BigInt(sourceId) } : {}), status: 'REQUESTED' },
    include: { requester: { select: { username: true, full_name: true } } },
    orderBy: { requested_at: 'asc' },
    take: 50,
  });
  return NextResponse.json({ requests: requests.map((item) => ({ id: item.id.toString(), module: item.module, recordId: item.record_id, impact: item.impact, reason: item.reason, requestedAt: item.requested_at.toISOString(), requestedBy: item.requester.full_name || item.requester.username })) });
}

export async function POST(req: Request) {
  // Reviewing (approving/rejecting/escalating) a correction is a CORRECT action: Data Executive and Super Admin only.
  const guard = await requireCorrectionAuthority(req);
  if ('response' in guard) return guard.response;
  const { user } = guard;
  try {
    const body = await req.json();
    const requestId = body?.requestId;
    const decision = body?.decision;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!requestId || !['APPROVE', 'REJECT', 'ESCALATE'].includes(decision) || reason.length < 5) {
      return NextResponse.json({ error: 'Request, decision, and a reason of at least 5 characters are required.' }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.correctionRequest.findUnique({ where: { id: BigInt(requestId) } });
      if (!item || item.status !== 'REQUESTED') throw new Error('REQUEST_NOT_AVAILABLE');
      const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'ESCALATED';
      const updated = await tx.correctionRequest.update({
        where: { id: item.id },
        data: { status, reviewed_by_user_id: BigInt(user.id), reviewed_at: new Date(), review_reason: reason },
      });
      await writeAuditLog(tx, {
        tableName: 'correction_request',
        recordId: item.id,
        action: `CORRECTION_REQUEST_${status}`,
        oldValues: { status: item.status },
        newValues: { status, reason, correlation_id: item.correlation_id, module: item.module, target_record_id: item.record_id },
        actor: auditActorFromUser(user),
      });
      if (status === 'ESCALATED') {
        await createNotificationsForEvent(tx, {
          eventKey: 'CORRECTION_ESCALATED', sourceId: item.id.toString(),
          title: 'Correction request escalated', body: `${item.module} correction ${item.record_id} needs MPD Head review.`,
          deepLink: '/approvals', dedupeSuffix: item.id.toString(),
        });
      }
      return updated;
    });
    return NextResponse.json({ request: { id: result.id.toString(), status: result.status } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to review correction request.';
    const status = message === 'OUTSIDE_SCOPE' ? 403 : message === 'REQUEST_NOT_AVAILABLE' ? 409 : 500;
    return NextResponse.json({ error: message.replaceAll('_', ' ') }, { status });
  }
}
