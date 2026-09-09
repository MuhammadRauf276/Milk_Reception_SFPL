import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getRoleAssignmentPolicy } from '@/lib/user-assignment-policy';

const ALLOWED_PATCH_FIELDS = new Set([
  'name',
  'role',
  'procurementSourceId',
  'isActive',
]);

export async function PATCH(
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

    const keys = Object.keys(payload);
    if (keys.length === 0) {
      return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 });
    }

    if (
      'scopeType' in payload ||
      'scope_type' in payload ||
      'department' in payload
    ) {
      return NextResponse.json(
        { error: 'Client-supplied scopeType and department are not permitted. Both values are derived strictly from role policy.' },
        { status: 400 }
      );
    }

    for (const key of keys) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return NextResponse.json({ error: `Unknown or disallowed field: ${key}` }, { status: 400 });
      }
    }

    if (payload.isActive !== undefined && typeof payload.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be a boolean.' }, { status: 400 });
    }

    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string' || !payload.name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string if provided.' }, { status: 400 });
      }
    }

    if (payload.role !== undefined) {
      if (typeof payload.role !== 'string' || !payload.role.trim()) {
        return NextResponse.json({ error: 'role must be a non-empty string if provided.' }, { status: 400 });
      }
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user record not found.' }, { status: 404 });
    }

    // LAST SUPER ADMIN PROTECTION ENFORCEMENT
    const isTargetActiveSuperAdmin = targetUser.role === 'SUPER_ADMIN' && targetUser.is_active;

    if (isTargetActiveSuperAdmin) {
      const isDeactivating = payload.isActive === false;
      const isChangingRole = payload.role !== undefined && payload.role !== 'SUPER_ADMIN';

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

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const isActivationOnly =
      payload.isActive !== undefined &&
      payload.role === undefined &&
      payload.name === undefined &&
      payload.procurementSourceId === undefined;

    if (isActivationOnly) {
      const actionName = payload.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
      const updatedUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: targetUserId },
          data: {
            is_active: Boolean(payload.isActive),
          },
        });

        await tx.auditLog.create({
          data: {
            table_name: 'users',
            record_id: targetUserId,
            action: actionName,
            old_values: {
              username: targetUser.username,
              role: targetUser.role,
              department: targetUser.department,
              scope_type: targetUser.scope_type,
              procurement_source_id: targetUser.procurement_source_id ? targetUser.procurement_source_id.toString() : null,
              is_active: targetUser.is_active,
            },
            new_values: {
              username: user.username,
              role: user.role,
              department: user.department,
              scope_type: user.scope_type,
              procurement_source_id: user.procurement_source_id ? user.procurement_source_id.toString() : null,
              is_active: user.is_active,
            },
            user_id: adminUser?.id || null,
          },
        });

        return user;
      });

      return NextResponse.json({
        success: true,
        user: {
          id: updatedUser.id.toString(),
          username: updatedUser.username,
          name: updatedUser.full_name,
          role: updatedUser.role,
          department: updatedUser.department,
          scopeType: updatedUser.scope_type,
          procurementSourceId: updatedUser.procurement_source_id ? updatedUser.procurement_source_id.toString() : null,
          isActive: updatedUser.is_active,
        },
      });
    }

    const effectiveRoleStr = payload.role !== undefined ? (payload.role as string).trim() : targetUser.role;
    const policy = getRoleAssignmentPolicy(effectiveRoleStr);
    if (!policy) {
      return NextResponse.json(
        { error: `Role "${effectiveRoleStr}" is not a creatable role. Legacy, retired, or invalid roles are rejected.` },
        { status: 400 }
      );
    }

    let effectivePsId: bigint | null = null;
    const rawPsId = payload.procurementSourceId;

    if (policy.requiresSource) {
      let candidatePsId: bigint;
      if (rawPsId !== undefined) {
        if (rawPsId === null || rawPsId === '') {
          return NextResponse.json(
            { error: `Role ${policy.role} requires an active ${policy.allowedSourceType} procurement source assignment.` },
            { status: 400 }
          );
        }
        try {
          candidatePsId = BigInt(String(rawPsId).trim());
        } catch {
          return NextResponse.json({ error: 'Invalid procurementSourceId format.' }, { status: 400 });
        }
      } else {
        if (!targetUser.procurement_source_id) {
          return NextResponse.json(
            { error: `Role ${policy.role} requires an active ${policy.allowedSourceType} procurement source assignment.` },
            { status: 400 }
          );
        }
        candidatePsId = targetUser.procurement_source_id;
      }

      const ps = await prisma.procurementSource.findUnique({ where: { id: candidatePsId } });
      if (!ps) {
        return NextResponse.json({ error: 'Assigned Procurement Source not found.' }, { status: 400 });
      }
      if (!ps.is_active) {
        return NextResponse.json({ error: `Assigned Procurement Source "${ps.name}" is inactive. Active source is required.` }, { status: 400 });
      }
      if (ps.source_type !== policy.allowedSourceType) {
        return NextResponse.json(
          { error: `Role ${policy.role} cannot be assigned to ${ps.source_type} source "${ps.name}". Expected ${policy.allowedSourceType}.` },
          { status: 400 }
        );
      }
      effectivePsId = ps.id;
    } else {
      if (rawPsId !== undefined && rawPsId !== null && rawPsId !== '') {
        return NextResponse.json(
          { error: `Role ${policy.role} is a department or system role and cannot be assigned a procurement source.` },
          { status: 400 }
        );
      }
      effectivePsId = null;
    }

    const newFullName = payload.name !== undefined ? (payload.name as string).trim() : targetUser.full_name;
    const newIsActive = payload.isActive !== undefined ? Boolean(payload.isActive) : targetUser.is_active;

    const actionName =
      payload.isActive === false && targetUser.is_active
        ? 'USER_DEACTIVATED'
        : payload.isActive === true && !targetUser.is_active
        ? 'USER_ACTIVATED'
        : 'USER_UPDATED';

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: {
          full_name: newFullName,
          role: policy.role,
          department: policy.department,
          scope_type: policy.scopeType,
          procurement_source_id: effectivePsId,
          is_active: newIsActive,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'users',
          record_id: targetUserId,
          action: actionName,
          old_values: {
            username: targetUser.username,
            role: targetUser.role,
            department: targetUser.department,
            scope_type: targetUser.scope_type,
            procurement_source_id: targetUser.procurement_source_id ? targetUser.procurement_source_id.toString() : null,
            is_active: targetUser.is_active,
          },
          new_values: {
            username: user.username,
            role: user.role,
            department: user.department,
            scope_type: user.scope_type,
            procurement_source_id: user.procurement_source_id ? user.procurement_source_id.toString() : null,
            is_active: user.is_active,
          },
          user_id: adminUser?.id || null,
        },
      });

      return user;
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id.toString(),
        username: updatedUser.username,
        name: updatedUser.full_name,
        role: updatedUser.role,
        department: updatedUser.department,
        scopeType: updatedUser.scope_type,
        procurementSourceId: updatedUser.procurement_source_id ? updatedUser.procurement_source_id.toString() : null,
        isActive: updatedUser.is_active,
      },
    });
  } catch (err: any) {
    console.error('[API_SUPER_ADMIN_USERS_PATCH_ERROR]', err);
    return NextResponse.json({ error: 'Failed to update user record.' }, { status: 500 });
  }
}
