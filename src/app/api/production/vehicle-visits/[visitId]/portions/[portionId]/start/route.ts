import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { getSiloProvisionalAvailableCapacity } from '@/backend/services/siloInventoryService';
import { calculatePhysicalLiters } from '@/backend/utils/milkFormulas';
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

    const { visitId: visitIdStr, portionId: portionIdStr } = await params;
    const visitId = BigInt(visitIdStr);

    const body = await req.json();
    const { siloId: inputSiloId, opTimestamp: opTimestampStr, assignments: inputAssignments } = body;

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
        return NextResponse.json({ error: 'Start timestamp cannot be in the future' }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Load vehicle visit with weight ticket
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          weight_ticket: true,
          portions: {
            include: {
              unloading_log: true,
              plant_lab_results: { include: { lab_test: true } },
              dispatch_lab_results: { include: { lab_test: true } },
            },
          },
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit not found');
      }

      // 2. Validate Scale 1 Gross Weight exists
      if (!visit.weight_ticket || visit.weight_ticket.gross_weight_kg === null) {
        throw new Error('Gross weight has not been recorded for this vehicle. Scale 1 gross weighment is required before unloading.');
      }

      // Validate exact chronology against DB predecessor gross_timestamp
      const predTs = visit.weight_ticket.gross_timestamp ? new Date(visit.weight_ticket.gross_timestamp) : null;
      const chronoVal = validateOperationalTimestamp(opTimestampStr || serverNow.toISOString(), predTs, 'Unloading Start', 'Gross Weight');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 3. Operational time bound check vs Gross timestamp
      if (visit.weight_ticket.gross_timestamp && opTimestamp.getTime() < visit.weight_ticket.gross_timestamp.getTime()) {
        throw new Error(`Start timestamp (${opTimestamp.toISOString()}) cannot be earlier than Gross Weight timestamp (${visit.weight_ticket.gross_timestamp.toISOString()}).`);
      }

      // 4. Atomic claim for READY_FOR_UNLOADING status
      const updatedVisitCount = await tx.vehicleVisit.updateMany({
        where: {
          id: visitId,
          current_status: { in: ['READY_FOR_UNLOADING', 'GROSS_WEIGHED'] },
        },
        data: { current_status: 'UNLOADING' },
      });

      if (updatedVisitCount.count === 0 && visit.current_status !== 'UNLOADING') {
        throw new Error(`Vehicle is not eligible for unloading (Current Status: ${visit.current_status}).`);
      }

      // 5. Gather portion assignments
      const acceptedPortions = visit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      if (acceptedPortions.length === 0) {
        throw new Error('Vehicle has zero accepted portions eligible for unloading');
      }

      type Assignment = { portion_id: bigint; silo_id: bigint };
      const assignmentsToProcess: Assignment[] = [];

      if (Array.isArray(inputAssignments) && inputAssignments.length > 0) {
        for (const a of inputAssignments) {
          assignmentsToProcess.push({
            portion_id: BigInt(a.portionId),
            silo_id: BigInt(a.siloId),
          });
        }
      } else if (inputSiloId) {
        const portionId = BigInt(portionIdStr);
        assignmentsToProcess.push({
          portion_id: portionId,
          silo_id: BigInt(inputSiloId),
        });
      } else {
        throw new Error('Destination Silo is required for unloading assignment');
      }

      // 6. Validate Silos and Provisional Capacity
      const siloExpectedLitersMap = new Map<bigint, number>();

      for (const assign of assignmentsToProcess) {
        const portion = acceptedPortions.find((p) => p.id === assign.portion_id);
        if (!portion) {
          throw new Error(`Portion #${assign.portion_id} is not an accepted portion of this visit`);
        }

        // Lock Silo row FOR UPDATE in database
        await tx.$executeRaw`SELECT id FROM silo WHERE id = ${assign.silo_id} FOR UPDATE`;

        const silo = await tx.silo.findUnique({ where: { id: assign.silo_id } });
        if (!silo) {
          throw new Error(`Silo record not found (ID: ${assign.silo_id})`);
        }
        if (!silo.is_active) {
          throw new Error(`Silo "${silo.silo_name}" (${silo.silo_code}) is INACTIVE and cannot receive new milk.`);
        }

        const declaredKg = portion.declared_quantity_kg ? Number(portion.declared_quantity_kg) : 0;
        const plantLr = portion.plant_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
        );
        const dispatchLr = portion.dispatch_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
        );
        const lrVal = plantLr?.numeric_value ? Number(plantLr.numeric_value) : dispatchLr?.numeric_value ? Number(dispatchLr.numeric_value) : 26.5;

        const expectedLiters = calculatePhysicalLiters(declaredKg, lrVal);
        const currentSum = siloExpectedLitersMap.get(assign.silo_id) || 0;
        siloExpectedLitersMap.set(assign.silo_id, currentSum + expectedLiters);
      }

      // Check provisional capacity for each targeted Silo
      for (const [siloIdKey, expectedLitersTotal] of Array.from(siloExpectedLitersMap.entries())) {
        const silo = await tx.silo.findUnique({ where: { id: siloIdKey } });
        const provisionalAvailable = await getSiloProvisionalAvailableCapacity(siloIdKey, tx);

        if (expectedLitersTotal > provisionalAvailable) {
          throw new Error(
            `Expected incoming load (${Math.round(expectedLitersTotal)} L) exceeds provisional available capacity (${Math.round(provisionalAvailable)} L) of Silo ${silo?.silo_code}.`
          );
        }
      }

      // 7. Create/Update UnloadingLog records
      const logsCreated = [];
      for (const assign of assignmentsToProcess) {
        const silo = await tx.silo.findUnique({ where: { id: assign.silo_id } });

        const log = await tx.unloadingLog.upsert({
          where: { portion_id: assign.portion_id },
          create: {
            portion_id: assign.portion_id,
            silo_id: assign.silo_id,
            silo_number: silo?.silo_code || 'SILO',
            pump_start_timestamp: opTimestamp,
            start_submitted_at: new Date(),
            started_by: userIdBigInt,
          },
          update: {
            silo_id: assign.silo_id,
            silo_number: silo?.silo_code || 'SILO',
            pump_start_timestamp: opTimestamp,
            start_submitted_at: new Date(),
            started_by: userIdBigInt,
          },
        });

        await tx.visitPortion.update({
          where: { id: assign.portion_id },
          data: { current_status: 'UNLOADING' },
        });

        logsCreated.push(log);
      }

      // 8. Immutable AuditLog creation
      await tx.auditLog.create({
        data: {
          table_name: 'vehicle_visit',
          record_id: visitId,
          action: 'UNLOADING_STARTED',
          new_values: {
            visit_id: visitId.toString(),
            vehicle_number: visit.vehicle_number,
            token_number: visit.token_number,
            op_timestamp: opTimestamp.toISOString(),
            submitted_at: serverNow.toISOString(),
            user_id: userIdBigInt.toString(),
            user_name: dbUser.full_name || dbUser.username,
            assignments: assignmentsToProcess.map((a) => ({
              portion_id: a.portion_id.toString(),
              silo_id: a.silo_id.toString(),
            })),
          },
          user_id: userIdBigInt,
          created_at: serverNow,
        },
      });

      return logsCreated;
    });

    return NextResponse.json({
      message: 'Unloading started successfully',
      visitId: visitIdStr,
      opTimestamp: opTimestamp.toISOString(),
    });
  } catch (err: any) {
    console.error('Error starting unloading:', err);
    return NextResponse.json({ error: err.message || 'Failed to start unloading' }, { status: 400 });
  }
}
