import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

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

const ALLOWED_PATCH_FIELDS = new Set(['name', 'isActive', 'code', 'sourceType', 'erpCode']);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
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
    let body: Record<string, unknown>;
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

    let erpCodeInput: string | undefined;
    if ('erpCode' in body) {
      if (typeof body.erpCode !== 'string' || !body.erpCode.trim()) {
        return NextResponse.json({ error: 'ERP code must be a non-empty text.' }, { status: 400 });
      }
      erpCodeInput = body.erpCode.trim().slice(0, 50);
    }

    // Validated above; narrowed for use in the transaction.
    const isActiveInput = typeof body.isActive === 'boolean' ? body.isActive : undefined;

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    // 5. Execute lock, re-read, immutability check, blocker checks, mutation, and audit in a single atomic transaction
    const updatedSource = await prisma.$transaction(async (tx) => {
      // 1. Lock target procurement source using SELECT ... FOR UPDATE
      const lockedRows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM procurement_source WHERE id = ${sourceId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundError('Target procurement source record not found.');
      }

      // 2. Re-read and verify the source
      const targetSource = await tx.procurementSource.findUnique({ where: { id: sourceId } });
      if (!targetSource) {
        throw new NotFoundError('Target procurement source record not found.');
      }

      // 3. Validate immutable fields
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

      if (erpCodeInput !== undefined && targetSource.source_type !== 'CONTRACTOR') {
        throw new ValidationError('ERP code applies to contractors only.');
      }

      const newName = trimmedName !== undefined ? trimmedName : targetSource.name;
      const newIsActive = isActiveInput ?? targetSource.is_active;

      // 4 & 5. Deactivation Safety Checks inside the transaction
      const isDeactivating = hasIsActive && body.isActive === false && targetSource.is_active === true;
      if (isDeactivating) {
        // 4. Check active assigned users
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

        // 5. Check incomplete vehicle visits
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

      // 6. Update the source
      let actionName = 'PROCUREMENT_SOURCE_UPDATED';
      if (hasIsActive && body.isActive !== targetSource.is_active) {
        actionName = newIsActive ? 'PROCUREMENT_SOURCE_ACTIVATED' : 'PROCUREMENT_SOURCE_DEACTIVATED';
      }

      const source = await tx.procurementSource.update({
        where: { id: sourceId },
        data: {
          name: newName,
          is_active: newIsActive,
          ...(erpCodeInput !== undefined ? { erp_code: erpCodeInput } : {}),
        },
      });

      // 7. Create the audit record
      await writeAuditLog(tx, {
        tableName: 'procurement_source',
        recordId: sourceId,
        action: actionName,
        oldValues: { name: targetSource.name, is_active: targetSource.is_active, erp_code: targetSource.erp_code },
        newValues: { name: source.name, is_active: source.is_active, erp_code: source.erp_code },
        actor: { ...auditActorFromUser(authUser), userId: adminUser?.id ?? null },
      });

      // 8. Return for atomic commit
      return source;
    });

    return NextResponse.json({
      success: true,
      source: {
        id: updatedSource.id.toString(),
        code: updatedSource.code,
        name: updatedSource.name,
        erpCode: updatedSource.erp_code,
        sourceType: updatedSource.source_type,
        isActive: updatedSource.is_active,
      },
    });
  } catch (err) {
    if (err instanceof DeactivationConflictError) {
      return NextResponse.json({ error: getErrorMessage(err) }, { status: 409 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: getErrorMessage(err) }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: getErrorMessage(err) }, { status: 404 });
    }

    console.error('Unexpected error in PATCH /api/super-admin/procurement-sources/[id]:', err);
    return NextResponse.json({ error: 'Failed to update procurement source.' }, { status: 500 });
  }
}
