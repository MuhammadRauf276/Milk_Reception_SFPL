import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

class DeactivationConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DeactivationConflictError';
  }
}

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

const ALLOWED_PATCH_FIELDS = new Set(['name', 'isActive', 'code', 'sourceType']);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: sourceIdStr } = await params;
  let sourceId: bigint;
  try {
    sourceId = BigInt(sourceIdStr);
  } catch {
    return NextResponse.json({ error: 'Invalid procurement source ID format.' }, { status: 400 });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    // 1. Request body must be a plain object
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a valid JSON object.' }, { status: 400 });
    }

    const keys = Object.keys(body);

    // 2. Reject empty/no-operation PATCH body
    if (keys.length === 0) {
      return NextResponse.json({ error: 'Request body cannot be empty.' }, { status: 400 });
    }

    // 3. Reject unknown fields
    for (const key of keys) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return NextResponse.json({ error: `Unknown field '${key}' in request body.` }, { status: 400 });
      }
    }

    // Ensure at least one mutable field or checked field is present
    const hasName = 'name' in body;
    const hasIsActive = 'isActive' in body;
    const hasCode = 'code' in body;
    const hasSourceType = 'sourceType' in body;

    // 4. Validate types of supplied fields
    let trimmedName: string | undefined;
    if (hasName) {
      if (typeof body.name !== 'string') {
        return NextResponse.json({ error: 'Source name must be a string.' }, { status: 400 });
      }
      trimmedName = body.name.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'Source name cannot be empty.' }, { status: 400 });
      }
    }

    if (hasIsActive) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive must be a boolean value.' }, { status: 400 });
      }
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    // 5. Execute read, immutability check, blocker checks, mutation, and audit in a single atomic transaction
    const updatedSource = await prisma.$transaction(async (tx) => {
      // Re-read target source inside the transaction
      const targetSource = await tx.procurementSource.findUnique({ where: { id: sourceId } });
      if (!targetSource) {
        throw new NotFoundError('Target procurement source record not found.');
      }

      // Immutability checks: code & sourceType
      if (hasCode) {
        if (typeof body.code !== 'string' || body.code.trim().toUpperCase() !== targetSource.code) {
          throw new ValidationError('Source Code is immutable and cannot be changed after creation.');
        }
      }

      if (hasSourceType) {
        if (typeof body.sourceType !== 'string' || body.sourceType.trim().toUpperCase() !== targetSource.source_type) {
          throw new ValidationError('Source Type is immutable and cannot be changed after creation.');
        }
      }

      const newName = trimmedName !== undefined ? trimmedName : targetSource.name;
      const newIsActive = hasIsActive ? body.isActive : targetSource.is_active;

      // Deactivation Safety Checks inside the transaction
      const isDeactivating = hasIsActive && body.isActive === false && targetSource.is_active === true;
      if (isDeactivating) {
        const activeAssignedUsersCount = await tx.user.count({
          where: {
            procurement_source_id: sourceId,
            is_active: true,
          },
        });

        if (activeAssignedUsersCount > 0) {
          throw new DeactivationConflictError(
            `Cannot deactivate procurement source "${targetSource.name}". There are ${activeAssignedUsersCount} active user(s) currently assigned to this source. Please reassign or deactivate affected users first.`
          );
        }

        const incompleteVisitsCount = await tx.vehicleVisit.count({
          where: {
            procurement_source_id: sourceId,
            current_status: { not: 'COMPLETED' },
          },
        });

        if (incompleteVisitsCount > 0) {
          throw new DeactivationConflictError(
            `Cannot deactivate procurement source "${targetSource.name}". There are ${incompleteVisitsCount} active or in-progress vehicle visit(s) currently associated with this source. Please complete all active visits first.`
          );
        }
      }

      // Determine audit action
      let actionName = 'PROCUREMENT_SOURCE_UPDATED';
      if (hasIsActive && body.isActive !== targetSource.is_active) {
        actionName = newIsActive ? 'PROCUREMENT_SOURCE_ACTIVATED' : 'PROCUREMENT_SOURCE_DEACTIVATED';
      }

      const source = await tx.procurementSource.update({
        where: { id: sourceId },
        data: {
          name: newName,
          is_active: newIsActive,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'procurement_source',
          record_id: sourceId,
          action: actionName,
          old_values: { name: targetSource.name, is_active: targetSource.is_active },
          new_values: { name: source.name, is_active: source.is_active },
          user_id: adminUser?.id || null,
        },
      });

      return source;
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
    if (err instanceof DeactivationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }

    console.error('Unexpected error in PATCH /api/super-admin/procurement-sources/[id]:', err);
    return NextResponse.json({ error: 'Failed to update procurement source.' }, { status: 500 });
  }
}
