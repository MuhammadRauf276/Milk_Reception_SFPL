import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getSiloCurrentStockLiters, getSiloActiveReservedLiters } from '@/backend/services/siloInventoryService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: siloIdStr } = await params;
  const siloId = BigInt(siloIdStr);

  try {
    const body = await req.json();
    const targetSilo = await prisma.silo.findUnique({ where: { id: siloId } });
    if (!targetSilo) {
      return NextResponse.json({ error: 'Target Silo record not found.' }, { status: 404 });
    }

    const newCapacity = body.capacityLiters !== undefined ? Number(body.capacityLiters) : Number(targetSilo.capacity_liters);

    if (newCapacity <= 0) {
      return NextResponse.json({ error: 'Silo capacity must be greater than 0 Liters.' }, { status: 400 });
    }

    // SILO CAPACITY VALIDATION AGAINST AUTHORITATIVE LEDGER STOCK AND PROVISIONAL RESERVATIONS
    const currentStockLiters = await getSiloCurrentStockLiters(siloId);
    const activeReservationsLiters = await getSiloActiveReservedLiters(siloId);
    const totalCommittedLiters = currentStockLiters + activeReservationsLiters;

    if (newCapacity < totalCommittedLiters) {
      return NextResponse.json(
        {
          error: `Capacity reduction rejected. Proposed capacity (${newCapacity.toLocaleString()} L) is lower than current committed volume (${totalCommittedLiters.toLocaleString()} L = ${currentStockLiters.toLocaleString()} L stock + ${activeReservationsLiters.toLocaleString()} L active reservations).`,
        },
        { status: 400 }
      );
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const updatedSilo = await prisma.silo.update({
      where: { id: siloId },
      data: {
        silo_name: body.siloName !== undefined ? body.siloName.trim() : targetSilo.silo_name,
        capacity_liters: newCapacity,
        is_active: body.isActive !== undefined ? Boolean(body.isActive) : targetSilo.is_active,
        updated_by: adminUser?.id || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'silo',
        record_id: siloId,
        action: 'SILO_UPDATED',
        old_values: { capacity_liters: Number(targetSilo.capacity_liters), is_active: targetSilo.is_active },
        new_values: { capacity_liters: Number(updatedSilo.capacity_liters), is_active: updatedSilo.is_active },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      silo: {
        id: updatedSilo.id.toString(),
        siloCode: updatedSilo.silo_code,
        siloName: updatedSilo.silo_name,
        capacityLiters: Number(updatedSilo.capacity_liters),
        currentStockLiters,
        activeReservationsLiters,
        isActive: updatedSilo.is_active,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
