import { Prisma, PrismaClient } from '@prisma/client';
import {
  notificationEventCatalog,
  type NotificationEventKey,
} from '@/backend/modules/notifications/eventCatalog';

type Db = PrismaClient | Prisma.TransactionClient;

function safeDeepLink(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    return null;
  }
  return value;
}

export async function createNotificationsForEvent(
  db: Db,
  input: {
    eventKey: NotificationEventKey;
    sourceId?: string;
    sourceZmccId?: bigint | null;
    title: string;
    body: string;
    deepLink?: string | null;
    dedupeSuffix: string;
    expiresAt?: Date | null;
  }
) {
  const definition = notificationEventCatalog[input.eventKey];
  if (!definition) return [];

  // For ZMCC-scoped events, notify users at that specific ZMCC plus system-wide supervisors (null source)
  const sourceFilter: Prisma.UserWhereInput =
    input.sourceZmccId !== undefined && input.sourceZmccId !== null
      ? {
          OR: [
            { procurement_source_id: input.sourceZmccId },
            { procurement_source_id: null },
          ],
        }
      : {};

  const users = await db.user.findMany({
    where: {
      is_active: true,
      role: { in: definition.recipients },
      ...sourceFilter,
    },
    select: { id: true },
  });

  return Promise.all(
    users.map(async (user) => {
      const dedupeKey = `${input.eventKey}:${input.dedupeSuffix}:${user.id}`;
      const notification = await db.notification.upsert({
        where: { dedupe_key: dedupeKey },
        create: {
          recipient_user_id: user.id,
          event_key: input.eventKey,
          priority: definition.priority,
          title: input.title,
          body: input.body,
          deep_link: safeDeepLink(input.deepLink),
          source_type: definition.sourceType,
          source_id: input.sourceId || null,
          dedupe_key: dedupeKey,
          expires_at: input.expiresAt || null,
        },
        update: {},
      });

      await db.notificationDelivery.upsert({
        where: {
          notification_id_channel: {
            notification_id: notification.id,
            channel: 'IN_APP',
          },
        },
        create: {
          notification_id: notification.id,
          channel: 'IN_APP',
        },
        update: {},
      });

      return notification.id;
    })
  );
}

/**
 * Resolves/marks notifications as read for a given source entity upon decision.
 */
export async function resolveNotificationsForSource(
  db: Db,
  filter: {
    sourceType?: string;
    sourceId: string;
  }
): Promise<number> {
  const where: Prisma.NotificationWhereInput = {
    source_id: filter.sourceId,
    read_at: null,
  };
  if (filter.sourceType) {
    where.source_type = filter.sourceType;
  }
  const result = await db.notification.updateMany({
    where,
    data: {
      read_at: new Date(),
    },
  });
  return result.count;
}

/**
 * Emits an audit alert to Data Executive and Super Admin when Super Admin self-approves an item.
 */
export async function emitSelfApprovalReviewNotification(
  db: Db,
  input: {
    sourceId: string;
    approvalType: string;
    adminName: string;
    remarks: string;
  }
) {
  return createNotificationsForEvent(db, {
    eventKey: 'SELF_APPROVAL_REVIEW',
    sourceId: input.sourceId,
    title: 'Super Admin Self-Approval Compliance Alert',
    body: `${input.adminName} self-approved ${input.approvalType} #${input.sourceId}. Justification: "${input.remarks.slice(0, 150)}"`,
    deepLink: `/control-center?audit=1&id=${input.sourceId}`,
    dedupeSuffix: `self-approval:${input.sourceId}:${Date.now()}`,
  });
}
