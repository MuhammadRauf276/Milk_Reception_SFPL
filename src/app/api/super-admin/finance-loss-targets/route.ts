import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { createNotificationsForEvent } from '@/backend/services/notificationService';

function serialize(row: { id: bigint; metric: string; target_percent: unknown; effective_from: Date; effective_to: Date | null; reason: string }) {
  return { id: row.id.toString(), metric: row.metric, targetPercent: Number(row.target_percent), effectiveFrom: row.effective_from.toISOString(), effectiveTo: row.effective_to?.toISOString() || null, reason: row.reason };
}

export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const actor = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!actor || !['SUPER_ADMIN', 'HEAD_OF_MPD', 'FINANCE_ACCOUNTS'].includes(actor.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const rows = await prisma.financeLossTarget.findMany({ where: { metric: 'MTD_13TS_LOSS_PERCENT' }, orderBy: { effective_from: 'desc' } });
  const active = rows.find((row) => row.effective_to === null);
  return NextResponse.json({ active: active ? serialize(active) : null, history: rows.map(serialize) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const actorId = BigInt(current.id);
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const body = await req.json(); const target = Number(body.targetPercent); const reason = String(body.reason || '').trim();
  if (!Number.isFinite(target) || target < 0 || target > 100 || !reason) return NextResponse.json({ error: 'A valid target percent and reason are required.' }, { status: 400 });
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.financeLossTarget.updateMany({ where: { metric: 'MTD_13TS_LOSS_PERCENT', effective_to: null }, data: { effective_to: now } });
    const row = await tx.financeLossTarget.create({ data: { metric: 'MTD_13TS_LOSS_PERCENT', target_percent: target, effective_from: now, activated_by_user_id: actorId, reason } });
    await tx.auditLog.create({ data: { table_name: 'finance_loss_target', record_id: row.id, action: 'FINANCE_LOSS_TARGET_ACTIVATED', new_values: { metric: row.metric, target_percent: target, effective_from: now.toISOString(), reason }, user_id: actorId } });
    await createNotificationsForEvent(tx, { eventKey: 'FINANCE_TARGET_CHANGED', sourceId: row.id.toString(), title: 'MTD 13TS loss target changed', body: `The active target is now ${target}%.`, deepLink: '/finance/reconciliation', dedupeSuffix: row.id.toString() });
    return row;
  });
  return NextResponse.json(serialize(created), { status: 201 });
}
