import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: userIdStr } = await params;
  let targetUserId: bigint;
  try {
    targetUserId = BigInt(userIdStr);
  } catch {
    return NextResponse.json({ error: 'Invalid user ID.' }, { status: 400 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a plain object.' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;

    for (const key of Object.keys(payload)) {
      if (key !== 'password') {
        return NextResponse.json({ error: `Unknown or disallowed field: ${key}` }, { status: 400 });
      }
    }

    if (typeof payload.password !== 'string' || payload.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }
    const newPassword = payload.password;

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user record not found.' }, { status: 404 });
    }

    const passHash = await bcrypt.hash(newPassword, 10);
    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { password_hash: passHash },
      });

      // Record AuditLog WITHOUT storing plaintext password or password hash!
      await tx.auditLog.create({
        data: {
          table_name: 'users',
          record_id: targetUserId,
          action: 'PASSWORD_RESET',
          new_values: { username: targetUser.username, reset_timestamp: new Date().toISOString() },
          user_id: adminUser?.id || null,
        },
      });
    });

    return NextResponse.json({ success: true, message: `Password reset successfully for user "${targetUser.username}".` });
  } catch (err: any) {
    console.error('[API_SUPER_ADMIN_USERS_RESET_PASSWORD_ERROR]', err);
    return NextResponse.json({ error: 'Failed to reset password.' }, { status: 500 });
  }
}
