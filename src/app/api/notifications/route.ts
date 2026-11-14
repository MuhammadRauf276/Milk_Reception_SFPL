import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { resolveNotificationDeepLink } from '@/lib/notification-links';

export async function GET(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const unreadOnly = new URL(req.url).searchParams.get('unread') === 'true'; const userId = BigInt(current.id);
  const now = new Date();
  const baseWhere = { recipient_user_id: userId, OR: [{ expires_at: null }, { expires_at: { gt: now } }] };
  const [recentRows, unreadRows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { ...baseWhere, ...(unreadOnly ? { read_at: null } : {}) },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
    unreadOnly
      ? Promise.resolve([])
      : prisma.notification.findMany({
          where: { ...baseWhere, read_at: null },
          orderBy: { created_at: 'desc' },
          take: 50,
        }),
    prisma.notification.count({ where: { ...baseWhere, read_at: null } }),
  ]);
  const seen = new Set<string>();
  const rows = [...unreadRows, ...recentRows]
    .filter((row) => {
      const k = row.id.toString();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, 100);
  return NextResponse.json(
    {
      unreadCount,
      notifications: rows.map((row) => ({
        id: row.id.toString(),
        eventKey: row.event_key,
        priority: row.priority,
        title: row.title,
        body: row.body,
        deepLink: resolveNotificationDeepLink(row.deep_link, {
          eventKey: row.event_key,
          role: current.role,
        }),
        sourceType: row.source_type,
        sourceId: row.source_id,
        readAt: row.read_at?.toISOString() || null,
        createdAt: row.created_at.toISOString(),
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function PATCH(req: Request) {
  const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await req.json(); const userId = BigInt(current.id);
  if (body.markAllRead) {
    const rows = await prisma.notification.findMany({ where: { recipient_user_id: userId, read_at: null }, select: { id: true } });
    await prisma.$transaction([prisma.notification.updateMany({ where: { recipient_user_id: userId, read_at: null }, data: { read_at: new Date() } }), prisma.notificationDelivery.updateMany({ where: { notification_id: { in: rows.map((row) => row.id) }, channel: 'IN_APP' }, data: { status: 'READ' } })]);
    return NextResponse.json({ ok: true });
  }
  if (!/^\d+$/.test(String(body.id || ''))) return NextResponse.json({ error: 'Notification id is required.' }, { status: 400 });
  const changed = await prisma.notification.updateMany({ where: { id: BigInt(body.id), recipient_user_id: userId }, data: { read_at: new Date() } });
  if (!changed.count) return NextResponse.json({ error: 'Notification not found.' }, { status: 404 });
  await prisma.notificationDelivery.updateMany({ where: { notification_id: BigInt(body.id), channel: 'IN_APP' }, data: { status: 'READ' } });
  return NextResponse.json({ ok: true });
}
