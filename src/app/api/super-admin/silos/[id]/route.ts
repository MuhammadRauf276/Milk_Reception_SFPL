import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getSiloCurrentStockLiters, getSiloActiveReservedLiters, getSiloStockVolumeState } from '@/backend/services/siloInventoryService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }
  if (authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: siloIdStr } = await params;
  if (!siloIdStr || !/^\d+$/.test(siloIdStr.trim())) {
    return NextResponse.json({ error: 'Invalid silo ID provided.' }, { status: 400 });
  }
  const siloId = BigInt(siloIdStr.trim());

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a valid JSON object.' }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'Update payload cannot be empty.' }, { status: 400 });
  }

  if ('siloCode' in body || 'silo_code' in body) {
    return NextResponse.json({ error: 'Silo code is immutable and cannot be updated.' }, { status: 400 });
  }

  const allowedPatchKeys = new Set(['siloName', 'capacityLiters', 'isActive']);
  const unknownKeys = Object.keys(body).filter((k) => !allowedPatchKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: `Unknown field in update request: ${unknownKeys.join(', ')}` },
      { status: 400 }
    );
  }

  if (body.siloName !== undefined) {
    if (typeof body.siloName !== 'string' || !body.siloName.trim()) {
      return NextResponse.json({ error: 'Silo name must be a non-empty string.' }, { status: 400 });
    }
  }

  if (body.capacityLiters !== undefined) {
    if (
      typeof body.capacityLiters !== 'number' ||
      !Number.isFinite(body.capacityLiters) ||
      isNaN(body.capacityLiters) ||
      body.capacityLiters <= 0
    ) {
      return NextResponse.json(
        { error: 'Silo capacity must be a positive finite number greater than 0 Liters.' },
        { status: 400 }
      );
    }
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be a boolean value.' }, { status: 400 });
    }
  }

  try {
    if (!authUser.id || !/^\d+$/.test(authUser.id.trim())) {
      return NextResponse.json({ error: 'Unauthorized. Invalid authentication session.' }, { status: 401 });
    }
    const actorUserId = BigInt(authUser.id.trim());
    const actorUser = await prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!actorUser || !actorUser.is_active || actorUser.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
    }

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Acquire necessary PostgreSQL row-level lock strictly FIRST
      await tx.$executeRaw`SELECT id FROM silo WHERE id = ${siloId} FOR UPDATE`;

      // 2. Re-read current silo
      const targetSilo = await tx.silo.findUnique({ where: { id: siloId } });
      if (!targetSilo) {
        return { status: 404, error: 'Target Silo record not found.' };
      }

      // 3. Calculate authoritative inventory & active operational dependencies
      const stockState = await getSiloStockVolumeState(siloId, tx);
      const currentStockLiters = stockState.knownLiters;
      const activeReservationsLiters = await getSiloActiveReservedLiters(siloId, tx);

      // 4. Validate Capacity Mutation
      let newCapacity = Number(targetSilo.capacity_liters);
      if (body.capacityLiters !== undefined) {
        newCapacity = body.capacityLiters;
        if (newCapacity < currentStockLiters) {
          return {
            status: 409,
            error: `Capacity reduction rejected. Proposed capacity (${newCapacity.toLocaleString()} L) cannot be less than authoritative current stock (${Math.round(currentStockLiters).toLocaleString()} L).`,
          };
        }
        if (newCapacity < currentStockLiters + activeReservationsLiters) {
          return {
            status: 409,
            error: `Capacity reduction rejected. Proposed capacity (${newCapacity.toLocaleString()} L) cannot be less than committed volume (${Math.round(currentStockLiters + activeReservationsLiters).toLocaleString()} L = ${Math.round(currentStockLiters).toLocaleString()} L stock + ${Math.round(activeReservationsLiters).toLocaleString()} L active reservations).`,
          };
        }
      }

      // 5. Validate Deactivation Safety
      let newActive = targetSilo.is_active;
      let action = 'SILO_UPDATED';

      if (body.isActive !== undefined) {
        newActive = body.isActive;

        if (!newActive && targetSilo.is_active) {
          // Rule 4: Block deactivation if stock > 0
          if (currentStockLiters > 0) {
            return {
              status: 409,
              error: `Cannot deactivate silo "${targetSilo.silo_name}" (${targetSilo.silo_code}): Silo currently contains ${Math.round(currentStockLiters).toLocaleString()} L of milk stock. All stock must be issued before deactivation.`,
            };
          }

          // Rule 4: Block deactivation if incomplete vehicle/portion assigned or unloading in progress
          const activeUnloadings = await tx.unloadingLog.findMany({
            where: {
              silo_id: siloId,
              portion: {
                visit: {
                  current_status: { in: ['READY_FOR_UNLOADING', 'UNLOADING', 'READY_FOR_TARE', 'TARE_WEIGHED'] },
                },
              },
            },
            include: {
              portion: {
                include: { visit: true },
              },
            },
          });

          if (activeUnloadings.length > 0) {
            const visitNumbers = Array.from(new Set(activeUnloadings.map((u) => u.portion.visit.visit_number))).join(', ');
            return {
              status: 409,
              error: `Cannot deactivate silo "${targetSilo.silo_name}" (${targetSilo.silo_code}): Active unloading or pending reception in progress for vehicle visit(s): ${visitNumbers}.`,
            };
          }

          const inProgressPumps = await tx.unloadingLog.findMany({
            where: {
              silo_id: siloId,
              pump_start_timestamp: { not: null },
              complete_submitted_at: null,
            },
            include: {
              portion: {
                include: { visit: true },
              },
            },
          });

          if (inProgressPumps.length > 0) {
            const visitNumbers = Array.from(new Set(inProgressPumps.map((u) => u.portion.visit.visit_number))).join(', ');
            return {
              status: 409,
              error: `Cannot deactivate silo "${targetSilo.silo_name}" (${targetSilo.silo_code}): Pump offloading currently in progress for vehicle visit(s): ${visitNumbers}.`,
            };
          }

          if (activeReservationsLiters > 0) {
            return {
              status: 409,
              error: `Cannot deactivate silo "${targetSilo.silo_name}" (${targetSilo.silo_code}): Silo has active reservations (${Math.round(activeReservationsLiters).toLocaleString()} L) pending final weighment or receipt.`,
            };
          }

          action = 'SILO_DEACTIVATED';
        } else if (newActive && !targetSilo.is_active) {
          action = 'SILO_ACTIVATED';
        }
      }

      let newName = targetSilo.silo_name;
      if (body.siloName !== undefined) {
        newName = body.siloName.trim();
      }

      // 6. Perform Database Mutation
      const updatedSilo = await tx.silo.update({
        where: { id: siloId },
        data: {
          silo_name: newName,
          capacity_liters: newCapacity,
          is_active: newActive,
          updated_by: actorUser.id,
        },
      });

      // 7. Create Atomic Audit Record
      await tx.auditLog.create({
        data: {
          table_name: 'silo',
          record_id: siloId,
          action,
          old_values: {
            silo_name: targetSilo.silo_name,
            capacity_liters: Number(targetSilo.capacity_liters),
            is_active: targetSilo.is_active,
          },
          new_values: {
            silo_name: updatedSilo.silo_name,
            capacity_liters: Number(updatedSilo.capacity_liters),
            is_active: updatedSilo.is_active,
          },
          user_id: actorUser.id,
        },
      });

      return {
        status: 200,
        silo: {
          id: updatedSilo.id.toString(),
          siloCode: updatedSilo.silo_code,
          siloName: updatedSilo.silo_name,
          capacityLiters: Number(updatedSilo.capacity_liters),
          currentStockLiters,
          activeReservationsLiters,
          isActive: updatedSilo.is_active,
        },
      };
    });

    if (txResult.status !== 200) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    return NextResponse.json({
      success: true,
      silo: txResult.silo,
    });
  } catch (_err) {
    return NextResponse.json(
      { error: 'An unexpected error occurred while updating the silo.' },
      { status: 500 }
    );
  }
}
