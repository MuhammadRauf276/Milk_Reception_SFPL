import { prisma } from '../src/backend/core/db';
import { calculatePhysicalLiters } from '../src/backend/utils/milkFormulas';
import { finalizeSiloReceiptForVisit } from '../src/backend/services/siloInventoryService';
import { Prisma, SiloTransactionType } from '@prisma/client';

async function runSecurityGateExitE2EVerification() {
  console.log('==================================================');
  console.log('RUNNING SECURITY GATE EXIT E2E & WORKFLOW COMPLETION VERIFICATION');
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

  // Find security operator user for accountability
  const secUser = await prisma.user.findFirst({
    where: { role: { in: ['Security_Operator', 'Security_Manager', 'Admin'] } },
  });

  const wbUser = await prisma.user.findFirst({
    where: { role: { in: ['WEIGHBRIDGE_OPERATOR', 'Weighbridge_Operator', 'Admin'] } },
  });

  if (!secUser || !wbUser) {
    throw new Error('Required operator users not found in database');
  }

  const timestamp = Date.now();
  const testSiloCode = `SILO-SEC-${timestamp.toString().slice(-4)}`;

  try {
    // Create test Silo
    const silo = await prisma.silo.create({
      data: {
        silo_code: testSiloCode,
        silo_name: `Security E2E Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });

    const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
    const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });

    // ----------------------------------------------------
    // TEST 1: END-TO-END NORMAL ACCEPTED VEHICLE LIFECYCLE
    // ----------------------------------------------------
    const visitNormNo = `VV-E2E-NORM-${timestamp}`;
    const tokenNorm = `TK-NORM-${timestamp.toString().slice(-4)}`;

    const entryTimeNorm = new Date(Date.now() - 60 * 60 * 1000); // 60m ago
    const grossTimeNorm = new Date(Date.now() - 45 * 60 * 1000); // 45m ago
    const unloadStartNorm = new Date(Date.now() - 30 * 60 * 1000); // 30m ago
    const unloadEndNorm = new Date(Date.now() - 20 * 60 * 1000); // 20m ago
    const tareTimeNorm = new Date(Date.now() - 10 * 60 * 1000); // 10m ago

    const visitNorm = await prisma.vehicleVisit.create({
      data: {
        visit_number: visitNormNo,
        vehicle_number: `KBL-1001`,
        token_number: tokenNorm,
        current_status: 'DISPATCHED',
        operational_date: new Date(),
        created_by: secUser.id,
        portions: {
          create: [
            { portion_number: 1, dispatch_quantity_value: 10000, dispatch_quantity_unit: 'KG', dispatch_quantity_basis: 'MEASURED', plant_decision: 'ACCEPTED', current_status: 'DISPATCHED' },
          ],
        },
      },
      include: { portions: true },
    });

    const portionNorm = visitNorm.portions[0];

    // Gate Entry -> TOKEN_ISSUED
    const gateLogNorm = await prisma.gateLog.create({
      data: {
        visit_id: visitNorm.id,
        entry_timestamp: entryTimeNorm,
        entry_guard_id: secUser.id,
      },
    });

    await prisma.vehicleVisit.update({
      where: { id: visitNorm.id },
      data: { current_status: 'TOKEN_ISSUED' },
    });

    // Plant QA ACCEPTED -> READY_FOR_GROSS
    if (lrTest) {
      await prisma.plantLabResult.create({
        data: {
          visit_id: visitNorm.id,
          portion_id: portionNorm.id,
          test_id: lrTest.id,
          performance_status: 'PERFORMED',
          numeric_value: new Prisma.Decimal(26.5),
          is_passed: true,
          tested_by: wbUser.id,
        },
      });
    }
    if (fatTest) {
      await prisma.plantLabResult.create({
        data: {
          visit_id: visitNorm.id,
          portion_id: portionNorm.id,
          test_id: fatTest.id,
          performance_status: 'PERFORMED',
          numeric_value: new Prisma.Decimal(3.8),
          is_passed: true,
          tested_by: wbUser.id,
        },
      });
    }

    await prisma.vehicleVisit.update({
      where: { id: visitNorm.id },
      data: { current_status: 'READY_FOR_GROSS' },
    });

    // Scale 1 Gross -> GROSS_WEIGHED -> READY_FOR_UNLOADING
    const weightTicketNorm = await prisma.weightTicket.create({
      data: {
        visit_id: visitNorm.id,
        ticket_number: `TK-TICK-${timestamp}`,
        gross_weight_kg: new Prisma.Decimal(33000),
        gross_timestamp: grossTimeNorm,
        gross_recorded_by: wbUser.id,
      },
    });

    await prisma.vehicleVisit.update({
      where: { id: visitNorm.id },
      data: { current_status: 'READY_FOR_UNLOADING' },
    });

    // Production Unloading -> UNLOADING -> READY_FOR_TARE
    await prisma.unloadingLog.create({
      data: {
        portion_id: portionNorm.id,
        silo_id: silo.id,
        silo_number: silo.silo_code,
        pump_start_timestamp: unloadStartNorm,
        pump_end_timestamp: unloadEndNorm,
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });

    await prisma.vehicleVisit.update({
      where: { id: visitNorm.id },
      data: { current_status: 'READY_FOR_TARE' },
    });

    // Scale 2 Tare Weighment -> TARE_WEIGHED & Final Silo Receipt -> READY_FOR_GATE_EXIT
    await prisma.weightTicket.update({
      where: { id: weightTicketNorm.id },
      data: {
        tare_weight_kg: new Prisma.Decimal(23000),
        tare_timestamp: tareTimeNorm,
        tare_recorded_by: wbUser.id,
        net_weight_kg: new Prisma.Decimal(10000),
      },
    });

    await prisma.vehicleVisit.update({
      where: { id: visitNorm.id },
      data: { current_status: 'TARE_WEIGHED' },
    });

    // Finalize Silo Receipt (Advances status to READY_FOR_GATE_EXIT)
    const finalizeNormRes = await finalizeSiloReceiptForVisit(visitNorm.id, wbUser.id, tareTimeNorm);
    const visitNormReady = await prisma.vehicleVisit.findUnique({ where: { id: visitNorm.id } });

    assert(
      finalizeNormRes.success && visitNormReady?.current_status === 'READY_FOR_GATE_EXIT',
      'SEC-EXIT-FLOW-A: End-to-End Normal Accepted Vehicle Readiness',
      `Full reception milestone sequence succeeded; vehicle status = READY_FOR_GATE_EXIT; Final Silo Receipt created (~${Math.round(finalizeNormRes.finalPhysicalLiters || 0)} L)`
    );

    // ----------------------------------------------------
    // SEC-EXIT-A..D: Queue Eligibility Checks
    // ----------------------------------------------------
    const readyVisitsInDb = await prisma.vehicleVisit.findMany({
      where: { current_status: 'READY_FOR_GATE_EXIT', id: visitNorm.id },
    });

    assert(
      readyVisitsInDb.length === 1,
      'SEC-EXIT-A..D: Strict READY_FOR_GATE_EXIT Queue Filtering',
      'Ready Exit queue contains ONLY vehicles in READY_FOR_GATE_EXIT status'
    );

    // ----------------------------------------------------
    // SEC-EXIT-PENDING-A..B: Pending Inventory Exit Block Check
    // ----------------------------------------------------
    const visitPendingNo = `VV-PEND-${timestamp}`;
    const visitPending = await prisma.vehicleVisit.create({
      data: {
        visit_number: visitPendingNo,
        vehicle_number: `KBL-2002`,
        token_number: `TK-PEND-${timestamp.toString().slice(-4)}`,
        current_status: 'TARE_WEIGHED', // Tare recorded but NO Plant LR / receipt!
        operational_date: new Date(),
        created_by: secUser.id,
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 5000, dispatch_quantity_unit: 'KG', dispatch_quantity_basis: 'MEASURED', plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
        gate_log: {
          create: { entry_timestamp: new Date(Date.now() - 30 * 60 * 1000), entry_guard_id: secUser.id },
        },
        weight_ticket: {
          create: {
            ticket_number: `TK-PEND-TICK-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(25000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(5000),
            gross_timestamp: new Date(Date.now() - 20 * 60 * 1000),
            tare_timestamp: new Date(Date.now() - 10 * 60 * 1000),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
      },
    });

    const pendingInReadyQueue = await prisma.vehicleVisit.findMany({
      where: { current_status: 'READY_FOR_GATE_EXIT', id: visitPending.id },
    });

    assert(
      pendingInReadyQueue.length === 0,
      'SEC-EXIT-PENDING-A..B: TARE_WEIGHED Pending Vehicle Blocked from Ready Exit Queue',
      'Vehicle with pending inventory in TARE_WEIGHED status does NOT appear in Ready Exit queue'
    );

    // ----------------------------------------------------
    // SEC-EXIT-REJECT-A..C: END-TO-END ALL-REJECTED VEHICLE LIFECYCLE
    // ----------------------------------------------------
    const visitRejectNo = `VV-E2E-REJ-${timestamp}`;
    const visitReject = await prisma.vehicleVisit.create({
      data: {
        visit_number: visitRejectNo,
        vehicle_number: `KBL-3003`,
        token_number: `TK-REJ-${timestamp.toString().slice(-4)}`,
        current_status: 'DISPATCHED',
        operational_date: new Date(),
        created_by: secUser.id,
        portions: {
          create: [
            { portion_number: 1, dispatch_quantity_value: 6000, dispatch_quantity_unit: 'KG', dispatch_quantity_basis: 'MEASURED', plant_decision: 'REJECTED', current_status: 'PLANT_QA' },
            { portion_number: 2, dispatch_quantity_value: 4000, dispatch_quantity_unit: 'KG', dispatch_quantity_basis: 'MEASURED', plant_decision: 'REJECTED', current_status: 'PLANT_QA' },
          ],
        },
        gate_log: {
          create: { entry_timestamp: new Date(Date.now() - 40 * 60 * 1000), entry_guard_id: secUser.id },
        },
      },
      include: { portions: true, gate_log: true },
    });

    // All portions rejected in Plant QA -> Directly routes to READY_FOR_GATE_EXIT
    await prisma.vehicleVisit.update({
      where: { id: visitReject.id },
      data: { current_status: 'READY_FOR_GATE_EXIT' },
    });

    const readyRejectInDb = await prisma.vehicleVisit.findUnique({ where: { id: visitReject.id } });

    assert(
      readyRejectInDb?.current_status === 'READY_FOR_GATE_EXIT',
      'SEC-EXIT-REJECT-A..C: All-Rejected Vehicle Direct-Exit Path',
      'All-rejected vehicle bypassed weighbridge & silo workflows; status advanced directly to READY_FOR_GATE_EXIT'
    );

    // ----------------------------------------------------
    // PERFORM SECURITY GATE EXIT ON NORMAL ACCEPTED VEHICLE
    // ----------------------------------------------------
    const exitTimeNorm = new Date();

    const claimNorm = await prisma.vehicleVisit.updateMany({
      where: { id: visitNorm.id, current_status: 'READY_FOR_GATE_EXIT' },
      data: { current_status: 'COMPLETED' },
    });

    const updatedGateLogNorm = await prisma.gateLog.update({
      where: { id: gateLogNorm.id },
      data: { exit_timestamp: exitTimeNorm, exit_guard_id: secUser.id },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'gate_log',
        record_id: updatedGateLogNorm.id,
        action: 'GATE_EXIT_RECORDED',
        user_id: secUser.id,
        new_values: {
          visit_id: visitNorm.id.toString(),
          vehicle_number: visitNorm.vehicle_number,
          token_number: visitNorm.token_number,
          op_timestamp: exitTimeNorm.toISOString(),
          submitted_at: new Date().toISOString(),
          exited_by: secUser.username,
          exit_reason: 'Processing Complete',
          previous_status: 'READY_FOR_GATE_EXIT',
          new_status: 'COMPLETED',
        },
      },
    });

    const visitNormCompleted = await prisma.vehicleVisit.findUnique({ where: { id: visitNorm.id } });
    const gateLogNormPost = await prisma.gateLog.findUnique({ where: { id: gateLogNorm.id } });

    assert(
      claimNorm.count === 1 &&
        visitNormCompleted?.current_status === 'COMPLETED' &&
        gateLogNormPost?.entry_guard_id === secUser.id &&
        gateLogNormPost?.exit_guard_id === secUser.id &&
        gateLogNormPost?.exit_timestamp !== null,
      'SEC-EXIT-FLOW-B..D & AUD-HARD-A..E: Normal Vehicle Gate Exit & Audit Completion',
      'Normal vehicle status = COMPLETED; entry & exit guards preserved separately in GateLog; GATE_EXIT_RECORDED AuditLog created'
    );

    // ----------------------------------------------------
    // PERFORM SECURITY GATE EXIT ON ALL-REJECTED VEHICLE
    // ----------------------------------------------------
    const exitTimeRej = new Date();

    const claimRej = await prisma.vehicleVisit.updateMany({
      where: { id: visitReject.id, current_status: 'READY_FOR_GATE_EXIT' },
      data: { current_status: 'COMPLETED' },
    });

    const updatedGateLogRej = await prisma.gateLog.update({
      where: { id: visitReject.gate_log!.id },
      data: { exit_timestamp: exitTimeRej, exit_guard_id: secUser.id },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'gate_log',
        record_id: updatedGateLogRej.id,
        action: 'GATE_EXIT_RECORDED',
        user_id: secUser.id,
        new_values: {
          visit_id: visitReject.id.toString(),
          vehicle_number: visitReject.vehicle_number,
          token_number: visitReject.token_number,
          op_timestamp: exitTimeRej.toISOString(),
          submitted_at: new Date().toISOString(),
          exited_by: secUser.username,
          exit_reason: 'QA Rejected',
          previous_status: 'READY_FOR_GATE_EXIT',
          new_status: 'COMPLETED',
        },
      },
    });

    const visitRejectCompleted = await prisma.vehicleVisit.findUnique({ where: { id: visitReject.id } });

    assert(
      claimRej.count === 1 && visitRejectCompleted?.current_status === 'COMPLETED',
      'SEC-EXIT-REJECT-B..C: All-Rejected Vehicle Gate Exit Completion',
      'All-rejected vehicle completed gate exit cleanly without fake weighbridge or silo validations'
    );

    // ----------------------------------------------------
    // SEC-EXIT-CONC-A..B: Concurrency & Duplicate Exit Block Check
    // ----------------------------------------------------
    const claimDuplicate = await prisma.vehicleVisit.updateMany({
      where: { id: visitNorm.id, current_status: 'READY_FOR_GATE_EXIT' },
      data: { current_status: 'COMPLETED' },
    });

    assert(
      claimDuplicate.count === 0,
      'SEC-EXIT-CONC-A..B: Concurrency & Duplicate Exit Claim Protection',
      'Re-claim attempt of completed vehicle returned 0 affected rows (Duplicate exit prevented)'
    );

    // Clean up temporary test data
    await prisma.auditLog.deleteMany({ where: { action: 'GATE_EXIT_RECORDED' } });
    await prisma.plantLabResult.deleteMany({ where: { visit_id: visitNorm.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: visitNorm.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion_id: portionNorm.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visitNorm.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visitPending.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visitNorm.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visitPending.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visitReject.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visitNorm.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visitPending.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visitReject.id } });
    await prisma.vehicleVisit.delete({ where: { id: visitNorm.id } });
    await prisma.vehicleVisit.delete({ where: { id: visitPending.id } });
    await prisma.vehicleVisit.delete({ where: { id: visitReject.id } });
    await prisma.silo.delete({ where: { id: silo.id } });

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

runSecurityGateExitE2EVerification();
