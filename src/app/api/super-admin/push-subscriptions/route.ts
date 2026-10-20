import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';

export async function GET(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (current.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const rows = await prisma.pushSubscription.findMany({ include: { user: { select: { username: true, full_name: true, role: true } } }, orderBy: { updated_at: 'desc' }, take: 200 });
  return NextResponse.json({ subscriptions: rows.map((row) => ({ id: row.id.toString(), user: row.user.full_name || row.user.username, role: row.user.role, deviceLabel: row.device_label, active: !row.revoked_at, createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null })) });
}

export async function DELETE(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (current.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id'); if (!/^\d+$/.test(id || '')) return NextResponse.json({ error: 'A valid subscription id is required.' }, { status: 400 });
  const subscriptionId = BigInt(id!);
  const changed = await prisma.$transaction(async (tx) => {
    const subscription = await tx.pushSubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription || subscription.revoked_at) return false;
    await tx.pushSubscription.update({ where: { id: subscriptionId }, data: { revoked_at: new Date() } });
    await writeAuditLog(tx, {
      tableName: 'push_subscription',
      recordId: subscriptionId,
      action: 'PUSH_SUBSCRIPTION_REVOKED_BY_SUPER_ADMIN',
      oldValues: { user_id: subscription.user_id.toString(), device_label: subscription.device_label },
      newValues: { revoked: true },
      actor: auditActorFromUser(current),
    });
    return true;
  });
  return changed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Active subscription not found.' }, { status: 404 });
}
