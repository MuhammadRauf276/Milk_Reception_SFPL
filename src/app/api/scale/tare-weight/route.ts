import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { finalizeSiloReceiptForVisit } from '@/backend/services/siloInventoryService';
import { validatePositiveDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import {
  findOperationRecord,
  recordOperation,
  checkOperationReplay,
  handleConcurrentReplayOrConflict,
} from '@/backend/services/operationIdempotencyService';

const WEIGHBRIDGE_SCOPE = {
  kind: 'DEPARTMENT',
  departmentId: 'Production & Weighbridge',
} as const;

export async function POST(req: Request) {
  const access = await requireCapability('SUBMIT', WEIGHBRIDGE_SCOPE, { request: req });
  if (!access.allowed) {
    const error = access.status === 401
      ? 'Unauthorized. Authentication required.'
      : 'Unauthorized. Weighbridge Operator role required.';
    return NextResponse.json({ error }, { status: access.status });
  }
  const authUser = access.user;

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

  let body: Record<string, unknown> = {};
  let visitIdStr = '';
  let idempotencyKey = '';
  let canonicalPayload: any = null;

  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
    visitIdStr = ((body.visitId || body.id) as string) || '';
    if (!visitIdStr) {
      return NextResponse.json({ error: 'Visit ID is required.' }, { status: 400 });
    }

    const tareVal = validatePositiveDecimal(body.tareWeightKg as string | number, 'Tare Weight');
    if (!tareVal.isValid) {
      return NextResponse.json({ error: tareVal.error }, { status: 400 });
    }
    const tareWeightKg = tareVal.value!;

    const visitId = BigInt(visitIdStr);
    const serverNow = new Date();

    idempotencyKey = (
      req.headers.get('idempotency-key') ||
      (body as { idempotencyKey?: string }).idempotencyKey ||
      (body as { clientOperationId?: string }).clientOperationId ||
      ''
    ).trim();

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency key (or clientOperationId) is required for tare weight submission.' },
        { status: 400 }
      );
    }

    canonicalPayload = {
      visitId: visitIdStr,
      portionId: body.portionId ? String(body.portionId) : null,
      tareWeightKg,
      tareTimestamp: body.tareTimestamp ? new Date(body.tareTimestamp as string).toISOString() : null,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : null,
    };

    // 1. Check idempotency store for existing completed operation
    const replay = await checkOperationReplay(idempotencyKey, {
      operationType: 'SCALE_TARE_WEIGHT',
      entityType: 'vehicle_visit',
      entityId: visitId,
      incomingPayload: canonicalPayload,
    });
    if (replay) return replay;

    // 2. Check if visit already has completed tare weight
    const existingVisit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: { weight_ticket: true },
    });

    if (existingVisit && existingVisit.weight_ticket && existingVisit.weight_ticket.tare_weight_kg) {
      return NextResponse.json(
        { error: `Conflict: Tare weight already recorded as ${existingVisit.weight_ticket.tare_weight_kg} kg under Ticket #${existingVisit.weight_ticket.ticket_number}.` },
        { status: 409 }
      );
    }

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
              plant_lab_results: { include: { lab_test: true } },
            },
            orderBy: { portion_number: 'asc' },
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

      // Strict Decision Gate: confirm ALL portions are definitively decided (no pending or unresolved conflicts)
      const unresolvedPortions = (visit.portions || []).filter((p) => {
        const dec = (p.plant_decision || '').toUpperCase();
        return (dec !== 'ACCEPTED' && dec !== 'REJECTED') || p.manager_review_status === 'PENDING';
      });
      if (unresolvedPortions.length > 0) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
        throw new Error(`Tare weighing blocked: Portion #${unresolvedPortions[0].portion_number} is still pending QA decision or exception review.`);
      }

      const acceptedPortions = visit.portions
        .filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED')
        .sort((a, b) => a.portion_number - b.portion_number);

      if (acceptedPortions.length === 0) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
        throw new Error('Vehicle visit has no accepted portions.');
      }

      // N+1 Iterative Weighing Rule:
      // If a vehicle has N accepted portions, it MUST undergo N+1 weighings (1 initial gross + N portion tares)
      // so that each individual compartment has an exact audited net weight (W(i-1) - W(i)).
      // This applies REGARDLESS of whether QA used COMPOSITE or PORTION_WISE testing in the lab.
      const isMultiPortion = acceptedPortions.length > 1;
      const isPortionWise = isMultiPortion || visit.test_mode === 'PORTION_WISE' || acceptedPortions.length === 1;

      // =========================================================================
      // BRANCH A: AUDITED PORTION WEIGHING MODE (Iterative N+1 loop)
      // =========================================================================
      if (isPortionWise) {
        const activePortion = acceptedPortions.find(
          (p) => p.first_weight_kg !== null && p.second_weight_kg === null
        );

        if (!activePortion) {
          await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
          throw new Error('No active portion found waiting for second weight in portion-wise mode.');
        }

        const portionFirstWeightKg = Number(activePortion.first_weight_kg);

        if (tareWeightKg >= portionFirstWeightKg) {
          await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
          throw new Error(
            `Second weight (${tareWeightKg} kg) must be strictly less than First weight for Portion #${activePortion.portion_number} (${portionFirstWeightKg} kg).`
          );
        }

        const portionNetKg = portionFirstWeightKg - tareWeightKg;

        // Chronological validation against active portion unloading completion or gross weight
        const predTs = activePortion.unloading_log?.pump_end_timestamp
          ? new Date(activePortion.unloading_log.pump_end_timestamp)
          : activePortion.first_weight_at
          ? new Date(activePortion.first_weight_at)
          : visit.weight_ticket.gross_timestamp
          ? new Date(visit.weight_ticket.gross_timestamp)
          : null;

        const chronoVal = validateOperationalTimestamp(
          (body.tareTimestamp as string) || serverNow.toISOString(),
          predTs,
          'Second Weight',
          'Unloading Completion'
        );
        if (!chronoVal.isValid) {
          await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
          throw new Error(chronoVal.error);
        }
        const opTimestamp = chronoVal.date || serverNow;

        // 1. Update active portion with second weight and net weight
        await tx.visitPortion.update({
          where: { id: activePortion.id },
          data: {
            second_weight_kg: new Prisma.Decimal(tareWeightKg),
            second_weight_at: opTimestamp,
            second_weight_by_user_id: userIdBigInt,
            net_weight_kg: new Prisma.Decimal(portionNetKg),
            current_status: 'WEIGHED',
          },
        });

        // 2. Check if remaining accepted portions exist
        const nextPortion = acceptedPortions.find((p) => p.portion_number > activePortion.portion_number);

        if (nextPortion) {
          // --- Intermediate cycle: more accepted portions to unload ---
          // Initialize next portion's starting weight with this tare weight
          await tx.visitPortion.update({
            where: { id: nextPortion.id },
            data: {
              first_weight_kg: new Prisma.Decimal(tareWeightKg),
              first_weight_at: opTimestamp,
              first_weight_by_user_id: userIdBigInt,
            },
          });

          // Transition vehicle visit back to READY_FOR_UNLOADING
          await tx.vehicleVisit.update({
            where: { id: visitId },
            data: { current_status: 'READY_FOR_UNLOADING' },
          });

          // Immutable Audit Record for portion second weight
          await writeAuditLog(tx, {
            tableName: 'visit_portion',
            recordId: activePortion.id,
            action: 'PORTION_SECOND_WEIGHT_RECORDED',
            newValues: {
              visit_id: visitId.toString(),
              vehicle_number: visit.vehicle_number,
              portion_id: activePortion.id.toString(),
              portion_number: activePortion.portion_number,
              first_weight_kg: portionFirstWeightKg,
              second_weight_kg: tareWeightKg,
              net_weight_kg: portionNetKg,
              next_portion_number: nextPortion.portion_number,
              next_portion_first_weight_kg: tareWeightKg,
              op_timestamp: opTimestamp.toISOString(),
              recorded_by: authUser.username,
            },
            actor: auditActorFromUser(dbUser),
          });

          const responsePayload = {
            success: true,
            isPortionCycle: true,
            completedPortionNumber: activePortion.portion_number,
            nextPortionNumber: nextPortion.portion_number,
            tareWeightKg,
            portionNetKg,
            message: `Second Weight (${tareWeightKg.toLocaleString()} kg) for Portion #${activePortion.portion_number} recorded (Net: ${portionNetKg.toLocaleString()} kg). Vehicle is now ready for Unloading Portion #${nextPortion.portion_number}.`,
          };

          await recordOperation({
            key: idempotencyKey,
            operationType: 'SCALE_TARE_WEIGHT',
            entityType: 'vehicle_visit',
            entityId: visitId,
            requestPayload: canonicalPayload,
            responsePayload,
            statusCode: 200,
          }, tx);

          return responsePayload;
        } else {
          // --- Final cycle: all accepted portions completed ---
          // The final vehicle tare is tareWeightKg; total net weight is initial vehicle gross minus final tare
          const initialVehicleGross = Number(visit.weight_ticket.gross_weight_kg);
          const totalVehicleNetKg = initialVehicleGross - tareWeightKg;

          const updatedTicket = await tx.weightTicket.update({
            where: { id: visit.weight_ticket.id },
            data: {
              tare_weight_kg: new Prisma.Decimal(tareWeightKg),
              tare_timestamp: opTimestamp,
              tare_recorded_by: userIdBigInt,
              tare_recorded_as_role: authUser.role,
              tare_submitted_at: new Date(),
              net_weight_kg: new Prisma.Decimal(totalVehicleNetKg),
            },
          });

          // Verify destination silos are active
          const targetSiloIds = Array.from(
            new Set(
              acceptedPortions
                .map((p) => p.unloading_log?.silo_id)
                .filter((id): id is bigint => id !== null && id !== undefined)
            )
          );

          for (const sId of targetSiloIds) {
            await tx.$executeRaw`SELECT id FROM silo WHERE id = ${sId} FOR UPDATE`;
            const destSilo = await tx.silo.findUnique({
              where: { id: sId },
              select: { id: true, silo_code: true, silo_name: true, is_active: true },
            });
            if (!destSilo || !destSilo.is_active) {
              throw new Error(`Target Silo "${destSilo?.silo_name || sId}" is INACTIVE. Final receipt is blocked.`);
            }
          }

          // Immutable Audit Record for Final Tare Weighing
          await writeAuditLog(tx, {
            tableName: 'weight_ticket',
            recordId: updatedTicket.id,
            action: 'TARE_WEIGHT_RECORDED',
            newValues: {
              visit_id: visitId.toString(),
              vehicle_number: visit.vehicle_number,
              ticket_number: visit.weight_ticket.ticket_number,
              gross_weight_kg: initialVehicleGross,
              tare_weight_kg: tareWeightKg,
              net_weight_kg: totalVehicleNetKg,
              op_timestamp: opTimestamp.toISOString(),
              recorded_by: authUser.username,
              is_portion_wise: true,
            },
            actor: auditActorFromUser(dbUser),
          });

          // Finalize silo receipt(s)
          const finalizeRes = await finalizeSiloReceiptForVisit(visitId, userIdBigInt, opTimestamp, tx, authUser.role);

          const isFinalized = finalizeRes.success && finalizeRes.receiptCreated;
          const finalPhysicalLiters = finalizeRes.finalPhysicalLiters != null ? Math.round(finalizeRes.finalPhysicalLiters) : null;
          const finalAt13TSLiters = finalizeRes.finalAt13TSLiters != null ? Math.round(finalizeRes.finalAt13TSLiters) : null;

          let msg = `Second Weight (Tare: ${tareWeightKg.toLocaleString()} kg) recorded successfully. Total Net Milk Weight: ${totalVehicleNetKg.toLocaleString()} kg.`;
          if (isFinalized) {
            msg += ` Final Silo Receipt created (~${finalPhysicalLiters?.toLocaleString()} L in ${finalizeRes.targetSiloCode}). Vehicle is ready for gate exit.`;
          } else {
            msg += ` Final silo inventory receipt is PENDING (${finalizeRes.message}). Vehicle remains in TARE_WEIGHED status.`;
          }

          const responsePayload = {
            success: true,
            ticketNumber: updatedTicket.ticket_number,
            tareWeightKg: Number(updatedTicket.tare_weight_kg),
            netWeightKg: totalVehicleNetKg,
            receiptCreated: isFinalized,
            isPendingFinalReceipt: !isFinalized,
            finalPhysicalLiters,
            finalAt13TSLiters,
            targetSiloCode: finalizeRes.targetSiloCode || null,
            reason: finalizeRes.reason || null,
            message: msg,
          };

          await recordOperation({
            key: idempotencyKey,
            operationType: 'SCALE_TARE_WEIGHT',
            entityType: 'vehicle_visit',
            entityId: visitId,
            requestPayload: canonicalPayload,
            responsePayload,
            statusCode: 200,
          }, tx);

          return responsePayload;
        }
      }

      // =========================================================================
      // BRANCH B: COMPOSITE TESTING MODE (Single tare weighment)
      // =========================================================================
      const grossWeightKg = Number(visit.weight_ticket.gross_weight_kg);

      if (tareWeightKg >= grossWeightKg) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
        throw new Error(`Tare weight (${tareWeightKg} kg) cannot be greater than or equal to Gross weight (${grossWeightKg} kg).`);
      }

      if (visit.weight_ticket.tare_weight_kg !== null) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
        throw new Error(`Tare weight (${visit.weight_ticket.tare_weight_kg} kg) has already been recorded for this vehicle.`);
      }

      const firstUnloadingLog = visit.portions.find((p) => p.unloading_log?.pump_end_timestamp)?.unloading_log;
      const predecessorTs = firstUnloadingLog?.pump_end_timestamp
        ? new Date(firstUnloadingLog.pump_end_timestamp)
        : visit.weight_ticket.gross_timestamp
        ? new Date(visit.weight_ticket.gross_timestamp)
        : null;

      const chronoVal = validateOperationalTimestamp(
        (body.tareTimestamp as string) || serverNow.toISOString(),
        predecessorTs,
        'Tare Weight',
        'Unloading Completion'
      );
      if (!chronoVal.isValid) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'READY_FOR_TARE' } });
        throw new Error(chronoVal.error);
      }
      const opTimestamp = chronoVal.date || serverNow;

      const netWeightKg = grossWeightKg - tareWeightKg;

      // Verify destination silos are active
      const targetSiloIds = Array.from(
        new Set(
          acceptedPortions
            .map((p) => p.unloading_log?.silo_id)
            .filter((id): id is bigint => id !== null && id !== undefined)
        )
      );

      for (const sId of targetSiloIds) {
        await tx.$executeRaw`SELECT id FROM silo WHERE id = ${sId} FOR UPDATE`;
        const destSilo = await tx.silo.findUnique({
          where: { id: sId },
          select: { id: true, silo_code: true, silo_name: true, is_active: true },
        });
        if (!destSilo || !destSilo.is_active) {
          throw new Error(`Target Silo "${destSilo?.silo_name || sId}" is INACTIVE. Final receipt is blocked.`);
        }
      }

      // Update WeightTicket
      const updatedTicket = await tx.weightTicket.update({
        where: { id: visit.weight_ticket.id },
        data: {
          tare_weight_kg: new Prisma.Decimal(tareWeightKg),
          tare_timestamp: opTimestamp,
          tare_recorded_by: userIdBigInt,
          tare_recorded_as_role: authUser.role,
          tare_submitted_at: new Date(),
          net_weight_kg: new Prisma.Decimal(netWeightKg),
        },
      });

      // Update accepted portions with second weight
      for (const p of acceptedPortions) {
        await tx.visitPortion.update({
          where: { id: p.id },
          data: {
            second_weight_kg: new Prisma.Decimal(tareWeightKg),
            second_weight_at: opTimestamp,
            second_weight_by_user_id: userIdBigInt,
            ...(acceptedPortions.length === 1 ? { net_weight_kg: new Prisma.Decimal(netWeightKg) } : {}),
            current_status: 'WEIGHED',
          },
        });
      }

      // Immutable Audit Record
      await writeAuditLog(tx, {
        tableName: 'weight_ticket',
        recordId: updatedTicket.id,
        action: 'TARE_WEIGHT_RECORDED',
        newValues: {
          visit_id: visitId.toString(),
          vehicle_number: visit.vehicle_number,
          ticket_number: visit.weight_ticket.ticket_number,
          gross_weight_kg: grossWeightKg,
          tare_weight_kg: tareWeightKg,
          net_weight_kg: netWeightKg,
          tare_timestamp: opTimestamp.toISOString(),
          recorded_by: authUser.username,
        },
        actor: auditActorFromUser(dbUser),
      });

      // Finalize silo receipt
      const finalizeRes = await finalizeSiloReceiptForVisit(visitId, userIdBigInt, opTimestamp, tx, authUser.role);

      const isFinalized = finalizeRes.success && finalizeRes.receiptCreated;
      const finalPhysicalLiters = finalizeRes.finalPhysicalLiters != null ? Math.round(finalizeRes.finalPhysicalLiters) : null;
      const finalAt13TSLiters = finalizeRes.finalAt13TSLiters != null ? Math.round(finalizeRes.finalAt13TSLiters) : null;

      let msg = `Second Weight (Tare: ${tareWeightKg.toLocaleString()} kg) recorded successfully. Total Net Milk Weight: ${netWeightKg.toLocaleString()} kg.`;
      if (isFinalized) {
        msg += ` Final Silo Receipt created (~${finalPhysicalLiters?.toLocaleString()} L in ${finalizeRes.targetSiloCode}). Vehicle is ready for gate exit.`;
      } else {
        msg += ` Final silo inventory receipt is PENDING (${finalizeRes.message}). Vehicle remains in TARE_WEIGHED status.`;
      }

      const responsePayload = {
        success: true,
        ticketNumber: updatedTicket.ticket_number,
        tareWeightKg: Number(updatedTicket.tare_weight_kg),
        netWeightKg,
        receiptCreated: isFinalized,
        isPendingFinalReceipt: !isFinalized,
        finalPhysicalLiters,
        finalAt13TSLiters,
        targetSiloCode: finalizeRes.targetSiloCode || null,
        reason: finalizeRes.reason || null,
        message: msg,
      };

      await recordOperation({
        key: idempotencyKey,
        operationType: 'SCALE_TARE_WEIGHT',
        entityType: 'vehicle_visit',
        entityId: visitId,
        requestPayload: canonicalPayload,
        responsePayload,
        statusCode: 200,
      }, tx);

      return responsePayload;
    });

    return NextResponse.json(result);
  } catch (error) {
    if (idempotencyKey) {
      const concurrentReplay = await handleConcurrentReplayOrConflict(idempotencyKey, {
        operationType: 'SCALE_TARE_WEIGHT',
        entityType: 'vehicle_visit',
        entityId: BigInt(visitIdStr || '0'),
        incomingPayload: canonicalPayload,
      });
      if (concurrentReplay) return concurrentReplay;
    }

    const errorMsg = getErrorMessage(error) || 'Failed to record tare weight';
    const status = errorMsg.includes('INACTIVE') ? 409 : 400;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
