import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';

export async function POST(req: Request) {
  const current = await getCurrentUser(req);
  let endpoint: string | null = null;
  try {
    const body = await req.json();
    if (body?.endpoint && typeof body.endpoint === 'string') {
      endpoint = body.endpoint;
    }
  } catch (_e) {
    // Body is optional on logout
  }

  if (current) {
    const userId = BigInt(current.id);
    await prisma.$transaction(async (tx) => {
      const condition: { user_id: bigint; revoked_at: null; endpoint?: string } = {
        user_id: userId,
        revoked_at: null,
      };
      if (endpoint) {
        condition.endpoint = endpoint;
      }
      const revoked = await tx.pushSubscription.updateMany({
        where: condition,
        data: { revoked_at: new Date() },
      });
      if (revoked.count) {
        await writeAuditLog(tx, {
          tableName: 'push_subscription',
          recordId: userId,
          action: 'PUSH_SUBSCRIPTIONS_REVOKED_ON_LOGOUT',
          newValues: {
            count: revoked.count,
            endpoint: endpoint || 'ALL_DEVICE_SUBSCRIPTIONS',
          },
          actor: auditActorFromUser(current),
        });
      }
    });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: 'auth_token',
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });
  return response;
}
