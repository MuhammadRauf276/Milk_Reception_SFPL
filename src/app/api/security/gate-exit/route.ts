import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { z } from 'zod';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { parseStrictDateOnly } from '@/lib/datetime-utils';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { getErrorIssues, getErrorMessage, getErrorName } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

const SECURITY_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Security' } as const;

const gateExitSchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  exitTimestamp: z.string().optional(),
  tanker_washed: z.boolean().optional(),
  tankerWashed: z.boolean().optional(),
});

export async function POST(req: Request) {
  const access = await requireCapability('CLOSE', SECURITY_SCOPE, { request: req });
  if (!access.allowed) {
    const error = access.status === 401
      ? 'Unauthorized. Authentication required.'
      : 'Unauthorized. Admin Operator or Admin Head role required.';
    return NextResponse.json({ error }, { status: access.status });
  }
  const authUser = access.user;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    return NextResponse.json(
      { error: 'Unauthorized. Admin Operator or Admin Head role required.' },
      { status: 403 }
    );
  }

  const userIdBigInt = dbUser.id;

  try {
    const body = await req.json();
    const validated = gateExitSchema.parse(body);
    const visitId = BigInt(validated.visitId);
    const serverNow = new Date();
    const opTimestamp = validated.exitTimestamp ? new Date(validated.exitTimestamp) : serverNow;

    if (isNaN(opTimestamp.getTime())) {
      return NextResponse.json({ error: 'Invalid gate exit operational timestamp format.' }, { status: 400 });
    }

    if (opTimestamp.getTime() > serverNow.getTime()) {
      return NextResponse.json({ error: 'Gate exit operational timestamp cannot be in the future.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Atomic conditional status claim: verify vehicle is strictly in READY_FOR_GATE_EXIT status
      const claimResult = await tx.vehicleVisit.updateMany({
        where: {
          id: visitId,
          current_status: 'READY_FOR_GATE_EXIT',
        },
        data: { current_status: 'COMPLETED' },
      });

      if (claimResult.count === 0) {
        throw new Error(`Vehicle (ID ${validated.visitId}) is not ready for gate exit or has already completed exit.`);
      }

      // 2. Fetch VehicleVisit with gate log, portions & weight ticket
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          gate_log: true,
          portions: true,
          weight_ticket: true,
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      // 3. Verify physical gate entry exists and exit is unrecorded
      if (!visit.gate_log || !visit.gate_log.entry_timestamp) {
        throw new Error('Gate entry record missing for this vehicle.');
      }

      if (visit.gate_log.exit_timestamp) {
        throw new Error('Gate exit record already recorded for this vehicle.');
      }

      // Check if vehicle was entirely rejected (no milk accepted/unloaded)
      const isAllRejected = visit.portions.length > 0 && visit.portions.every((p) => p.plant_decision === 'REJECTED');

      // 3b. Mandatory Tanker Wash Check (Phase 4d Stage 4) - only for vehicles unloading milk
      if (!isAllRejected) {
        const washedInput = validated.tanker_washed !== undefined ? validated.tanker_washed : validated.tankerWashed;
        const isWashed = washedInput !== undefined ? washedInput : visit.gate_log?.tanker_washed;

        if (!isWashed) {
          throw new Error('Vehicle tanker wash verification required by Admin Operator prior to gate exit.');
        }
      }

      // 4. Strict Chronology Checks against DB predecessor
      const predTs = isAllRejected
        ? (visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp) : null)
        : (visit.weight_ticket?.tare_timestamp ? new Date(visit.weight_ticket.tare_timestamp) : visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp) : null);
      
      const predName = isAllRejected ? 'QA Rejection / Gate Entry' : 'Tare Weight';
      const chronoVal = validateOperationalTimestamp(validated.exitTimestamp || serverNow.toISOString(), predTs, 'Gate Exit', predName);
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      const verifiedOpTimestamp = chronoVal.date || serverNow;

      // For normal accepted vehicles, verify Tare weighment completion & chronology
      if (!isAllRejected) {
        if (!visit.weight_ticket || visit.weight_ticket.tare_weight_kg === null) {
          throw new Error('Tare weight ticket incomplete. Processing must be finalized before gate exit.');
        }
      }

      // 5. Update GateLog with exit timestamp, exit guard ID, and tanker wash check
      const updatedGateLog = await tx.gateLog.update({
        where: { id: visit.gate_log.id },
        data: {
          exit_timestamp: verifiedOpTimestamp,
          exit_guard_id: userIdBigInt,
          exit_submitted_at: new Date(),
          tanker_washed: isAllRejected ? false : true,
          wash_checked_by: isAllRejected ? null : userIdBigInt,
          wash_checked_at: isAllRejected ? null : new Date(),
          washed_checked_by: isAllRejected ? null : userIdBigInt,
          washed_checked_at: isAllRejected ? null : new Date(),
        },
      });

      // 5b. Authoritative Business Date: LOCKED once at 1st weight (08:00 AM PKT cutoff rule).
      // NEVER overwrite at gate exit. Fully rejected vehicle date was set at final QA rejection.
      if (!visit.operational_date) {
        const exitBusinessDateStr = getOperationalBusinessDate(verifiedOpTimestamp);
        const exitBusinessDate = parseStrictDateOnly(exitBusinessDateStr);
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: {
            operational_date: exitBusinessDate,
          },
        });
      }

      // 6. Log Immutable Audit Record for Gate Exit
      await writeAuditLog(tx, {
        tableName: 'gate_log',
        recordId: updatedGateLog.id,
        action: 'GATE_EXIT_RECORDED',
        newValues: {
          visit_id: visitId.toString(),
          vehicle_number: visit.vehicle_number,
          token_number: visit.token_number,
          op_timestamp: verifiedOpTimestamp.toISOString(),
          tanker_washed: isAllRejected ? false : true,
        },
        actor: auditActorFromUser(dbUser),
      });

      return {
        success: true,
        visit_id: visitId.toString(),
        exit_timestamp: verifiedOpTimestamp.toISOString(),
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    const errorDetails = {
      issues: getErrorIssues(error),
      message: getErrorMessage(error),
      name: getErrorName(error),
    };
    return NextResponse.json(
      { error: errorDetails.message || 'Failed to record gate exit' },
      { status: 400 }
    );
  }
}
