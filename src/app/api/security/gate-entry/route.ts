import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { gateEntrySchema } from '@/lib/validations/security';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { paperLinkedIdentity } from '@/backend/modules/paper-references';
import { getErrorIssues, getErrorMessage, getErrorName } from '@/lib/errors';
import {
  findOperationRecord,
  recordOperation,
  checkOperationReplay,
  handleConcurrentReplayOrConflict,
} from '@/backend/services/operationIdempotencyService';
import { Prisma } from '@prisma/client';
import { checkEnteredTime } from '@/backend/services/outageWindowService';

const SECURITY_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Security' } as const;

export async function POST(req: Request) {
  const access = await requireCapability('SUBMIT', SECURITY_SCOPE, { request: req });
  if (!access.allowed) {
    const error = access.status === 401
      ? 'Unauthorized. Authentication required.'
      : 'Unauthorized. Security Operator or Admin Head role required.';
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
      { error: 'Unauthorized. Security Operator or Admin Head role required.' },
      { status: 403 }
    );
  }

  const userIdBigInt = dbUser.id;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }

  let idempotencyKey = '';
  let canonicalPayload: any = null;

  try {
    const validated = gateEntrySchema.parse(body);

    const visitId = BigInt(validated.visitId);
    const now = validated.entryTimestamp ? new Date(validated.entryTimestamp) : new Date();

    idempotencyKey = (
      req.headers.get('idempotency-key') ||
      (body as { idempotencyKey?: string }).idempotencyKey ||
      (body as { clientOperationId?: string }).clientOperationId ||
      ''
    ).trim();

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency key is required for gate entry submission.' },
        { status: 400 }
      );
    }

    canonicalPayload = {
      visitId: validated.visitId,
      tokenNumber: validated.tokenNumber,
      entryTimestamp: validated.entryTimestamp ? new Date(validated.entryTimestamp).toISOString() : null,
    };

    // 1. Check idempotency store for existing completed operation
    const replay = await checkOperationReplay(idempotencyKey, {
      operationType: 'GATE_ENTRY',
      entityType: 'vehicle_visit',
      entityId: visitId,
      incomingPayload: canonicalPayload,
    });
    if (replay) return replay;

    // 2. Check if visit already has completed gate entry
    const existingVisit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: { gate_log: true },
    });

    if (existingVisit && existingVisit.gate_log && existingVisit.gate_log.entry_timestamp) {
      return NextResponse.json(
        { error: `Conflict: Gate entry already recorded with token "${existingVisit.token_number}".` },
        { status: 409 }
      );
    }

    // Perform atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Confirm VehicleVisit exists
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          gate_log: true,
          portions: {
            include: { dispatch_info: true },
          },
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      // Validate exact chronology against DB predecessor dispatch_timestamp
      const firstDispatchTs = visit.portions.find((p) => p.dispatch_info)?.dispatch_info?.dispatch_timestamp;
      const predTs = firstDispatchTs ? new Date(firstDispatchTs) : null;
      const chronoVal = validateOperationalTimestamp(validated.entryTimestamp || new Date().toISOString(), predTs, 'Gate Entry', 'Dispatch');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }
      // Older than 3 days needs an outage window for this station (and is then listed as entered late).
      const lateCheck = await checkEnteredTime(chronoVal.date ?? new Date(), { plant: 'GATE' }, { db: tx });
      if ('error' in lateCheck) throw new Error(lateCheck.error);
      await lateCheck.record({ step: 'Gate entry', recordTable: 'vehicle_visit', recordId: visitId, actor: dbUser }, tx);

      // 2. Confirm transition to TOKEN_ISSUED is valid
      if (visit.current_status !== 'DISPATCHED' && visit.current_status !== 'Dispatched') {
        throw new Error(`Vehicle visit status is "${visit.current_status}". Gate entry is only permitted for DISPATCHED visits.`);
      }

      // 3. Confirm no GateLog already exists
      if (visit.gate_log) {
        throw new Error('Gate entry record already exists for this vehicle visit.');
      }

      // 4. Active Token Conflict Check: Check if token is assigned to another active in-plant vehicle
      const activeConflict = await tx.vehicleVisit.findFirst({
        where: {
          token_number: validated.tokenNumber,
          current_status: { notIn: ['COMPLETED', 'CANCELLED'] },
          gate_log: {
            entry_timestamp: { not: null },
            exit_timestamp: null,
          },
          id: { not: visitId },
        },
      });

      if (activeConflict) {
        throw new Error(
          `Token "${validated.tokenNumber}" is already assigned to active vehicle ${activeConflict.vehicle_number} currently inside the plant.`
        );
      }

      // 5. Atomic Status Claim: Update VehicleVisit.tokenNumber and set currentStatus to TOKEN_ISSUED
      const claimResult = await tx.vehicleVisit.updateMany({
        where: {
          id: visitId,
          current_status: { in: ['DISPATCHED', 'Dispatched'] },
        },
        data: {
          token_number: validated.tokenNumber,
          current_status: 'TOKEN_ISSUED',
        },
      });

      if (claimResult.count === 0) {
        throw new Error(`Vehicle visit is not in DISPATCHED status or gate entry was already recorded.`);
      }

      // 6. Create GateLog
      await tx.gateLog.create({
        data: {
          visit_id: visitId,
          entry_timestamp: chronoVal.date || now,
          entry_guard_id: userIdBigInt,
          entry_submitted_at: new Date(),
        },
      });

      const responsePayload = {
        success: true,
        visitId: visitId.toString(),
        tokenNumber: validated.tokenNumber,
        identifiers: paperLinkedIdentity(
          {
            entity: 'vehicle_visit',
            id: visitId.toString(),
            number: visit.visit_number,
          },
          [{ type: 'PLANT_GATE_TOKEN', value: validated.tokenNumber }]
        ),
        message: `Token ${validated.tokenNumber} issued. Vehicle ${visit.vehicle_number} entered gate.`,
      };

      if (idempotencyKey) {
        await recordOperation({
          key: idempotencyKey,
          operationType: 'GATE_ENTRY',
          entityType: 'vehicle_visit',
          entityId: visitId,
          requestPayload: canonicalPayload,
          responsePayload,
          statusCode: 200,
        }, tx);
      }

      return responsePayload;
    });

    return NextResponse.json(result);
  } catch (error) {
    if (idempotencyKey) {
      const concurrentReplay = await handleConcurrentReplayOrConflict(idempotencyKey, {
        operationType: 'GATE_ENTRY',
        entityType: 'vehicle_visit',
        entityId: BigInt((body as { visitId: string }).visitId || '0'),
        incomingPayload: canonicalPayload,
      });
      if (concurrentReplay) return concurrentReplay;
    }

    if (getErrorName(error) === 'ZodError') {
      return NextResponse.json({ error: getErrorIssues(error)?.[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to record gate entry' }, { status: 400 });
  }
}
