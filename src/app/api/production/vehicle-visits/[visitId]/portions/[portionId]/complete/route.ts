import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  try {
    const authUser = await getCurrentUser();
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'PRODUCTION_OPERATOR', 'PRODUCTION_MANAGER', 'PRODUCTION'];
    if (!allowedRoles.includes(authUser.role.toUpperCase())) {
      return NextResponse.json({ error: 'Forbidden: Production operator role required' }, { status: 403 });
    }

    const { visitId: visitIdStr } = await params;
    const visitId = BigInt(visitIdStr);

    const body = await req.json().catch(() => ({}));
    const { opTimestamp: opTimestampStr } = body;

    // Resolve authenticated user to DB User row
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: authUser.username }, { username: String(authUser.id) }],
        is_active: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'Authenticated user row not found in database' }, { status: 401 });
    }

    const userIdBigInt = dbUser.id;
    const serverNow = new Date();

    // Operational timestamp validation
    let opTimestamp = serverNow;
    if (opTimestampStr) {
      opTimestamp = new Date(opTimestampStr);
      if (isNaN(opTimestamp.getTime())) {
        return NextResponse.json({ error: 'Invalid operational timestamp format' }, { status: 400 });
      }
      if (opTimestamp.getTime() > serverNow.getTime()) {
        return NextResponse.json({ error: 'Completion timestamp cannot be in the future' }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Load vehicle visit
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          portions: {
            include: { unloading_log: true },
          },
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit not found');
      }

      // 2. Validate current status is UNLOADING
      if (visit.current_status !== 'UNLOADING') {
        throw new Error(`Vehicle is not in UNLOADING status (Current Status: ${visit.current_status}).`);
      }

      const acceptedPortions = visit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      if (acceptedPortions.length === 0) {
        throw new Error('Vehicle has no accepted portions to complete');
      }

      // 3. Operational time bound check vs Pump Start timestamp
      for (const p of acceptedPortions) {
        if (!p.unloading_log || !p.unloading_log.pump_start_timestamp) {
          throw new Error(`Unloading has not been started for Portion #${p.portion_number}`);
        }
        const predTs = new Date(p.unloading_log.pump_start_timestamp);
        const chronoVal = validateOperationalTimestamp(opTimestampStr || serverNow.toISOString(), predTs, 'Unloading Complete', 'Unloading Start');
        if (!chronoVal.isValid) {
          throw new Error(chronoVal.error);
        }
      }

      // 4. Update UnloadingLog for all accepted portions
      for (const p of acceptedPortions) {
        await tx.unloadingLog.update({
          where: { portion_id: p.id },
          data: {
            pump_end_timestamp: opTimestamp,
            completed_by: userIdBigInt,
            complete_submitted_at: new Date(),
          },
        });

        await tx.visitPortion.update({
          where: { id: p.id },
          data: { current_status: 'UNLOADED' },
        });
      }

      // 5. Update VehicleVisit status to READY_FOR_TARE
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'READY_FOR_TARE' },
      });

      // 6. Immutable AuditLog creation
      await tx.auditLog.create({
        data: {
          table_name: 'vehicle_visit',
          record_id: visitId,
          action: 'UNLOADING_COMPLETED',
          new_values: {
            visit_id: visitId.toString(),
            vehicle_number: visit.vehicle_number,
            token_number: visit.token_number,
            op_timestamp: opTimestamp.toISOString(),
            submitted_at: serverNow.toISOString(),
            user_id: userIdBigInt.toString(),
            user_name: dbUser.full_name || dbUser.username,
            new_status: 'READY_FOR_TARE',
          },
          user_id: userIdBigInt,
          created_at: serverNow,
        },
      });

      return { visitId, newStatus: 'READY_FOR_TARE' };
    });

    return NextResponse.json({
      message: 'Unloading completed successfully. Vehicle routed to READY_FOR_TARE.',
      visitId: visitIdStr,
      visitStatus: result.newStatus,
      opTimestamp: opTimestamp.toISOString(),
    });
  } catch (err: any) {
    console.error('Error completing unloading:', err);
    return NextResponse.json({ error: err.message || 'Failed to complete unloading' }, { status: 400 });
  }
}
