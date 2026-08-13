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

  const { id: userIdStr } = await params;
  const targetUserId = BigInt(userIdStr);

  try {
    const body = await req.json();
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user record not found.' }, { status: 404 });
    }

    // LAST SUPER ADMIN PROTECTION ENFORCEMENT
    // Check if target user is an active SUPER_ADMIN
    const isTargetActiveSuperAdmin = targetUser.role === 'SUPER_ADMIN' && targetUser.is_active;

    if (isTargetActiveSuperAdmin) {
      const isDeactivating = body.isActive === false;
      const isChangingRole = body.role !== undefined && body.role !== 'SUPER_ADMIN';

      if (isDeactivating || isChangingRole) {
        const activeSuperAdminCount = await prisma.user.count({
          where: { role: 'SUPER_ADMIN', is_active: true },
        });

        if (activeSuperAdminCount <= 1) {
          return NextResponse.json(
            { error: 'Action blocked: Cannot deactivate or reassign the last active Super Admin account.' },
            { status: 400 }
          );
        }
      }
    }

    let psId: bigint | null = targetUser.procurement_source_id;
    const newRole = body.role || targetUser.role;

    if (body.procurementSourceId !== undefined) {
      if (body.procurementSourceId === null || body.procurementSourceId === '') {
        psId = null;
      } else {
        const ps = await prisma.procurementSource.findUnique({
          where: { id: BigInt(body.procurementSourceId) },
        });
        if (!ps) {
          return NextResponse.json({ error: 'Invalid Procurement Source assignment.' }, { status: 400 });
        }
        psId = ps.id;

        if (newRole === 'ZMCC_MANAGER' && ps.source_type !== 'ZMCC') {
          return NextResponse.json({ error: `Role ZMCC_MANAGER cannot be assigned to Contractor source "${ps.name}".` }, { status: 400 });
        }
        if (newRole === 'CONTRACTOR_MANAGER' && ps.source_type !== 'CONTRACTOR') {
          return NextResponse.json({ error: `Role CONTRACTOR_MANAGER cannot be assigned to ZMCC source "${ps.name}".` }, { status: 400 });
        }
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        full_name: body.name !== undefined ? body.name : targetUser.full_name,
        role: newRole,
        department: body.department !== undefined ? body.department : targetUser.department,
        scope_type: body.scopeType !== undefined ? body.scopeType : targetUser.scope_type,
        procurement_source_id: psId,
        is_active: body.isActive !== undefined ? Boolean(body.isActive) : targetUser.is_active,
      },
    });

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });
    const actionName = body.isActive === false ? 'USER_DEACTIVATED' : body.isActive === true ? 'USER_ACTIVATED' : 'USER_UPDATED';

    await prisma.auditLog.create({
      data: {
        table_name: 'users',
        record_id: targetUserId,
        action: actionName,
        old_values: { username: targetUser.username, role: targetUser.role, is_active: targetUser.is_active },
        new_values: { username: updatedUser.username, role: updatedUser.role, is_active: updatedUser.is_active },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id.toString(),
        username: updatedUser.username,
        name: updatedUser.full_name,
        role: updatedUser.role,
        isActive: updatedUser.is_active,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
