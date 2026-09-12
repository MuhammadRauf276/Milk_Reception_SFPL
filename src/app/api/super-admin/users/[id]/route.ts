import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getRoleAssignmentPolicy, isCreatableRole } from '@/lib/user-assignment-policy';

// Fixed documented PostgreSQL transaction-level advisory lock key used across
// all user creation (POST) and mutation (PATCH) transactions to serialize
// sensitive account operations and prevent cross-transaction deadlocks.
const USER_MUTATION_ADVISORY_LOCK_KEY = BigInt(74829104);

class ValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

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
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
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

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    // Execute advisory lock, row lock, re-read, last-SA check, activation safety, source lock, mutation, and audit in single transaction
    const updatedUser = await prisma.$transaction(async (tx) => {
      // 1. Advisory transaction lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${USER_MUTATION_ADVISORY_LOCK_KEY})`;

      // 2. Target user row lock
      const lockedUserRows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM users WHERE id = ${targetUserId} FOR UPDATE
      `;
      if (!lockedUserRows || lockedUserRows.length === 0) {
        throw new NotFoundError('Target user record not found.');
      }

      // 3. Fresh read of target user
      const targetUser = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        throw new NotFoundError('Target user record not found.');
      }

      // 4. Last Super Admin protection check (serialized via advisory lock; no multi-row lock to prevent deadlocks)
      const isTargetActiveSuperAdmin = targetUser.role === 'SUPER_ADMIN' && targetUser.is_active;

      if (isTargetActiveSuperAdmin) {
        const isDeactivating = payload.isActive === false;
        const isChangingRole = payload.role !== undefined && payload.role !== 'SUPER_ADMIN';

        if (isDeactivating || isChangingRole) {
          const activeSuperAdminCount = await tx.user.count({
            where: { role: 'SUPER_ADMIN', is_active: true },
          });

          if (activeSuperAdminCount <= 1) {
            throw new ValidationError('Action blocked: Cannot deactivate or reassign the last active Super Admin account.');
          }
        }
      }

      const isActivating = !targetUser.is_active && payload.isActive === true;
      const isActivationOnly =
        payload.isActive !== undefined &&
        payload.role === undefined &&
        payload.name === undefined &&
        payload.procurementSourceId === undefined;

      if (isActivationOnly) {
        if (isActivating) {
          // ACTIVATION SAFETY:
          // Reactivation is allowed only when the stored role is currently creatable and
          // its stored scope, department and source assignment exactly match the shared policy.
          if (!isCreatableRole(targetUser.role)) {
            throw new ValidationError(
              `Cannot activate user: Role "${targetUser.role}" is retired or invalid. Edit user to assign a creatable role first.`
            );
          }

          const storedPolicy = getRoleAssignmentPolicy(targetUser.role)!;

          if (targetUser.scope_type !== storedPolicy.scopeType) {
            throw new ValidationError(
              `Cannot activate user: Stored scopeType "${targetUser.scope_type}" does not match current role policy "${storedPolicy.scopeType}". Edit user first.`
            );
          }

          if (targetUser.department !== storedPolicy.department) {
            throw new ValidationError(
              `Cannot activate user: Stored department "${targetUser.department}" does not match current role policy "${storedPolicy.department}". Edit user first.`
            );
          }

          if (storedPolicy.requiresSource) {
            if (!targetUser.procurement_source_id) {
              throw new ValidationError(
                `Cannot activate user: Role ${storedPolicy.role} requires an assigned procurement source. Edit user first.`
              );
            }

            // Lock and re-read the procurement source inside the transaction
            const lockedPs = await tx.$queryRaw<Array<{ id: bigint }>>`
              SELECT id FROM procurement_source WHERE id = ${targetUser.procurement_source_id} FOR UPDATE
            `;
            if (!lockedPs || lockedPs.length === 0) {
              throw new ValidationError('Cannot activate user: Assigned procurement source not found.');
            }

            const ps = await tx.procurementSource.findUnique({ where: { id: targetUser.procurement_source_id } });
            if (!ps) {
              throw new ValidationError('Cannot activate user: Assigned procurement source not found.');
            }
            if (!ps.is_active) {
              throw new ValidationError(`Cannot activate user: Assigned procurement source "${ps.name}" is inactive. Active source is required.`);
            }
            if (ps.source_type !== storedPolicy.allowedSourceType) {
              throw new ValidationError(
                `Cannot activate user: Assigned procurement source "${ps.name}" is ${ps.source_type}, expected ${storedPolicy.allowedSourceType}.`
              );
            }
          } else {
            if (targetUser.procurement_source_id !== null) {
              throw new ValidationError(
                `Cannot activate user: Role ${storedPolicy.role} is not a source role and cannot have an assigned procurement source. Edit user first.`
              );
            }
          }
        }

        const actionName = payload.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
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
      }

      // EDIT USER FLOW
      const effectiveRoleStr = payload.role !== undefined ? (payload.role as string).trim() : targetUser.role;
      const policy = getRoleAssignmentPolicy(effectiveRoleStr);
      if (!policy) {
        throw new ValidationError(
          `Role "${effectiveRoleStr}" is not a creatable role. Legacy, retired, or invalid roles are rejected.`
        );
      }

      let effectivePsId: bigint | null = null;
      const rawPsId = payload.procurementSourceId;

      if (policy.requiresSource) {
        let candidatePsId: bigint;
        if (rawPsId !== undefined) {
          if (rawPsId === null || rawPsId === '') {
            throw new ValidationError(
              `Role ${policy.role} requires an active ${policy.allowedSourceType} procurement source assignment.`
            );
          }
          try {
            candidatePsId = BigInt(String(rawPsId).trim());
          } catch {
            throw new ValidationError('Invalid procurementSourceId format.');
          }
        } else {
          if (!targetUser.procurement_source_id) {
            throw new ValidationError(
              `Role ${policy.role} requires an active ${policy.allowedSourceType} procurement source assignment.`
            );
          }
          candidatePsId = targetUser.procurement_source_id;
        }

        // For a source-bound assignment, lock and re-read the procurement source inside the same transaction
        const lockedPs = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM procurement_source WHERE id = ${candidatePsId} FOR UPDATE
        `;
        if (!lockedPs || lockedPs.length === 0) {
          throw new ValidationError('Assigned Procurement Source not found.');
        }

        const ps = await tx.procurementSource.findUnique({ where: { id: candidatePsId } });
        if (!ps) {
          throw new ValidationError('Assigned Procurement Source not found.');
        }
        if (!ps.is_active) {
          throw new ValidationError(`Assigned Procurement Source "${ps.name}" is inactive. Active source is required.`);
        }
        if (ps.source_type !== policy.allowedSourceType) {
          throw new ValidationError(
            `Role ${policy.role} cannot be assigned to ${ps.source_type} source "${ps.name}". Expected ${policy.allowedSourceType}.`
          );
        }
        effectivePsId = ps.id;
      } else {
        if (rawPsId !== undefined && rawPsId !== null && rawPsId !== '') {
          throw new ValidationError(
            `Role ${policy.role} is a department or system role and cannot be assigned a procurement source.`
          );
        }
        effectivePsId = null;
      }

      const newFullName = payload.name !== undefined ? (payload.name as string).trim() : targetUser.full_name;
      const newIsActive = payload.isActive !== undefined ? Boolean(payload.isActive) : targetUser.is_active;

      const actionName =
        newIsActive === false && targetUser.is_active
          ? 'USER_DEACTIVATED'
          : newIsActive === true && !targetUser.is_active
          ? 'USER_ACTIVATED'
          : 'USER_UPDATED';

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
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }

    console.error('Unexpected error in PATCH /api/super-admin/users/[id]:', err);
    return NextResponse.json({ error: 'Failed to update user record.' }, { status: 500 });
  }
}
