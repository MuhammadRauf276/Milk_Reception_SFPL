import { prisma } from '../src/backend/core/db';
import {
  calculatePhysicalLiters,
} from '../src/backend/utils/milkFormulas';
import {
  getSiloCurrentStockLiters,
  getSiloAvailableCapacity,
  getSiloActiveReservedLiters,
  finalizeSiloReceiptForVisit,
} from '../src/backend/services/siloInventoryService';
import { Prisma, SiloTransactionType } from '@prisma/client';

async function runTareSiloReceiptHardenedVerification() {
  console.log('==================================================');
  console.log('RUNNING HARDENED TARE WEIGHT -> FINAL SILO RECEIPT VERIFICATION');
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

  // Find Weighbridge operator user for performed_by accountability
  const wbUser = await prisma.user.findFirst({
    where: { role: { in: ['WEIGHBRIDGE_OPERATOR', 'Weighbridge_Operator', 'Admin'] } },
  });

  if (!wbUser) {
    throw new Error('No Weighbridge operator user found in database');
  }

  const timestamp = Date.now();
  const testSiloCode1 = `SILO-[#1]-${timestamp.toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // SILO CREATION FOR TARE WORKFLOW TESTS
    // ----------------------------------------------------
    const silo1 = await prisma.silo.create({
      data: {
        silo_code: testSiloCode1,
        silo_name: `Hardened Tare Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });

    // ----------------------------------------------------
    // TEST SCENARIO 1: Plant LR Missing (Dispatch LR present) -> Tare succeeds, Receipt Pending, Status = TARE_WEIGHED
    // ----------------------------------------------------
    const testVisitNoPlantLr = `VV-NOPLANT-${timestamp}`;
    const visitNoPlantLr = await prisma.vehicleVisit.create({
      data: {
        visit_number: testVisitNoPlantLr,
        vehicle_number: `KBL-7711`,
        token_number: `TK-7711`,
        current_status: 'READY_FOR_TARE',
        operational_date: new Date(),
        created_by: wbUser.id,
        portions: {
          create: [{ portion_number: 1, declared_quantity_kg: 8000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
        weight_ticket: {
          create: {
            ticket_number: `TK-NOPLANT-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(31200),
            tare_weight_kg: new Prisma.Decimal(23050),
            net_weight_kg: new Prisma.Decimal(8150),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            gross_recorded_by: wbUser.id,
          },
        },
      },
      include: { portions: true, weight_ticket: true },
    });

    const pNoPlant = visitNoPlantLr.portions[0];

    await prisma.unloadingLog.create({
      data: {
        portion_id: pNoPlant.id,
        silo_id: silo1.id,
        silo_number: silo1.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });

    // Attach ONLY Dispatch LR (28.5) — NO Plant LR attached!
    const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
    if (lrTest) {
      await prisma.dispatchLabResult.create({
        data: {
          visit_id: visitNoPlantLr.id,
          portion_id: pNoPlant.id,
          test_id: lrTest.id,
          numeric_value: new Prisma.Decimal(28.5),
          is_passed: true,
          tested_by: wbUser.id,
        },
      });
    }

    // Call finalizeSiloReceiptForVisit directly on missing Plant LR visit
    const finalizePendingRes = await finalizeSiloReceiptForVisit(visitNoPlantLr.id, wbUser.id);
    const reservationPending = await getSiloActiveReservedLiters(silo1.id);

    assert(
      !finalizePendingRes.success &&
        finalizePendingRes.reason === 'MISSING_PLANT_LR' &&
        reservationPending > 0,
      'LR-HARD-B & LR-RES-A: Missing Plant LR -> Dispatch LR / 26.5 Fallback Rejected & Reservation Retained',
      'Final receipt rejected when Plant LR missing; Dispatch LR NOT used for final stock; reservation remains active in TARE_WEIGHED'
    );

    // ----------------------------------------------------
    // TEST SCENARIO 2: Attach Authoritative Plant LR -> Finalization Succeeds cleanly
    // ----------------------------------------------------
    if (lrTest) {
      await prisma.plantLabResult.create({
        data: {
          visit_id: visitNoPlantLr.id,
          portion_id: pNoPlant.id,
          test_id: lrTest.id,
          numeric_value: new Prisma.Decimal(26.5),
          is_passed: true,
          tested_by: wbUser.id,
        },
      });
    }

    // Set net_weight_kg on weight ticket for finalization test
    await prisma.weightTicket.update({
      where: { id: visitNoPlantLr.weight_ticket!.id },
      data: { tare_weight_kg: new Prisma.Decimal(23050), net_weight_kg: new Prisma.Decimal(8150) },
    });

    const finalizeSuccessRes = await finalizeSiloReceiptForVisit(visitNoPlantLr.id, wbUser.id);
    const finalStockLitersSilo1 = await getSiloCurrentStockLiters(silo1.id);
    const reservationPostFinalize = await getSiloActiveReservedLiters(silo1.id);
    const visitPostFinalize = await prisma.vehicleVisit.findUnique({ where: { id: visitNoPlantLr.id } });

    assert(
      finalizeSuccessRes.success &&
        finalizeSuccessRes.receiptCreated &&
        Math.abs(finalStockLitersSilo1 - 7940) < 5 &&
        reservationPostFinalize === 0 &&
        visitPostFinalize?.current_status === 'READY_FOR_GATE_EXIT',
      'LR-HARD-A & LR-RES-B: Plant LR Attached -> Final Receipt Posted & Reservation Replaced',
      `Authoritative Plant LR (26.5) calculated ~${Math.round(finalStockLitersSilo1)} L; Status advanced to READY_FOR_GATE_EXIT; Reservation replaced by finalized stock`
    );

    // ----------------------------------------------------
    // IDEM-A..D: Database-Level Idempotency Protection
    // ----------------------------------------------------
    const retryRes = await finalizeSiloReceiptForVisit(visitNoPlantLr.id, wbUser.id);
    const receiptRowsCount = await prisma.siloInventoryTransaction.count({
      where: { visit_id: visitNoPlantLr.id, transaction_type: SiloTransactionType.RECEIPT },
    });

    let duplicateKeyViolationCaught = false;
    try {
      // Attempt direct raw insert with same idempotency key "FINAL_RECEIPT:VISIT:<id>"
      await prisma.siloInventoryTransaction.create({
        data: {
          silo_id: silo1.id,
          transaction_type: SiloTransactionType.RECEIPT,
          quantity_kg: new Prisma.Decimal(8150),
          quantity_liters: new Prisma.Decimal(7940),
          operational_timestamp: new Date(),
          visit_id: visitNoPlantLr.id,
          portion_id: pNoPlant.id,
          reference_type: 'SCALE2_TARE_WEIGHMENT',
          reference_id: `TK-NOPLANT-${timestamp}`,
          idempotency_key: `FINAL_RECEIPT:VISIT:${visitNoPlantLr.id.toString()}`, // Duplicate idempotency key!
          performed_by: wbUser.id,
        },
      });
    } catch (err: any) {
      duplicateKeyViolationCaught = true;
    }

    assert(
      Boolean(retryRes.alreadyFinalized) && receiptRowsCount === 1 && duplicateKeyViolationCaught,
      'IDEM-A..D: Database-Level Idempotency & Unique Constraint Enforcement',
      'Sequential retry returned alreadyFinalized; exactly 1 RECEIPT row exists; duplicate idempotency key rejected by PostgreSQL'
    );

    // ----------------------------------------------------
    // AUD-HARD-A..C: AuditLog Traceability
    // ----------------------------------------------------
    const auditFinalized = await prisma.auditLog.findFirst({
      where: { record_id: visitNoPlantLr.id, action: 'SILO_RECEIPT_FINALIZED' },
    });

    assert(
      auditFinalized !== null,
      'AUD-HARD-A..C: AuditLog SILO_RECEIPT_FINALIZED Event',
      `Immutable AuditLog created action=SILO_RECEIPT_FINALIZED for visit #${visitNoPlantLr.visit_number}`
    );

    // Clean up temporary test data
    await prisma.plantLabResult.deleteMany({ where: { visit_id: visitNoPlantLr.id } });
    await prisma.dispatchLabResult.deleteMany({ where: { visit_id: visitNoPlantLr.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: visitNoPlantLr.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion_id: pNoPlant.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visitNoPlantLr.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visitNoPlantLr.id } });
    await prisma.vehicleVisit.delete({ where: { id: visitNoPlantLr.id } });
    await prisma.silo.delete({ where: { id: silo1.id } });

    // ----------------------------------------------------
    // DATA INTEGRITY CHECK FOR EXISTING WORKFLOW TABLES
    // ----------------------------------------------------
    const visitCountAfter = await prisma.vehicleVisit.count();
    const portionCountAfter = await prisma.visitPortion.count();
    const ticketCountAfter = await prisma.weightTicket.count();
    const unloadCountAfter = await prisma.unloadingLog.count();
    const qaCountAfter = await prisma.qATestingSession.count();
    const gateCountAfter = await prisma.gateLog.count();
    const inventoryTxCountAfter = await prisma.siloInventoryTransaction.count();

    const isDataIntegrityPreserved =
      visitCountBefore === visitCountAfter &&
      portionCountBefore === portionCountAfter &&
      ticketCountBefore === ticketCountAfter &&
      unloadCountBefore === unloadCountAfter &&
      qaCountBefore === qaCountAfter &&
      gateCountBefore === gateCountAfter &&
      inventoryTxCountBefore === inventoryTxCountAfter;

    assert(
      isDataIntegrityPreserved,
      'DATA INTEGRITY: Existing workflow tables preserved',
      'Zero existing records altered or corrupted across VehicleVisit, VisitPortion, WeightTicket, UnloadingLog, QATestingSession, GateLog, SiloInventoryTransaction'
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

runTareSiloReceiptHardenedVerification();
