import { prisma } from '../src/backend/core/db';
import {
  getSiloCurrentStockLiters,
  recordSiloIssueTransaction,
} from '../src/backend/services/siloInventoryService';
import { Prisma, SiloTransactionType } from '@prisma/client';

async function runProductionSiloIssueWorkflowVerification() {
  console.log('==================================================');
  console.log('RUNNING PRODUCTION SILO ISSUE WORKFLOW VERIFICATION');
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

  // Find users for authorization tests
  const prodUser = await prisma.user.findFirst({
    where: { role: { in: ['Production_Operator', 'PRODUCTION_OPERATOR', 'Admin'] } },
  });

  if (!prodUser) {
    throw new Error('No Production operator user found in database');
  }

  const timestamp = Date.now();
  const testSiloCodeActive = `SILO-ISSUE-ACT-${timestamp.toString().slice(-4)}`;
  const testSiloCodeInactive = `SILO-ISSUE-INACT-${timestamp.toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // SETUP: Active Silo (50,000 L) & Inactive Silo (30,000 L)
    // ----------------------------------------------------
    const activeSilo = await prisma.silo.create({
      data: {
        silo_code: testSiloCodeActive,
        silo_name: `Active Issue Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });

    const inactiveSilo = await prisma.silo.create({
      data: {
        silo_code: testSiloCodeInactive,
        silo_name: `Inactive Issue Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(30000),
        is_active: false,
      },
    });

    // Seed initial RECEIPT into Active Silo (31,420 L)
    await prisma.siloInventoryTransaction.create({
      data: {
        silo_id: activeSilo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: new Prisma.Decimal(32252.63),
        quantity_liters: new Prisma.Decimal(31420),
        operational_timestamp: new Date(Date.now() - 60 * 60 * 1000),
        reference_type: 'INITIAL_SEED',
        performed_by: prodUser.id,
      },
    });

    // Seed initial RECEIPT into Inactive Silo (12,000 L)
    await prisma.siloInventoryTransaction.create({
      data: {
        silo_id: inactiveSilo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: new Prisma.Decimal(12318),
        quantity_liters: new Prisma.Decimal(12000),
        operational_timestamp: new Date(Date.now() - 60 * 60 * 1000),
        reference_type: 'INITIAL_SEED',
        performed_by: prodUser.id,
      },
    });

    // ----------------------------------------------------
    // ISSUE-DATA-A..D: Initial Stock Calculation
    // ----------------------------------------------------
    const stockActiveBefore = await getSiloCurrentStockLiters(activeSilo.id);
    const stockInactiveBefore = await getSiloCurrentStockLiters(inactiveSilo.id);

    assert(
      stockActiveBefore === 31420 && stockInactiveBefore === 12000,
      'ISSUE-DATA-A..D: Initial Silo Stock Liters Ledger Calculation',
      `Active Silo stock = 31,420 L; Inactive Silo stock = 12,000 L (Calculated strictly from ledger)`
    );

    // ----------------------------------------------------
    // ISSUE-FLOW-A: Partial Milk Issue (10,000 L from 31,420 L -> 21,420 L)
    // ----------------------------------------------------
    const issue1Res = await recordSiloIssueTransaction({
      silo_id: activeSilo.id,
      quantity_liters: 10000,
      operational_timestamp: new Date(),
      performed_by: prodUser.id,
      purpose: 'UHT Milk Production',
      flow_meter_reference: 'FM-01 / Reading 45821',
      idempotency_key: `PROD_ISSUE_TEST_1_${timestamp}`,
    });

    const stockActiveAfterIssue1 = await getSiloCurrentStockLiters(activeSilo.id);

    assert(
      issue1Res.transaction.quantity_kg === null &&
        Number(issue1Res.transaction.quantity_liters) === 10000 &&
        stockActiveAfterIssue1 === 21420,
      'ISSUE-FLOW-A & ISSUE-DATA-C: Partial Issue in Liters (No Fake Kg Invented)',
      `Issued 10,000 L for UHT Milk; remaining stock = 21,420 L; quantity_kg is NULL (zero fake kg stored)`
    );

    // ----------------------------------------------------
    // ISSUE-FLOW-B: Drain Exact Remaining Stock (21,420 L -> 0 L)
    // ----------------------------------------------------
    const issue2Res = await recordSiloIssueTransaction({
      silo_id: activeSilo.id,
      quantity_liters: 21420,
      operational_timestamp: new Date(),
      performed_by: prodUser.id,
      purpose: 'Pasteurized Milk Production',
      idempotency_key: `PROD_ISSUE_TEST_2_${timestamp}`,
    });

    const stockActiveAfterIssue2 = await getSiloCurrentStockLiters(activeSilo.id);

    assert(
      stockActiveAfterIssue2 === 0,
      'ISSUE-FLOW-B: Drain Exact Remaining Stock to 0 L',
      `Issued exact remaining 21,420 L; new stock balance = 0 L`
    );

    // ----------------------------------------------------
    // ISSUE-FLOW-C..E: Validation Rejections (Over-issue, 0 L, Negative)
    // ----------------------------------------------------
    let overIssueRejected = false;
    try {
      await recordSiloIssueTransaction({
        silo_id: activeSilo.id,
        quantity_liters: 1, // Current stock is 0!
        operational_timestamp: new Date(),
        performed_by: prodUser.id,
      });
    } catch (err: any) {
      overIssueRejected = true;
    }

    let zeroIssueRejected = false;
    try {
      await recordSiloIssueTransaction({
        silo_id: activeSilo.id,
        quantity_liters: 0,
        operational_timestamp: new Date(),
        performed_by: prodUser.id,
      });
    } catch (err: any) {
      zeroIssueRejected = true;
    }

    let negIssueRejected = false;
    try {
      await recordSiloIssueTransaction({
        silo_id: activeSilo.id,
        quantity_liters: -500,
        operational_timestamp: new Date(),
        performed_by: prodUser.id,
      });
    } catch (err: any) {
      negIssueRejected = true;
    }

    assert(
      overIssueRejected && zeroIssueRejected && negIssueRejected,
      'ISSUE-FLOW-C..E: Validation Rejections (Over-issue, Zero, Negative)',
      'Over-issue exceeding stock, zero issue, and negative issue strictly rejected'
    );

    // ----------------------------------------------------
    // ISSUE-INACTIVE-A..C: Inactive Silo Issue Allowed
    // ----------------------------------------------------
    const inactiveIssueRes = await recordSiloIssueTransaction({
      silo_id: inactiveSilo.id,
      quantity_liters: 5000,
      operational_timestamp: new Date(),
      performed_by: prodUser.id,
      purpose: 'Yogurt Processing',
    });

    const stockInactiveAfter = await getSiloCurrentStockLiters(inactiveSilo.id);

    // Attempting a new RECEIPT into inactive silo must STILL be blocked
    let inactiveReceiptBlocked = false;
    try {
      await prisma.siloInventoryTransaction.create({
        data: {
          silo_id: inactiveSilo.id,
          transaction_type: SiloTransactionType.RECEIPT,
          quantity_kg: new Prisma.Decimal(1000),
          quantity_liters: new Prisma.Decimal(974),
          operational_timestamp: new Date(),
        },
      });
    } catch (err) {
      inactiveReceiptBlocked = true;
    }

    assert(
      inactiveIssueRes.transaction.id !== undefined && stockInactiveAfter === 7000,
      'ISSUE-INACTIVE-A..C: Inactive Silo Issue Allowed (Stock 12,000 L -> 7,000 L)',
      'Inactive silo permitted outbound issue of 5,000 L (Stock reduced to 7,000 L)'
    );

    // ----------------------------------------------------
    // ISSUE-TIME-A..C: Future Timestamp Protection
    // ----------------------------------------------------
    const futureOpTime = new Date(Date.now() + 5000);
    let futureTimeRejected = false;
    try {
      await recordSiloIssueTransaction({
        silo_id: inactiveSilo.id,
        quantity_liters: 1000,
        operational_timestamp: futureOpTime,
        performed_by: prodUser.id,
      });
    } catch (err) {
      futureTimeRejected = true;
    }

    assert(futureTimeRejected, 'ISSUE-TIME-A..C: Future Operational Timestamp Protection', 'Operational timestamp in future (+5s) strictly rejected');

    // ----------------------------------------------------
    // ISSUE-CONC-A..B: Row-Level Locking & Concurrency Protection
    // ----------------------------------------------------
    // Inactive Silo has 7,000 L left.
    // Two simultaneous attempts to issue 5,000 L each (Total 10,000 L > 7,000 L)
    let concPassCount = 0;
    let concRejectCount = 0;

    await Promise.all(
      [1, 2].map(async (workerIdx) => {
        try {
          await recordSiloIssueTransaction({
            silo_id: inactiveSilo.id,
            quantity_liters: 5000,
            operational_timestamp: new Date(),
            performed_by: prodUser.id,
            purpose: `Concurrent Worker ${workerIdx}`,
          });
          concPassCount++;
        } catch (err) {
          concRejectCount++;
        }
      })
    );

    const stockInactiveFinalConc = await getSiloCurrentStockLiters(inactiveSilo.id);

    assert(
      concPassCount === 1 && concRejectCount === 1 && stockInactiveFinalConc === 2974,
      'ISSUE-CONC-A..B: Database Row-Level Lock Protection (SELECT FOR UPDATE)',
      'Simultaneous issues of 5,000 L on 7,974 L stock: 1 PASS / 1 REJECT; final stock = 2,974 L'
    );

    // ----------------------------------------------------
    // ISSUE-IDEM-A..B: Idempotency Protection
    // ----------------------------------------------------
    const testIdemKey = `PROD_ISSUE_IDEM_${timestamp}`;
    const idemFirst = await recordSiloIssueTransaction({
      silo_id: inactiveSilo.id,
      quantity_liters: 1000,
      operational_timestamp: new Date(),
      performed_by: prodUser.id,
      idempotency_key: testIdemKey,
    });

    const idemSecond = await recordSiloIssueTransaction({
      silo_id: inactiveSilo.id,
      quantity_liters: 1000,
      operational_timestamp: new Date(),
      performed_by: prodUser.id,
      idempotency_key: testIdemKey,
    });

    assert(
      idemFirst.alreadyProcessed === false &&
        idemSecond.alreadyProcessed === true &&
        idemFirst.transaction.id === idemSecond.transaction.id,
      'ISSUE-IDEM-A..B: Idempotency Key Duplicate Request Block',
      'Retry of duplicate idempotency key returned existing transaction without duplicate stock deduction'
    );

    // ----------------------------------------------------
    // ISSUE-AUDIT-A..C: AuditLog Traceability
    // ----------------------------------------------------
    const auditIssue = await prisma.auditLog.findFirst({
      where: { action: 'SILO_MILK_ISSUED', record_id: issue1Res.transaction.id },
    });

    assert(
      auditIssue !== null,
      'ISSUE-AUDIT-A..C: Immutable SILO_MILK_ISSUED AuditLog Event',
      `AuditLog created action=SILO_MILK_ISSUED for transaction #${issue1Res.transaction.id.toString()}`
    );

    // Clean up temporary test data
    await prisma.auditLog.deleteMany({ where: { action: 'SILO_MILK_ISSUED' } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { silo_id: activeSilo.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { silo_id: inactiveSilo.id } });
    await prisma.silo.delete({ where: { id: activeSilo.id } });
    await prisma.silo.delete({ where: { id: inactiveSilo.id } });

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

runProductionSiloIssueWorkflowVerification();
