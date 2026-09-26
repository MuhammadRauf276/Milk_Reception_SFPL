import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';

export async function GET(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const rows = await prisma.pushSubscription.findMany({ where: { user_id: BigInt(current.id) }, orderBy: { updated_at: 'desc' } });
  return NextResponse.json({ subscriptions: rows.map((row) => ({ id: row.id.toString(), deviceLabel: row.device_label, active: !row.revoked_at, createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null })) });
}

export async function POST(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await req.json(); const endpoint = String(body.endpoint || ''); const p256dh = String(body.p256dh || ''); const auth = String(body.auth || '');
  if (!endpoint || !p256dh || !auth || endpoint.length > 10000) return NextResponse.json({ error: 'Valid push subscription keys are required.' }, { status: 400 });
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { user_id: BigInt(current.id), endpoint, p256dh, auth, device_label: String(body.deviceLabel || '').slice(0, 100) || null }, update: { user_id: BigInt(current.id), p256dh, auth, revoked_at: null, device_label: String(body.deviceLabel || '').slice(0, 100) || null } });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id'); if (!/^\d+$/.test(id || '')) return NextResponse.json({ error: 'subscription id is required.' }, { status: 400 });
  const userId = BigInt(current.id); const changed = await prisma.$transaction(async (tx) => {
    const subscription = await tx.pushSubscription.findFirst({ where: { id: BigInt(id!), user_id: userId, revoked_at: null } });
    if (!subscription) return false;
    await tx.pushSubscription.update({ where: { id: subscription.id }, data: { revoked_at: new Date() } });
    await tx.auditLog.create({ data: { table_name: 'push_subscription', record_id: subscription.id, action: 'PUSH_SUBSCRIPTION_REVOKED_BY_USER', old_values: { device_label: subscription.device_label }, new_values: { revoked: true }, user_id: userId } });
    return true;
  });
  return changed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Active subscription not found.' }, { status: 404 });
}
