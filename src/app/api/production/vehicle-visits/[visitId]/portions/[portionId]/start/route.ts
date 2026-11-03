import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { getSiloProvisionalAvailableCapacity } from '@/backend/services/siloInventoryService';
import { calculatePhysicalLiters } from '@/backend/utils/milkFormulas';
import { isPlantLrTest } from '@/backend/services/vehicleQuantityService';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  try {
    const authUser = await getCurrentUser(req);
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles = ['SUPER_ADMIN', 'PRODUCTION_RECEPTION_OPERATOR', 'PRODUCTION_HEAD'];
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

    await prisma.$transaction(async (tx) => {
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
      const acceptedPortionsList = visit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      const isMultiPortion = acceptedPortionsList.length > 1;
      const isPortionWise = isMultiPortion || visit.test_mode === 'PORTION_WISE';
      const targetPortion = visit.portions.find((p) => p.id === BigInt(portionIdStr));
      const predTs = (isPortionWise && targetPortion?.first_weight_at)
        ? new Date(targetPortion.first_weight_at)
        : visit.weight_ticket.gross_timestamp
        ? new Date(visit.weight_ticket.gross_timestamp)
        : null;
      const chronoVal = validateOperationalTimestamp(opTimestampStr || serverNow.toISOString(), predTs, 'Unloading Start', 'Gross Weight');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 3. Operational time bound check vs Gross timestamp
      if (predTs && opTimestamp.getTime() < predTs.getTime()) {
        throw new Error(`Start timestamp (${opTimestamp.toISOString()}) cannot be earlier than previous weighment timestamp (${predTs.toISOString()}).`);
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
      let assignmentsToProcess: Assignment[] = [];

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

      // If Portion-Wise mode, strictly isolate the targeted portion
      if (isPortionWise) {
        const targetId = BigInt(portionIdStr);
        assignmentsToProcess = assignmentsToProcess.filter((a) => a.portion_id === targetId);
        if (assignmentsToProcess.length === 0 && inputSiloId) {
          assignmentsToProcess.push({ portion_id: targetId, silo_id: BigInt(inputSiloId) });
        }
        if (assignmentsToProcess.length === 0 && Array.isArray(inputAssignments) && inputAssignments.length > 0) {
          assignmentsToProcess.push({ portion_id: targetId, silo_id: BigInt(inputAssignments[0].siloId) });
        }
        if (assignmentsToProcess.length === 0) {
          throw new Error(`Target Portion #${portionIdStr} must have a destination silo assignment.`);
        }
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

        const declVal = portion.dispatch_quantity_value !== null && portion.dispatch_quantity_value !== undefined
          ? Number(portion.dispatch_quantity_value)
          : (visit.vehicle_dispatch_quantity_value !== null && visit.vehicle_dispatch_quantity_value !== undefined
              ? Number(visit.vehicle_dispatch_quantity_value) / acceptedPortions.length
              : 0);

        const declUnit = portion.dispatch_quantity_unit
          ? portion.dispatch_quantity_unit.toUpperCase()
          : (visit.vehicle_dispatch_quantity_unit ? visit.vehicle_dispatch_quantity_unit.toUpperCase() : 'LITER');

        let expectedLiters: number;

        // Resolve authoritative plant LR (check this portion first, then any performed plant LR on this visit, then dispatch LR, then fallback to 28)
        let resolvedLr: number | null = null;
        const performedPlantLr = portion.plant_lab_results.filter(
          (r) => isPlantLrTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole) && r.performance_status === 'PERFORMED' && r.numeric_value !== null
        );
        if (performedPlantLr.length > 0 && Number(performedPlantLr[0].numeric_value) > 0) {
          resolvedLr = Number(performedPlantLr[0].numeric_value);
        } else {
          // Check other portions on the vehicle (e.g. for COMPOSITE mode where tests were performed on Portion 1)
          const otherPortionLr = visit.portions.flatMap((p) => p.plant_lab_results).find(
            (r) => isPlantLrTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole) && r.performance_status === 'PERFORMED' && r.numeric_value !== null && Number(r.numeric_value) > 0
          );
          if (otherPortionLr) {
            resolvedLr = Number(otherPortionLr.numeric_value);
          } else {
            // Check dispatch lab results
            const dispatchLr = visit.portions.flatMap((p) => p.dispatch_lab_results).find(
              (r) => isPlantLrTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole) && r.numeric_value !== null && Number(r.numeric_value) > 0
            );
            if (dispatchLr) {
              resolvedLr = Number(dispatchLr.numeric_value);
            }
          }
        }

        if (declUnit === 'LITER') {
          expectedLiters = declVal > 0 ? declVal : (portion.first_weight_kg ? Number(portion.first_weight_kg) / 1.028 : 5000);
        } else if (declUnit === 'KG') {
          const lrToUse = resolvedLr !== null ? resolvedLr : 28.0;
          const kgToUse = declVal > 0 ? declVal : (portion.first_weight_kg ? Number(portion.first_weight_kg) : 5000);
          expectedLiters = calculatePhysicalLiters(kgToUse, lrToUse);
        } else {
          expectedLiters = declVal > 0 ? declVal : 5000;
        }

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
      await writeAuditLog(tx, {
        tableName: 'vehicle_visit',
        recordId: visitId,
        action: 'UNLOADING_STARTED',
        newValues: {
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
        actor: auditActorFromUser(dbUser),
      });

      return logsCreated;
    });

    return NextResponse.json({
      message: 'Unloading started successfully',
      visitId: visitIdStr,
      opTimestamp: opTimestamp.toISOString(),
    });
  } catch (err) {
    console.error('Error starting unloading:', err);
    const status = getErrorMessage(err)?.includes('INACTIVE') ? 409 : 400;
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to start unloading' }, { status });
  }
}
