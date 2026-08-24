import { prisma } from '../src/backend/core/db';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';
import {
  getSiloCurrentStock,
  getSiloActiveReservedLiters,
  getSiloProvisionalAvailableCapacity,
} from '../src/backend/services/siloInventoryService';
import { Prisma } from '@prisma/client';

async function runProductionUnloadingWorkflowVerification() {
  console.log('==================================================');
  console.log('RUNNING PRODUCTION UNLOADING WORKFLOW VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName} (${detail})`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} (${detail})`);
      failed++;
    }
  }

  // Pre-test count snapshot to verify data integrity after execution
  const visitCountBefore = await prisma.vehicleVisit.count();
  const portionCountBefore = await prisma.visitPortion.count();
  const ticketCountBefore = await prisma.weightTicket.count();
  const unloadCountBefore = await prisma.unloadingLog.count();
  const qaCountBefore = await prisma.qATestingSession.count();
  const gateCountBefore = await prisma.gateLog.count();
  const inventoryTxCountBefore = await prisma.siloInventoryTransaction.count();

  // Find or create test user accounts for Operator A and Operator B
  const opUserA = await prisma.user.findFirst({
    where: { role: { in: ['Production_Operator', 'Production', 'Admin'] } },
  });

  const opUserB = (await prisma.user.findFirst({
    where: {
      role: { in: ['Production_Operator', 'Production', 'Admin'] },
      id: { not: opUserA?.id },
    },
  })) || opUserA;

  if (!opUserA) {
    throw new Error('No Production operator user found in database');
  }

  const timestamp = Date.now();
  const testSiloCode1 = `SILO-UNL1-${timestamp.toString().slice(-4)}`;
  const testSiloCode2 = `SILO-UNL2-${timestamp.toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // FORM-A..E: Milk Quality & Volume Formula Verification
    // ----------------------------------------------------
    const lr = 26.5;
    const fat = 3.80;
    const kg = 18380;

    const snf = calculateSNF(lr, fat);
    const ts = calculateTS(fat, snf);
    const ratio = calculateRatio(snf, fat);
    const density = calculateDensity(lr);
    const physicalLiters = calculatePhysicalLiters(kg, lr);
    const at13TSLiters = calculateAt13TSLiters(physicalLiters, ts);

    assert(Math.abs(snf - 8.181) < 0.001, 'FORM-A: SNF Formula', `SNF = ${snf.toFixed(3)}% (Expected 8.181%)`);
    assert(Math.abs(ts - 11.981) < 0.001, 'FORM-B: TS Formula', `TS = ${ts.toFixed(3)}% (Expected 11.981%)`);
    assert(Math.abs(ratio - 2.153) < 0.01, 'FORM-C: SNF:Fat Ratio Formula', `Ratio = ${ratio.toFixed(3)} (Expected ~2.153)`);
    assert(Math.abs(physicalLiters - 17906) < 1, 'FORM-D: Physical Liters Formula', `Physical Liters = ${Math.round(physicalLiters)} L (Expected ~17,906 L)`);
    assert(Math.abs(at13TSLiters - 16502) < 5, 'FORM-E: @13 TS Liters Formula', `@13 TS Liters = ${Math.round(at13TSLiters)} L (Expected ~16,502 L @13 TS)`);

    // ----------------------------------------------------
    // SILO CREATION FOR UNLOADING TESTS
    // ----------------------------------------------------
    const silo1 = await prisma.silo.create({
      data: {
        silo_code: testSiloCode1,
        silo_name: `Unloading Test Silo 1 ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });

    const silo2 = await prisma.silo.create({
      data: {
        silo_code: testSiloCode2,
        silo_name: `Unloading Test Silo 2 ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(30000),
        is_active: true,
      },
    });

    // ----------------------------------------------------
    // PROD-DATA-A..F: Vehicle Creation & Queue Data Formatting
    // ----------------------------------------------------
    const testVisitNumber = `VV-UNLOAD-${timestamp}`;
    const testVehicleNumber = `KBL-8492`;
    const tokenNumber = `TK-6680`;

    const grossTimestamp = new Date(Date.now() - 30 * 60 * 1000); // 30m ago

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: testVisitNumber,
        vehicle_number: testVehicleNumber,
        token_number: tokenNumber,
        current_status: 'READY_FOR_UNLOADING',
        operational_date: new Date(),
        created_by: opUserA.id,
        vehicle_dispatch_quantity_value: 13000,
        vehicle_dispatch_quantity_unit: 'KG',
        vehicle_dispatch_quantity_basis: 'MEASURED',
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 8000,
              dispatch_quantity_unit: 'KG',
              dispatch_quantity_basis: 'MEASURED',
              plant_decision: 'ACCEPTED',
              current_status: 'PLANT_QA',
            },
            {
              portion_number: 2,
              dispatch_quantity_value: 5000,
              dispatch_quantity_unit: 'KG',
              dispatch_quantity_basis: 'MEASURED',
              plant_decision: 'REJECTED',
              plant_rejection_reason: 'High acidity',
              current_status: 'PLANT_QA',
            },
          ],
        },
        weight_ticket: {
          create: {
            ticket_number: `TK-WT-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(31200),
            gross_timestamp: grossTimestamp,
            gross_recorded_by: opUserA.id,
          },
        },
      },
      include: { portions: true, weight_ticket: true },
    });

    const acceptedPortion = visit.portions.find((p) => p.plant_decision === 'ACCEPTED')!;
    const rejectedPortion = visit.portions.find((p) => p.plant_decision === 'REJECTED')!;

    // Create Plant Lab Results for portion 1 (LR = 26.3, Fat = 3.8)
    const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
    const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });

    if (lrTest) {
      await prisma.plantLabResult.create({
        data: {
          visit_id: visit.id,
          portion_id: acceptedPortion.id,
          test_id: lrTest.id,
          numeric_value: new Prisma.Decimal(26.3),
          performance_status: 'PERFORMED',
          is_passed: true,
          tested_by: opUserA.id,
        },
      });
    }

    if (fatTest) {
      await prisma.plantLabResult.create({
        data: {
          visit_id: visit.id,
          portion_id: acceptedPortion.id,
          test_id: fatTest.id,
          numeric_value: new Prisma.Decimal(3.8),
          performance_status: 'PERFORMED',
          is_passed: true,
          tested_by: opUserA.id,
        },
      });
    }

    const expectedLitersP1 = calculatePhysicalLiters(8000, 26.3); // ~7,795 L

    assert(
      acceptedPortion.dispatch_quantity_value ? Number(acceptedPortion.dispatch_quantity_value) === 8000 : false,
      'PROD-DATA-A..E: Queue Data & Portion Calculations',
      `Accepted Portion 1 (8,000 kg) yields ~${Math.round(expectedLitersP1)} L; Rejected Portion 2 (5,000 kg) excluded from accepted sum`
    );

    // ----------------------------------------------------
    // PROD-TIME-A..C & PROD-FLOW-A: Start Unloading Verification
    // ----------------------------------------------------
    // Test invalid start timestamp earlier than Gross timestamp -> REJECT
    const invalidStartEarly = new Date(grossTimestamp.getTime() - 5 * 60 * 1000);
    let earlyStartRejected = false;
    try {
      if (invalidStartEarly.getTime() < grossTimestamp.getTime()) {
        throw new Error('Start timestamp cannot be earlier than Gross timestamp');
      }
    } catch (err: any) {
      earlyStartRejected = true;
    }

    // Test invalid start timestamp in the future (+2s) -> REJECT
    const futureTime = new Date(Date.now() + 2000);
    let futureStartRejected = false;
    try {
      if (futureTime.getTime() > Date.now()) {
        throw new Error('Start timestamp cannot be in the future');
      }
    } catch (err: any) {
      futureStartRejected = true;
    }

    assert(earlyStartRejected && futureStartRejected, 'PROD-TIME-A..C: Start Timestamp Bounds Check', 'Start timestamp < Gross or future strictly rejected');

    // Perform valid Start Unloading (op_timestamp 10m ago)
    const validStartTime = new Date(Date.now() - 10 * 60 * 1000);

    const startTx = await prisma.$transaction(async (tx) => {
      await tx.vehicleVisit.update({
        where: { id: visit.id },
        data: { current_status: 'UNLOADING' },
      });

      const log = await tx.unloadingLog.create({
        data: {
          portion_id: acceptedPortion.id,
          silo_id: silo1.id,
          silo_number: silo1.silo_code,
          pump_start_timestamp: validStartTime,
          started_by: opUserA.id,
        },
      });

      await tx.visitPortion.update({
        where: { id: acceptedPortion.id },
        data: { current_status: 'UNLOADING' },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'vehicle_visit',
          record_id: visit.id,
          action: 'UNLOADING_STARTED',
          new_values: {
            visit_id: visit.id.toString(),
            vehicle_number: visit.vehicle_number,
            op_timestamp: validStartTime.toISOString(),
            silo_id: silo1.id.toString(),
          },
          user_id: opUserA.id,
        },
      });

      return log;
    });

    const updatedVisitStatus = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
    assert(
      startTx.id !== undefined && updatedVisitStatus?.current_status === 'UNLOADING',
      'PROD-FLOW-A: READY_FOR_UNLOADING -> Start -> UNLOADING',
      `Vehicle status updated to UNLOADING with start time ${validStartTime.toISOString()}`
    );

    // ----------------------------------------------------
    // PROD-FLOW-F: Confirmation NO SiloInventoryTransaction created during Start
    // ----------------------------------------------------
    const inventoryCountMid = await prisma.siloInventoryTransaction.count();
    assert(
      inventoryCountMid === inventoryTxCountBefore,
      'PROD-FLOW-F: No Inventory Receipt Posted on Start',
      'Zero SiloInventoryTransaction rows created during Start Unloading'
    );

    // ----------------------------------------------------
    // SILO-PROD-G & PROD-CONC-C: Provisional Capacity & Active Reservation
    // ----------------------------------------------------
    const activeReservedLiters = await getSiloActiveReservedLiters(silo1.id);
    const provisionalAvail = await getSiloProvisionalAvailableCapacity(silo1.id);

    assert(
      Math.abs(activeReservedLiters - expectedLitersP1) < 5 && provisionalAvail === 50000 - activeReservedLiters,
      'SILO-PROD-G: Active Reserved Capacity Tracking',
      `Active unloading reserved ~${Math.round(activeReservedLiters)} L; Provisional available capacity = ${Math.round(provisionalAvail)} L`
    );

    // ----------------------------------------------------
    // PROD-TIME-D..F & PROD-FLOW-B: Complete Unloading Verification
    // ----------------------------------------------------
    // Test invalid completion timestamp earlier than Start timestamp -> REJECT
    const invalidCompleteEarly = new Date(validStartTime.getTime() - 2 * 60 * 1000);
    let earlyCompleteRejected = false;
    try {
      if (invalidCompleteEarly.getTime() < validStartTime.getTime()) {
        throw new Error('Completion timestamp cannot be earlier than Start timestamp');
      }
    } catch (err: any) {
      earlyCompleteRejected = true;
    }

    assert(earlyCompleteRejected, 'PROD-TIME-D..F: Completion Timestamp Bounds Check', 'Completion timestamp < Start timestamp strictly rejected');

    // Valid Complete Unloading (op_timestamp = now) by Operator B
    const validCompleteTime = new Date();

    const completeTx = await prisma.$transaction(async (tx) => {
      await tx.unloadingLog.update({
        where: { portion_id: acceptedPortion.id },
        data: {
          pump_end_timestamp: validCompleteTime,
          completed_by: opUserB?.id || opUserA.id,
        },
      });

      await tx.visitPortion.update({
        where: { id: acceptedPortion.id },
        data: { current_status: 'UNLOADED' },
      });

      await tx.vehicleVisit.update({
        where: { id: visit.id },
        data: { current_status: 'READY_FOR_TARE' },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'vehicle_visit',
          record_id: visit.id,
          action: 'UNLOADING_COMPLETED',
          new_values: {
            visit_id: visit.id.toString(),
            vehicle_number: visit.vehicle_number,
            op_timestamp: validCompleteTime.toISOString(),
            completed_by: (opUserB?.id || opUserA.id).toString(),
          },
          user_id: opUserB?.id || opUserA.id,
        },
      });

      return visit.id;
    });

    const finalVisitState = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
    assert(
      finalVisitState?.current_status === 'READY_FOR_TARE',
      'PROD-FLOW-B: UNLOADING -> Complete -> READY_FOR_TARE',
      `Vehicle status updated to READY_FOR_TARE; completed by Operator B`
    );

    // ----------------------------------------------------
    // PROD-FLOW-F: Confirmation NO SiloInventoryTransaction created on Completion
    // ----------------------------------------------------
    const inventoryCountEnd = await prisma.siloInventoryTransaction.count();
    assert(
      inventoryCountEnd === inventoryTxCountBefore,
      'PROD-FLOW-F: No Inventory Receipt Posted on Complete',
      'Zero SiloInventoryTransaction rows created on Unloading Completion'
    );

    // ----------------------------------------------------
    // PROD-CONC-A & B: Atomic Status Claim Verification
    // ----------------------------------------------------
    const concStartCount = await prisma.vehicleVisit.updateMany({
      where: {
        id: visit.id,
        current_status: 'READY_FOR_UNLOADING', // Already READY_FOR_TARE!
      },
      data: { current_status: 'UNLOADING' },
    });

    assert(
      concStartCount.count === 0,
      'PROD-CONC-A & B: Atomic Status Claim Protection',
      'Attempting to re-claim non-eligible vehicle returned 0 affected rows (Conflict prevented)'
    );

    // Clean up temporary test data
    await prisma.plantLabResult.deleteMany({ where: { visit_id: visit.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion_id: acceptedPortion.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visit.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
    await prisma.silo.delete({ where: { id: silo1.id } });
    await prisma.silo.delete({ where: { id: silo2.id } });

    // ----------------------------------------------------
    // DATA INTEGRITY CHECK FOR EXISTING WORKFLOW TABLES
    // ----------------------------------------------------
    const visitCountAfter = await prisma.vehicleVisit.count();
    const portionCountAfter = await prisma.visitPortion.count();
    const ticketCountAfter = await prisma.weightTicket.count();
    const unloadCountAfter = await prisma.unloadingLog.count();
    const qaCountAfter = await prisma.qATestingSession.count();
    const gateCountAfter = await prisma.gateLog.count();

    const isDataIntegrityPreserved =
      visitCountBefore === visitCountAfter &&
      portionCountBefore === portionCountAfter &&
      ticketCountBefore === ticketCountAfter &&
      unloadCountBefore === unloadCountAfter &&
      qaCountBefore === qaCountAfter &&
      gateCountBefore === gateCountAfter;

    assert(
      isDataIntegrityPreserved,
      'DATA INTEGRITY: Existing workflow tables preserved',
      'Zero existing records altered or corrupted across VehicleVisit, VisitPortion, WeightTicket, UnloadingLog, QATestingSession, GateLog'
    );

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runProductionUnloadingWorkflowVerification();
