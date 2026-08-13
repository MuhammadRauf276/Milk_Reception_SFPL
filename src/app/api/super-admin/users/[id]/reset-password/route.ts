import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: userIdStr } = await params;
  const targetUserId = BigInt(userIdStr);

  try {
    const body = await req.json();
    const newPassword = (body.password || '').trim();

    if (!newPassword || newPassword.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters long.' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user record not found.' }, { status: 404 });
    }

    const passHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: targetUserId },
      data: { password_hash: passHash },
    });

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    // Record AuditLog WITHOUT storing plaintext password or password hash!
    await prisma.auditLog.create({
      data: {
        table_name: 'users',
        record_id: targetUserId,
        action: 'PASSWORD_RESET',
        new_values: { username: targetUser.username, reset_timestamp: new Date().toISOString() },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({ success: true, message: `Password reset successfully for user "${targetUser.username}".` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
