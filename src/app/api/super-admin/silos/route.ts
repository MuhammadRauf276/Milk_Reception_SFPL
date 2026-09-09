import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getSiloCurrentStockLiters, getSiloActiveReservedLiters } from '@/backend/services/siloInventoryService';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }
  if (authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const silos = await prisma.silo.findMany({
      orderBy: { silo_code: 'asc' },
    });

    const serialized = await Promise.all(
      silos.map(async (s) => {
        let currentStockLiters = 0;
        let activeReservationsLiters = 0;
        try {
          currentStockLiters = await getSiloCurrentStockLiters(s.id, undefined, { allowIncomplete: true });
        } catch (_e) {
          currentStockLiters = 0;
        }
        try {
          activeReservationsLiters = await getSiloActiveReservedLiters(s.id);
        } catch (_e) {
          activeReservationsLiters = 0;
        }

        return {
          id: s.id.toString(),
          siloCode: s.silo_code,
          siloName: s.silo_name,
          capacityLiters: Number(s.capacity_liters),
          currentStockLiters,
          activeReservationsLiters,
          isActive: s.is_active,
          createdAt: s.created_at.toISOString(),
        };
      })
    );

    return NextResponse.json({ silos: serialized });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching silos.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }
  if (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a valid JSON object.' }, { status: 400 });
  }

  const allowedKeys = new Set(['siloCode', 'siloName', 'capacityLiters']);
  const unknownKeys = Object.keys(body).filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: `Unknown property in request body: ${unknownKeys.join(', ')}` },
      { status: 400 }
    );
  }

  if (typeof body.siloCode !== 'string' || !body.siloCode.trim()) {
    return NextResponse.json({ error: 'Silo Code is required and must be a non-empty string.' }, { status: 400 });
  }

  if (typeof body.siloName !== 'string' || !body.siloName.trim()) {
    return NextResponse.json({ error: 'Silo Name is required and must be a non-empty string.' }, { status: 400 });
  }

  if (
    typeof body.capacityLiters !== 'number' ||
    !Number.isFinite(body.capacityLiters) ||
    isNaN(body.capacityLiters) ||
    body.capacityLiters <= 0
  ) {
    return NextResponse.json(
      { error: 'Capacity must be a positive finite number greater than 0 Liters.' },
      { status: 400 }
    );
  }

  const siloCode = body.siloCode.trim().toUpperCase();
  const siloName = body.siloName.trim();
  const capacityLiters = body.capacityLiters;

  try {
    const existing = await prisma.silo.findUnique({ where: { silo_code: siloCode } });
    if (existing) {
      return NextResponse.json({ error: `Silo with code "${siloCode}" already exists.` }, { status: 409 });
    }

    if (authUser.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
    }

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

    const newSilo = await prisma.$transaction(async (tx) => {
      const createdSilo = await tx.silo.create({
        data: {
          silo_code: siloCode,
          silo_name: siloName,
          capacity_liters: capacityLiters,
          is_active: true,
          created_by: actorUser.id,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'silo',
          record_id: createdSilo.id,
          action: 'SILO_CREATED',
          new_values: {
            silo_code: siloCode,
            silo_name: siloName,
            capacity_liters: capacityLiters,
            is_active: true,
          },
          user_id: actorUser.id,
        },
      });

      return createdSilo;
    });

    return NextResponse.json(
      {
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
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err?.code === 'P2002' || (err?.name === 'PrismaClientKnownRequestError' && err?.code === 'P2002')) {
      return NextResponse.json(
        { error: `Silo with code "${siloCode}" already exists.` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred while creating the silo.' },
      { status: 500 }
    );
  }
}
