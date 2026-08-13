import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: sourceIdStr } = await params;
  const sourceId = BigInt(sourceIdStr);

  try {
    const body = await req.json();
    const targetSource = await prisma.procurementSource.findUnique({ where: { id: sourceId } });
    if (!targetSource) {
      return NextResponse.json({ error: 'Target procurement source record not found.' }, { status: 404 });
    }

    const updatedSource = await prisma.procurementSource.update({
      where: { id: sourceId },
      data: {
        name: body.name !== undefined ? body.name.trim() : targetSource.name,
        is_active: body.isActive !== undefined ? Boolean(body.isActive) : targetSource.is_active,
      },
    });

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });
    const actionName = body.isActive === false ? 'PROCUREMENT_SOURCE_DEACTIVATED' : 'PROCUREMENT_SOURCE_UPDATED';

    await prisma.auditLog.create({
      data: {
        table_name: 'procurement_source',
        record_id: sourceId,
        action: actionName,
        old_values: { name: targetSource.name, is_active: targetSource.is_active },
        new_values: { name: updatedSource.name, is_active: updatedSource.is_active },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      source: {
        id: updatedSource.id.toString(),
        code: updatedSource.code,
        name: updatedSource.name,
        sourceType: updatedSource.source_type,
        isActive: updatedSource.is_active,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
