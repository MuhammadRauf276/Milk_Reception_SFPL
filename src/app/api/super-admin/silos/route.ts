import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const silos = await prisma.silo.findMany({
      orderBy: { silo_code: 'asc' },
    });

    const serialized = await Promise.all(
      silos.map(async (s) => {
        // Calculate ledger stock from SiloInventoryTransaction
        const txs = await prisma.siloInventoryTransaction.findMany({
          where: { silo_id: s.id },
        });

        let currentStockLiters = 0;
        for (const tx of txs) {
          const qty = Number(tx.quantity_liters || 0);
          if (tx.transaction_type === 'RECEIPT') {
            currentStockLiters += qty;
          } else if (tx.transaction_type === 'ISSUE') {
            currentStockLiters -= qty;
          }
        }

        // Active reservations: UnloadingLogs that are IN_PROGRESS or COMPLETED without final silo receipt
        const activeUnloadingLogs = await prisma.unloadingLog.findMany({
          where: {
            silo_id: s.id,
            pump_end_timestamp: null,
          },
          include: {
            portion: true,
          },
        });

        let activeReservationsLiters = 0;
        for (const ul of activeUnloadingLogs) {
          activeReservationsLiters += Number(ul.portion.dispatch_quantity_value || 0);
        }

        return {
          id: s.id.toString(),
          siloCode: s.silo_code,
          siloName: s.silo_name,
          capacityLiters: Number(s.capacity_liters),
          currentStockLiters: Math.max(0, currentStockLiters),
          activeReservationsLiters,
          isActive: s.is_active,
          createdAt: s.created_at.toISOString(),
        };
      })
    );

    return NextResponse.json({ silos: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const siloCode = (body.siloCode || '').trim().toUpperCase();
    const siloName = (body.siloName || '').trim();
    const capacityLiters = Number(body.capacityLiters || 0);

    if (!siloCode || !siloName || capacityLiters <= 0) {
      return NextResponse.json({ error: 'Silo Code, Name, and Capacity (> 0 Liters) are required.' }, { status: 400 });
    }

    const existing = await prisma.silo.findUnique({ where: { silo_code: siloCode } });
    if (existing) {
      return NextResponse.json({ error: `Silo Code "${siloCode}" already exists.` }, { status: 400 });
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const newSilo = await prisma.silo.create({
      data: {
        silo_code: siloCode,
        silo_name: siloName,
        capacity_liters: capacityLiters,
        is_active: true,
        created_by: adminUser?.id || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'silo',
        record_id: newSilo.id,
        action: 'SILO_CREATED',
        new_values: { silo_code: siloCode, silo_name: siloName, capacity_liters: capacityLiters },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      silo: {
        id: newSilo.id.toString(),
        siloCode: newSilo.silo_code,
        siloName: newSilo.silo_name,
        capacityLiters: Number(newSilo.capacity_liters),
        currentStockLiters: 0,
        activeReservationsLiters: 0,
        isActive: newSilo.is_active,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
