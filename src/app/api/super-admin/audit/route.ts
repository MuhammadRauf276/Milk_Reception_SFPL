import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const tableName = searchParams.get('tableName');
    const action = searchParams.get('action');
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (tableName) {
      where.table_name = tableName;
    }
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }

    const [totalRecords, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          user: {
            select: { username: true, full_name: true, role: true },
          },
        },
      }),
    ]);

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

    const totalPages = totalRecords === 0 ? 1 : Math.ceil(totalRecords / pageSize);

    return NextResponse.json({
      auditLogs: serialized,
      pagination: {
        page,
        pageSize,
        totalRecords,
        totalPages,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
