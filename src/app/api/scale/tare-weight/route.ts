import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { finalizeSiloReceiptForVisit } from '@/backend/services/siloInventoryService';
import { validatePositiveDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const allowedRoles = ['WEIGHBRIDGE_OPERATOR', 'Weighbridge_Operator', 'Production_Operator', 'Admin', 'Correction_Officer'];
  if (!allowedRoles.includes(authUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. Weighbridge Operator role required.' }, { status: 403 });
  }

  let dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    dbUser = await prisma.user.upsert({
      where: { username: authUser.username },
      update: { role: authUser.role, full_name: authUser.name },
      create: { username: authUser.username, role: authUser.role, full_name: authUser.name },
    });
  }

  const userIdBigInt = dbUser.id;

  try {
    const body = await req.json();
    const visitIdStr = body.visitId || body.id;
    if (!visitIdStr) {
      return NextResponse.json({ error: 'Visit ID is required.' }, { status: 400 });
    }

    const tareVal = validatePositiveDecimal(body.tareWeightKg, 'Tare Weight');
    if (!tareVal.isValid) {
      return NextResponse.json({ error: tareVal.error }, { status: 400 });
    }
    const tareWeightKg = tareVal.value!;

    const visitId = BigInt(visitIdStr);
    const serverNow = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Atomic status claim lock: verify vehicle is strictly in READY_FOR_TARE status
      const claimResult = await tx.vehicleVisit.updateMany({
        where: {
          id: visitId,
          current_status: 'READY_FOR_TARE',
        },
        data: { current_status: 'TARE_WEIGHED' },
      });

      if (claimResult.count === 0) {
        throw new Error(`Vehicle (ID ${visitIdStr}) is not ready for Tare weight or is being processed concurrently.`);
      }

      // 2. Load VehicleVisit with portions & weight ticket
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          portions: {
            include: {
              dispatch_info: true,
              unloading_log: true,
            },
          },
          weight_ticket: true,
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      if (!visit.weight_ticket || !visit.weight_ticket.gross_weight_kg) {
        throw new Error('First weight (Gross) has not been recorded for this vehicle yet.');
      }

      const grossWeightKg = Number(visit.weight_ticket.gross_weight_kg);

      // 3. Validate Tare vs Gross weight
      if (tareWeightKg >= grossWeightKg) {
        throw new Error(`Tare weight (${tareWeightKg} kg) cannot be greater than or equal to Gross weight (${grossWeightKg} kg).`);
      }

      if (visit.weight_ticket.tare_weight_kg !== null) {
        throw new Error(`Tare weight (${visit.weight_ticket.tare_weight_kg} kg) has already been recorded for this vehicle.`);
      }

      // Fetch DB predecessor timestamp (Unloading Completion / Gross Weight)
      const firstUnloadingLog = visit.portions.find((p) => p.unloading_log?.pump_end_timestamp)?.unloading_log;
      const predecessorTs = firstUnloadingLog?.pump_end_timestamp
        ? new Date(firstUnloadingLog.pump_end_timestamp)
        : visit.weight_ticket.gross_timestamp
        ? new Date(visit.weight_ticket.gross_timestamp)
        : null;

      const chronoVal = validateOperationalTimestamp(body.tareTimestamp || serverNow.toISOString(), predecessorTs, 'Tare Weight', 'Unloading Completion');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }
      const opTimestamp = chronoVal.date || serverNow;

      // 4. Calculate Net Weight server-side
      const netWeightKg = grossWeightKg - tareWeightKg;

      // 5. Update WeightTicket
      const updatedTicket = await tx.weightTicket.update({
        where: { id: visit.weight_ticket.id },
        data: {
          tare_weight_kg: new Prisma.Decimal(tareWeightKg),
          tare_timestamp: opTimestamp,
          tare_recorded_by: userIdBigInt,
          tare_submitted_at: new Date(),
          net_weight_kg: new Prisma.Decimal(netWeightKg),
        },
      });

      // 6. Log Immutable Audit Record for Tare Weighing
      await tx.auditLog.create({
        data: {
          table_name: 'weight_ticket',
          record_id: updatedTicket.id,
          action: 'TARE_WEIGHT_RECORDED',
          user_id: userIdBigInt,
          new_values: {
            visit_id: visitId.toString(),
            vehicle_number: visit.vehicle_number,
            token_number: visit.token_number,
            ticket_number: visit.weight_ticket.ticket_number,
            gross_weight_kg: grossWeightKg,
            tare_weight_kg: tareWeightKg,
            net_weight_kg: netWeightKg,
            gross_timestamp: visit.weight_ticket.gross_timestamp ? new Date(visit.weight_ticket.gross_timestamp).toISOString() : null,
            tare_timestamp: opTimestamp.toISOString(),
            submitted_at: serverNow.toISOString(),
            recorded_by: authUser.username,
          },
        },
      });

      // 7. Invoke Reusable Finalization Service (Requires Authoritative Plant LR)
      const finalizeRes = await finalizeSiloReceiptForVisit(visitId, userIdBigInt, opTimestamp, tx);

      if (!finalizeRes.success) {
        // Log Pending Audit Event (Vehicle remains in TARE_WEIGHED status)
        await tx.auditLog.create({
          data: {
            table_name: 'vehicle_visit',
            record_id: visitId,
            action: 'SILO_RECEIPT_PENDING_PREREQUISITES',
            user_id: userIdBigInt,
            new_values: {
              visit_id: visitId.toString(),
              vehicle_number: visit.vehicle_number,
              net_weight_kg: netWeightKg,
              op_timestamp: opTimestamp.toISOString(),
              reason: finalizeRes.reason || 'Prerequisites incomplete',
              message: finalizeRes.message,
            },
          },
        });
      }

      return {
        visit,
        ticket: updatedTicket,
        netWeightKg,
        finalizeRes,
      };
    });

    const isFinalized = result.finalizeRes.success && result.finalizeRes.receiptCreated;
    const finalPhysicalLiters = result.finalizeRes.finalPhysicalLiters !== undefined ? Math.round(result.finalizeRes.finalPhysicalLiters) : null;
    const finalAt13TSLiters = result.finalizeRes.finalAt13TSLiters !== undefined ? Math.round(result.finalizeRes.finalAt13TSLiters) : null;

    let msg = `Second Weight (Tare: ${tareWeightKg} kg) recorded successfully. Net Milk Weight: ${result.netWeightKg.toLocaleString()} kg.`;
    if (isFinalized) {
      msg += ` Final Silo Receipt created (~${finalPhysicalLiters?.toLocaleString()} L in ${result.finalizeRes.targetSiloCode}). Vehicle is ready for gate exit.`;
    } else {
      msg += ` Final silo inventory receipt is PENDING (${result.finalizeRes.message}). Vehicle remains in TARE_WEIGHED status.`;
    }

    return NextResponse.json({
      success: true,
      ticketNumber: result.ticket.ticket_number,
      tareWeightKg: Number(result.ticket.tare_weight_kg),
      netWeightKg: result.netWeightKg,
      receiptCreated: isFinalized,
      isPendingFinalReceipt: !isFinalized,
      finalPhysicalLiters,
      finalAt13TSLiters,
      targetSiloCode: result.finalizeRes.targetSiloCode || null,
      reason: result.finalizeRes.reason || null,
      message: msg,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to record tare weight' }, { status: 400 });
  }
}
