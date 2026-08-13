import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const tableName = searchParams.get('tableName');
    const action = searchParams.get('action');

    const where: any = {};
    if (tableName) {
      where.table_name = tableName;
    }
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }

    const logs = await prisma.auditLog.findMany({
      where,
      take: 100,
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { username: true, full_name: true, role: true },
        },
      },
    });

    const serialized = logs.map((l) => ({
      id: l.id.toString(),
      tableName: l.table_name,
      recordId: l.record_id ? l.record_id.toString() : null,
      action: l.action,
      oldValues: l.old_values,
      newValues: l.new_values,
      user: l.user ? `${l.user.full_name || l.user.username} (${l.user.role})` : 'System',
      createdAt: l.created_at.toISOString(),
    }));

    return NextResponse.json({ auditLogs: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
