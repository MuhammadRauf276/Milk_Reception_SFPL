import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

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
    const body = await req.json();
    const targetSource = await prisma.procurementSource.findUnique({ where: { id: sourceId } });
    if (!targetSource) {
      return NextResponse.json({ error: 'Target procurement source record not found.' }, { status: 404 });
    }

    // 1. Source Identity Immutability: reject attempts to modify code or sourceType
    if (body.code !== undefined && body.code.trim().toUpperCase() !== targetSource.code) {
      return NextResponse.json(
        { error: 'Source Code is immutable and cannot be changed after creation.' },
        { status: 400 }
      );
    }

    if (body.sourceType !== undefined && body.sourceType.trim().toUpperCase() !== targetSource.source_type) {
      return NextResponse.json(
        { error: 'Source Type is immutable and cannot be changed after creation.' },
        { status: 400 }
      );
    }

    // 2. Validate edited name if provided
    let newName = targetSource.name;
    if (body.name !== undefined) {
      const trimmedName = body.name.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'Source name cannot be empty.' }, { status: 400 });
      }
      newName = trimmedName;
    }

    // 3. Deactivation Safety Checks
    const isDeactivating = body.isActive === false && targetSource.is_active === true;
    if (isDeactivating) {
      // Check A: Active users assigned to this source
      const activeAssignedUsersCount = await prisma.user.count({
        where: {
          procurement_source_id: sourceId,
          is_active: true,
        },
      });

      if (activeAssignedUsersCount > 0) {
        return NextResponse.json(
          {
            error: `Cannot deactivate procurement source "${targetSource.name}". There are ${activeAssignedUsersCount} active user(s) currently assigned to this source. Please reassign or deactivate affected users first.`,
          },
          { status: 409 }
        );
      }

      // Check B: Active/incomplete vehicle visits belonging to this source
      const incompleteVisitsCount = await prisma.vehicleVisit.count({
        where: {
          procurement_source_id: sourceId,
          current_status: { not: 'COMPLETED' },
        },
      });

      if (incompleteVisitsCount > 0) {
        return NextResponse.json(
          {
            error: `Cannot deactivate procurement source "${targetSource.name}". There are ${incompleteVisitsCount} active or in-progress vehicle visit(s) currently associated with this source. Please complete all active visits first.`,
          },
          { status: 409 }
        );
      }
    }

    const newIsActive = body.isActive !== undefined ? Boolean(body.isActive) : targetSource.is_active;

    // Determine audit action
    let actionName = 'PROCUREMENT_SOURCE_UPDATED';
    if (body.isActive !== undefined && body.isActive !== targetSource.is_active) {
      actionName = newIsActive ? 'PROCUREMENT_SOURCE_ACTIVATED' : 'PROCUREMENT_SOURCE_DEACTIVATED';
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const updatedSource = await prisma.$transaction(async (tx) => {
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
    return NextResponse.json({ error: err.message || 'Failed to update procurement source.' }, { status: 500 });
  }
}
