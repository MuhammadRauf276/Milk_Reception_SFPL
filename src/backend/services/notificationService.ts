import { Prisma, PrismaClient } from '@prisma/client';
import { notificationEventCatalog, type NotificationEventKey } from '@/backend/modules/notifications/eventCatalog';

type Db = PrismaClient | Prisma.TransactionClient;
function safeDeepLink(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) return null;
  return value;
}
export async function createNotificationsForEvent(db: Db, input: { eventKey: NotificationEventKey; sourceId?: string; sourceZmccId?: bigint | null; title: string; body: string; deepLink?: string | null; dedupeSuffix: string; expiresAt?: Date | null }) {
  const definition = notificationEventCatalog[input.eventKey];
  const users = await db.user.findMany({ where: { is_active: true, role: { in: definition.recipients }, ...(input.eventKey === 'ZMCC_LAB_EXCEPTION_PENDING' && input.sourceZmccId ? { procurement_source_id: input.sourceZmccId } : {}) }, select: { id: true } });
  return Promise.all(users.map(async (user) => {
    const dedupeKey = `${input.eventKey}:${input.dedupeSuffix}:${user.id}`;
    const notification = await db.notification.upsert({ where: { dedupe_key: dedupeKey }, create: { recipient_user_id: user.id, event_key: input.eventKey, priority: definition.priority, title: input.title, body: input.body, deep_link: safeDeepLink(input.deepLink), source_type: definition.sourceType, source_id: input.sourceId || null, dedupe_key: dedupeKey, expires_at: input.expiresAt || null }, update: {} });
    await db.notificationDelivery.upsert({ where: { notification_id_channel: { notification_id: notification.id, channel: 'IN_APP' } }, create: { notification_id: notification.id, channel: 'IN_APP' }, update: {} });
    return notification.id;
  }));
}
