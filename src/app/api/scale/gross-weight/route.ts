import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { validatePositiveDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { getErrorIssues, getErrorMessage, getErrorName } from '@/lib/errors';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { formatOperationalDatetime, parseStrictDateOnly } from '@/lib/datetime-utils';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import {
  findOperationRecord,
  recordOperation,
  checkOperationReplay,
  handleConcurrentReplayOrConflict,
} from '@/backend/services/operationIdempotencyService';
import { Prisma } from '@prisma/client';

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
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }

  let idempotencyKey = '';
  let canonicalPayload: any = null;
  let visitIdStr = '';

  try {
    visitIdStr = ((body.visitId || body.id) as string) || '';
    if (!visitIdStr) {
      return NextResponse.json({ error: 'Visit ID is required.' }, { status: 400 });
    }

    const grossVal = validatePositiveDecimal(body.grossWeightKg, 'Gross Weight');
    if (!grossVal.isValid) {
      return NextResponse.json({ error: grossVal.error }, { status: 400 });
    }
    const grossWeightKg = grossVal.value!;

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
        { error: 'Idempotency key is required for gross weight submission.' },
        { status: 400 }
      );
    }

    canonicalPayload = {
      visitId: visitIdStr,
      grossWeightKg,
      grossTimestamp: body.grossTimestamp ? new Date(body.grossTimestamp as string).toISOString() : null,
      driverName: typeof body.driverName === 'string' ? body.driverName.trim() : null,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : null,
    };

    // 1. Check idempotency store for existing completed operation
    const replay = await checkOperationReplay(idempotencyKey, {
      operationType: 'SCALE_GROSS_WEIGHT',
      entityType: 'vehicle_visit',
      entityId: visitId,
      incomingPayload: canonicalPayload,
    });
    if (replay) return replay;

    // 2. Check if visit already has gross weight recorded
    const existingVisit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: { weight_ticket: true },
    });

    if (existingVisit && existingVisit.weight_ticket && existingVisit.weight_ticket.gross_weight_kg) {
      return NextResponse.json(
        { error: `Conflict: Gross weight already recorded as ${existingVisit.weight_ticket.gross_weight_kg} kg under Ticket #${existingVisit.weight_ticket.ticket_number}.` },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Load VehicleVisit, gate_log, portions.dispatch_info, qa_session, weight_ticket
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          portions: {
            include: {
              dispatch_info: true,
            },
          },
          gate_log: true,
          qa_session: true,
          weight_ticket: true,
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      // Fetch DB predecessor timestamp (QA Completion / Gate Entry / Dispatch)
      const firstDispatchTs = visit.portions.find((p) => p.dispatch_info)?.dispatch_info?.dispatch_timestamp;
      const predecessorTs = visit.qa_session?.completed_at
        ? new Date(visit.qa_session.completed_at)
        : visit.gate_log?.entry_timestamp
        ? new Date(visit.gate_log.entry_timestamp)
        : firstDispatchTs
        ? new Date(firstDispatchTs)
        : null;

      const chronoVal = validateOperationalTimestamp((body.grossTimestamp as string) || serverNow.toISOString(), predecessorTs, 'Gross Weight', 'QA Completion');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 2. Confirm gate entry exists
      if (!visit.gate_log || !visit.gate_log.entry_timestamp) {
        throw new Error('Vehicle has not passed security gate entry yet.');
      }

      // Validate operator-selected gross operational timestamp vs server bounds
      const opTimestamp = body.grossTimestamp ? new Date(body.grossTimestamp as string) : serverNow;
      if (isNaN(opTimestamp.getTime())) {
        throw new Error('Invalid gross weight timestamp format.');
      }

      if (opTimestamp.getTime() > serverNow.getTime()) {
        throw new Error('Gross weight operational timestamp cannot be in the future.');
      }

      // Calculate lower bound timestamp (latest of dispatch, gate entry, QA completion)
      const lowerBounds: number[] = [];
      const firstDispatch = (visit.portions || []).find((p) => p.dispatch_info)?.dispatch_info;
      if (firstDispatch?.dispatch_timestamp) lowerBounds.push(new Date(firstDispatch.dispatch_timestamp).getTime());
      if (visit.gate_log?.entry_timestamp) lowerBounds.push(new Date(visit.gate_log.entry_timestamp).getTime());
      if (visit.qa_session?.completed_at) lowerBounds.push(new Date(visit.qa_session.completed_at).getTime());
      else if (visit.qa_session?.updated_at) lowerBounds.push(new Date(visit.qa_session.updated_at).getTime());

      if (lowerBounds.length > 0) {
        const minAllowedTimeMs = Math.max(...lowerBounds);
        if (opTimestamp.getTime() < minAllowedTimeMs - 5000) {
          throw new Error(`Gross weight operational timestamp cannot be earlier than previous workflow event (${formatOperationalDatetime(minAllowedTimeMs)}).`);
        }
      }

      // 3. Confirm status eligibility and execute atomic status claim lock (STRICT: READY_FOR_GROSS ONLY)
      const claimResult = await tx.vehicleVisit.updateMany({
        where: {
          id: visitId,
          current_status: 'READY_FOR_GROSS',
          OR: [
            { weight_ticket: { is: null } },
            { weight_ticket: { gross_weight_kg: null } }
          ]
        },
        data: { current_status: 'GROSS_WEIGHED' },
      });

      if (claimResult.count === 0) {
        throw new Error(`Vehicle (ID ${visitIdStr}) is either not in READY_FOR_GROSS status, or gross weight has already been recorded concurrently by another operator.`);
      }

      // 4. Strict Decision Gate: confirm ALL portions are definitively decided (no pending or unresolved conflicts)
      const unresolvedPortions = (visit.portions || []).filter((p) => {
        const dec = (p.plant_decision || '').toUpperCase();
        return (dec !== 'ACCEPTED' && dec !== 'REJECTED') || p.manager_review_status === 'PENDING';
      });
      if (unresolvedPortions.length > 0) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: visit.current_status } });
        throw new Error(`Gross weighing blocked: Portion #${unresolvedPortions[0].portion_number} is still pending QA decision or exception review. Every portion must be finalized before proceeding.`);
      }

      // Confirm at least one portion is ACCEPTED
      const acceptedPortions = (visit.portions || []).filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED');
      if (acceptedPortions.length === 0) {
        await tx.vehicleVisit.update({ where: { id: visitId }, data: { current_status: visit.current_status } });
        throw new Error('Gross weighing blocked. No accepted portions exist for this vehicle (all portions are rejected or pending).');
      }

      // 5. Confirm no gross weight already exists
      if (visit.weight_ticket && visit.weight_ticket.gross_weight_kg) {
        throw new Error(`Gross weight (${visit.weight_ticket.gross_weight_kg} kg) has already been recorded under Ticket #${visit.weight_ticket.ticket_number}.`);
      }

      // 6. Assign ticket number if empty
      const ticketNumber = (body.ticketNumber && String(body.ticketNumber).trim())
        ? String(body.ticketNumber).trim().toUpperCase()
        : `WT-${visit.token_number || visitIdStr}`;

      const existingTicket = await tx.weightTicket.findFirst({
        where: { ticket_number: ticketNumber, NOT: { visit_id: visitId } },
      });

      if (existingTicket) {
        throw new Error(`Ticket number "${ticketNumber}" already exists.`);
      }

      // 7. Create or update WeightTicket with operational gross_timestamp and server recorder ID
      let ticket;
      if (visit.weight_ticket) {
        ticket = await tx.weightTicket.update({
          where: { id: visit.weight_ticket.id },
          data: {
            ticket_number: ticketNumber,
            gross_weight_kg: grossWeightKg,
            gross_timestamp: opTimestamp,
            gross_recorded_by: userIdBigInt,
            gross_recorded_as_role: authUser.role,
            gross_submitted_at: new Date(),
            tare_weight_kg: null,
            tare_timestamp: null,
            tare_recorded_by: null,
            net_weight_kg: null,
          },
        });
      } else {
        ticket = await tx.weightTicket.create({
          data: {
            visit_id: visitId,
            ticket_number: ticketNumber,
            gross_weight_kg: grossWeightKg,
            gross_timestamp: opTimestamp,
            gross_recorded_by: userIdBigInt,
            gross_recorded_as_role: authUser.role,
            gross_submitted_at: new Date(),
            tare_weight_kg: null,
            tare_timestamp: null,
            tare_recorded_by: null,
            net_weight_kg: null,
          },
        });
      }

      // Update accepted portions with first weight
      // If multiple portions exist (N > 1), Portion 1 receives initial gross W0.
      // Subsequent portions (P2, P3...) will inherit their starting weight from the previous portion's tare weight.
      const sortedAccepted = [...acceptedPortions].sort((a, b) => a.portion_number - b.portion_number);
      const firstPortion = sortedAccepted[0];
      if (firstPortion) {
        await tx.visitPortion.update({
          where: { id: firstPortion.id },
          data: {
            first_weight_kg: grossWeightKg,
            first_weight_at: opTimestamp,
            first_weight_by_user_id: userIdBigInt,
          },
        });
      }

      // 8. Log Immutable Server Audit Record for Gross Weighting
      await writeAuditLog(tx, {
        tableName: 'weight_ticket',
        recordId: ticket.id,
        action: 'GROSS_WEIGHT_RECORDED',
        newValues: {
          visit_id: visitId.toString(),
          vehicle_number: visit.vehicle_number,
          token_number: visit.token_number,
          ticket_number: ticketNumber,
          gross_weight_kg: grossWeightKg,
          gross_timestamp: opTimestamp.toISOString(),
          submitted_at: serverNow.toISOString(),
          recorded_by: authUser.username,
        },
        actor: auditActorFromUser(dbUser),
      });

      // 8. Advance VehicleVisit status from GROSS_WEIGHED -> READY_FOR_UNLOADING
      // and assign authoritative Business Date (8:00 AM cutoff) at First Weight
      const grossBusinessDateStr = getOperationalBusinessDate(opTimestamp);
      const grossBusinessDate = parseStrictDateOnly(grossBusinessDateStr);

      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: {
          current_status: 'READY_FOR_UNLOADING',
          // Business Date is set once, at the first weight of the visit; later portions keep it.
          ...(visit.operational_date ? {} : { operational_date: grossBusinessDate }),
        },
      });

      const responsePayload = {
        success: true,
        ticketNumber: ticket.ticket_number,
        grossWeightKg: Number(ticket.gross_weight_kg),
        isPortionWise: (visit.portions || []).filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED').length > 1,
        isMultiPortion: (visit.portions || []).filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED').length > 1,
        message: `First Weight (Gross: ${grossWeightKg} kg) recorded successfully. Vehicle is ready for unloading.`,
      };

      if (idempotencyKey) {
        await recordOperation({
          key: idempotencyKey,
          operationType: 'SCALE_GROSS_WEIGHT',
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
        operationType: 'SCALE_GROSS_WEIGHT',
        entityType: 'vehicle_visit',
        entityId: BigInt(visitIdStr || '0'),
        incomingPayload: canonicalPayload,
      });
      if (concurrentReplay) return concurrentReplay;
    }

    if (getErrorName(error) === 'ZodError') {
      return NextResponse.json({ error: getErrorIssues(error)?.[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to record Scale 1 gross weight' }, { status: 400 });
  }
}
