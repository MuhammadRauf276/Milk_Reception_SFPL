import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

const gateExitSchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  exitTimestamp: z.string().optional(),
});

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  const allowedRoles = ['Security_Operator', 'Security_Manager', 'Admin', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Security Operator or Security Manager role required.' },
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

      // 4. Strict Chronology Checks against DB predecessor
      const isAllRejected = visit.portions.length > 0 && visit.portions.every((p) => p.plant_decision === 'REJECTED');
      const predTs = isAllRejected
        ? (visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp) : null)
        : (visit.weight_ticket?.tare_timestamp ? new Date(visit.weight_ticket.tare_timestamp) : visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp) : null);
      
      const predName = isAllRejected ? 'QA Rejection / Gate Entry' : 'Tare Weight';
      const chronoVal = validateOperationalTimestamp(validated.exitTimestamp || serverNow.toISOString(), predTs, 'Gate Exit', predName);
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      const opTimestamp = chronoVal.date || serverNow;

      // For normal accepted vehicles, verify Tare weighment completion & chronology
      if (!isAllRejected) {
        if (!visit.weight_ticket || visit.weight_ticket.tare_weight_kg === null) {
          throw new Error('Tare weight ticket incomplete. Processing must be finalized before gate exit.');
        }
      }

      // 5. Update GateLog with exit timestamp and exit guard ID
      const updatedGateLog = await tx.gateLog.update({
        where: { id: visit.gate_log.id },
        data: {
          exit_timestamp: opTimestamp,
          exit_guard_id: userIdBigInt,
          exit_submitted_at: new Date(),
        },
      });

      // 6. Log Immutable Audit Record for Gate Exit
      await tx.auditLog.create({
        data: {
          table_name: 'gate_log',
          record_id: updatedGateLog.id,
          action: 'GATE_EXIT_RECORDED',
          user_id: userIdBigInt,
          new_values: {
            visit_id: visitId.toString(),
            vehicle_number: visit.vehicle_number,
            token_number: visit.token_number,
            op_timestamp: opTimestamp.toISOString(),
            submitted_at: serverNow.toISOString(),
            exited_by: dbUser.username,
            exit_reason: isAllRejected ? 'QA Rejected' : 'Processing Complete',
            previous_status: 'READY_FOR_GATE_EXIT',
            new_status: 'COMPLETED',
          },
        },
      });

      return { updatedVisit: visit, updatedGateLog, isAllRejected };
    });

    return NextResponse.json({
      success: true,
      visitId: result.updatedVisit.id.toString(),
      vehicleNumber: result.updatedVisit.vehicle_number,
      isAllRejected: result.isAllRejected,
      message: `Gate exit confirmed for Vehicle ${result.updatedVisit.vehicle_number} (${result.isAllRejected ? 'QA Rejected Load' : 'Processing Complete'}). Vehicle status: COMPLETED.`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to record gate exit' }, { status: 400 });
  }
}
