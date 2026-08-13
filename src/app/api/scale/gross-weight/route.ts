import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { grossWeightSchema } from '@/lib/validations/scale';
import { validatePositiveDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
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

  const allowedRoles = ['WEIGHBRIDGE_OPERATOR', 'Weighbridge_Operator', 'Production_Operator', 'Admin', 'Correction_Officer'];
  if (!allowedRoles.includes(authUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. Weighbridge Operator role required.' }, { status: 403 });
  }

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

    const grossVal = validatePositiveDecimal(body.grossWeightKg, 'Gross Weight');
    if (!grossVal.isValid) {
      return NextResponse.json({ error: grossVal.error }, { status: 400 });
    }
    const grossWeightKg = grossVal.value!;

    const visitId = BigInt(visitIdStr);
    const serverNow = new Date();

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

      const chronoVal = validateOperationalTimestamp(body.grossTimestamp || serverNow.toISOString(), predecessorTs, 'Gross Weight', 'QA Completion');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 2. Confirm gate entry exists
      if (!visit.gate_log || !visit.gate_log.entry_timestamp) {
        throw new Error('Vehicle has not passed security gate entry yet.');
      }

      // Validate operator-selected gross operational timestamp vs server bounds
      const opTimestamp = body.grossTimestamp ? new Date(body.grossTimestamp) : serverNow;
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
          throw new Error(`Gross weight operational timestamp cannot be earlier than previous workflow event (${new Date(minAllowedTimeMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`);
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

      // 4. Confirm at least one portion is ACCEPTED
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
            gross_submitted_at: new Date(),
            tare_weight_kg: null,
            tare_timestamp: null,
            tare_recorded_by: null,
            net_weight_kg: null,
          },
        });
      }

      // 8. Log Immutable Server Audit Record for Gross Weighting
      await tx.auditLog.create({
        data: {
          table_name: 'weight_ticket',
          record_id: ticket.id,
          action: 'GROSS_WEIGHT_RECORDED',
          user_id: userIdBigInt,
          new_values: {
            visit_id: visitId.toString(),
            vehicle_number: visit.vehicle_number,
            token_number: visit.token_number,
            ticket_number: ticketNumber,
            gross_weight_kg: grossWeightKg,
            gross_timestamp: opTimestamp.toISOString(),
            submitted_at: serverNow.toISOString(),
            recorded_by: authUser.username,
          },
        },
      });

      // 8. Advance VehicleVisit status from GROSS_WEIGHED -> READY_FOR_UNLOADING
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'READY_FOR_UNLOADING' },
      });

      return { visit, ticket };
    });

    return NextResponse.json({
      success: true,
      ticketNumber: result.ticket.ticket_number,
      grossWeightKg: Number(result.ticket.gross_weight_kg),
      message: `First Weight (Gross: ${grossWeightKg} kg) recorded successfully. Vehicle is ready for unloading.`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to record Scale 1 gross weight' }, { status: 400 });
  }
}
