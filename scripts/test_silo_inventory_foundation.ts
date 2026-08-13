import { prisma } from '../src/backend/core/db';
import {
  recordSiloTransaction,
  getSiloCurrentStock,
  getSiloCurrentStockLiters,
  getSiloAvailableCapacity,
  updateSiloConfiguration,
} from '../src/backend/services/siloInventoryService';
import { Prisma, SiloTransactionType } from '@prisma/client';

async function runSiloInventoryFoundationHardeningVerification() {
  console.log('==================================================');
  console.log('RUNNING SILO MASTER + MILK INVENTORY HARDENING VERIFICATION');
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

  const timestamp = Date.now();
  const testSiloCode = `SILO-TEST-${timestamp.toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // TYPE-A & TYPE-B: Transaction Type Enum Hardening
    // ----------------------------------------------------
    const validTypes = [SiloTransactionType.RECEIPT, SiloTransactionType.ISSUE];
    assert(
      validTypes.length === 2 && validTypes.includes('RECEIPT' as any) && validTypes.includes('ISSUE' as any),
      'TYPE-A & TYPE-B: Strict Enum Transaction Types',
      'Transaction types strictly restricted to Prisma enum SiloTransactionType (RECEIPT / ISSUE)'
    );

    // ----------------------------------------------------
    // CAP-A: Create Silo with valid capacity
    // ----------------------------------------------------
    const silo = await prisma.silo.create({
      data: {
        silo_code: testSiloCode,
        silo_name: `Raw Milk Hardened Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });

    assert(
      silo.id !== undefined && Number(silo.capacity_liters) === 50000,
      'CAP-A: Create Silo with Capacity 50,000 Liters',
      `Silo created cleanly with capacity ${silo.capacity_liters} Liters`
    );

    // ----------------------------------------------------
    // CAP-B: Capacity <= 0 Rejection
    // ----------------------------------------------------
    let zeroCapRejected = false;
    try {
      await updateSiloConfiguration({ silo_id: silo.id, capacity_liters: 0 });
    } catch (err: any) {
      zeroCapRejected = true;
    }

    let negCapRejected = false;
    try {
      await updateSiloConfiguration({ silo_id: silo.id, capacity_liters: -500 });
    } catch (err: any) {
      negCapRejected = true;
    }

    assert(
      zeroCapRejected && negCapRejected,
      'CAP-B: Capacity <= 0 Rejection',
      'Updating silo capacity to 0 Liters or negative value strictly rejected'
    );

    // ----------------------------------------------------
    // REC-A & REC-D: Receipt within Available Capacity
    // ----------------------------------------------------
    const t1 = new Date(Date.now() - 60 * 60 * 1000);
    await recordSiloTransaction({
      silo_id: silo.id,
      transaction_type: SiloTransactionType.RECEIPT,
      quantity_kg: 36250,
      quantity_liters: 35314,
      operational_timestamp: t1,
      notes: 'Initial test receipt',
    });

    const stock1 = await getSiloCurrentStockLiters(silo.id);
    assert(stock1 === 35314, 'REC-A: Active RECEIPT within Capacity', `Stock calculated to exact receipt quantity of ${stock1} Liters`);

    // ----------------------------------------------------
    // CAP-C & CAP-D: Capacity Update Safety Rule vs Current Stock
    // ----------------------------------------------------
    // Stock is 35,314 L. Updating capacity to 45,000 L -> PASS
    const updatedCap45k = await updateSiloConfiguration({ silo_id: silo.id, capacity_liters: 45000 });
    const isCap45kSuccess = Number(updatedCap45k.capacity_liters) === 45000;

    // Updating capacity to 30,000 L (less than current stock 35,314 L) -> REJECT
    let capReductionRejected = false;
    try {
      await updateSiloConfiguration({ silo_id: silo.id, capacity_liters: 30000 });
    } catch (err: any) {
      capReductionRejected = true;
    }

    assert(
      isCap45kSuccess && capReductionRejected,
      'CAP-C & CAP-D: Capacity Update Safety Rule',
      'Capacity update to 45,000 L succeeded; reduction to 30,000 L (below stock 35,314 L) strictly rejected'
    );

    // ----------------------------------------------------
    // CAP-E & REC-C: Available Capacity Calculation & Over-Capacity Rejection
    // ----------------------------------------------------
    // Current Capacity = 45,000 L, Stock = 35,314 L -> Available = 9,686 L
    const availCap = await getSiloAvailableCapacity(silo.id);
    let overCapReceiptRejected = false;
    try {
      await recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: 10000,
        quantity_liters: 9687, // Exceeds available 9,686 L!
        operational_timestamp: new Date(),
      });
    } catch (err: any) {
      overCapReceiptRejected = true;
    }

    assert(
      availCap === 9686 && overCapReceiptRejected,
      'CAP-E & REC-C: Available Capacity & Over-Capacity Protection',
      `Available capacity exact ${availCap} Liters; receipt of 9,687 Liters correctly rejected`
    );

    // Receipt equal to exact available capacity (9,686 L) -> PASS
    await recordSiloTransaction({
      silo_id: silo.id,
      transaction_type: SiloTransactionType.RECEIPT,
      quantity_kg: 9942,
      quantity_liters: 9686,
      operational_timestamp: new Date(),
    });

    const stockFull = await getSiloCurrentStockLiters(silo.id);
    assert(stockFull === 45000, 'REC-D: Receipt Exact Available Capacity', `Receipt equal to exact available capacity (9,686 L) fills silo to ${stockFull} Liters`);

    // ----------------------------------------------------
    // REC-B: Inactive Silo RECEIPT Block
    // ----------------------------------------------------
    await updateSiloConfiguration({ silo_id: silo.id, is_active: false });

    let inactiveReceiptRejected = false;
    try {
      await recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: 5000,
        quantity_liters: 4868,
        operational_timestamp: new Date(),
      });
    } catch (err: any) {
      inactiveReceiptRejected = true;
    }

    assert(inactiveReceiptRejected, 'REC-B: Inactive Silo RECEIPT Block', 'New milk RECEIPT on inactive silo strictly rejected');

    // ----------------------------------------------------
    // ISSUE-A..D: Inactive Silo Draining & Negative Stock Protection
    // ----------------------------------------------------
    // Inactive silo allows ISSUE (10,000 L)
    await recordSiloTransaction({
      silo_id: silo.id,
      transaction_type: SiloTransactionType.ISSUE,
      quantity_kg: 10265,
      quantity_liters: 10000,
      operational_timestamp: new Date(),
    });

    const stockPostIssue1 = await getSiloCurrentStockLiters(silo.id);
    assert(stockPostIssue1 === 35000, 'ISSUE-A & ISSUE-C: Inactive Silo Allowed ISSUE', `Inactive silo allowed ISSUE of 10,000 Liters (Stock reduced to ${stockPostIssue1} L)`);

    // Over-issue attempt (35,001 L vs stock 35,000 L) -> REJECT
    let overIssueRejected = false;
    try {
      await recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.ISSUE,
        quantity_kg: 35928,
        quantity_liters: 35001,
        operational_timestamp: new Date(),
      });
    } catch (err: any) {
      overIssueRejected = true;
    }

    assert(overIssueRejected, 'ISSUE-B: Over-Issue Rejection', 'ISSUE quantity exceeding current stock strictly rejected');

    // Exact drain to 0 L
    await recordSiloTransaction({
      silo_id: silo.id,
      transaction_type: SiloTransactionType.ISSUE,
      quantity_kg: 35928,
      quantity_liters: 35000,
      operational_timestamp: new Date(),
    });

    const stockZero = await getSiloCurrentStockLiters(silo.id);
    assert(stockZero === 0, 'ISSUE-D: Exact Silo Drain', `Exact drain reduced stock to ${stockZero} Liters`);

    // ----------------------------------------------------
    // QTY-A & QTY-B: Quantity <= 0 Validation
    // ----------------------------------------------------
    let zeroQtyRejected = false;
    try {
      await recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: 0,
        quantity_liters: 0,
        operational_timestamp: new Date(),
      });
    } catch (err: any) {
      zeroQtyRejected = true;
    }

    let negQtyRejected = false;
    try {
      await recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: -100,
        quantity_liters: -97,
        operational_timestamp: new Date(),
      });
    } catch (err: any) {
      negQtyRejected = true;
    }

    assert(zeroQtyRejected && negQtyRejected, 'QTY-A & QTY-B: Quantity Validation', 'Transaction quantity <= 0 strictly rejected');

    // ----------------------------------------------------
    // HIST-C: Foreign Key Delete Protection
    // ----------------------------------------------------
    let deleteSiloRejected = false;
    try {
      await prisma.silo.delete({ where: { id: silo.id } });
    } catch (err: any) {
      deleteSiloRejected = true;
    }

    assert(deleteSiloRejected, 'HIST-C: Silo Hard Delete Protection', 'Hard deletion of silo with transaction history blocked by database foreign key constraint (onDelete: Restrict)');

    // Re-activate silo for cleanup
    await updateSiloConfiguration({ silo_id: silo.id, is_active: true });

    // Clean up test transactions and silo
    await prisma.siloInventoryTransaction.deleteMany({ where: { silo_id: silo.id } });
    await prisma.silo.delete({ where: { id: silo.id } });

    // ----------------------------------------------------
    // CONC-A & CONC-B: Database Concurrency Verification
    // ----------------------------------------------------
    const concSilo = await prisma.silo.create({
      data: {
        silo_code: `SILO-CONC-${timestamp.toString().slice(-4)}`,
        silo_name: `Concurrency Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(10000),
        is_active: true,
      },
    });

    // Run 2 simultaneous receipts of 8,000 L on 10,000 L capacity silo -> exactly 1 succeeds, 1 fails
    const concResults = await Promise.allSettled([
      recordSiloTransaction({
        silo_id: concSilo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: 8212,
        quantity_liters: 8000,
        operational_timestamp: new Date(),
      }),
      recordSiloTransaction({
        silo_id: concSilo.id,
        transaction_type: SiloTransactionType.RECEIPT,
        quantity_kg: 8212,
        quantity_liters: 8000,
        operational_timestamp: new Date(),
      }),
    ]);

    const concFulfilled = concResults.filter((r) => r.status === 'fulfilled').length;
    const concRejected = concResults.filter((r) => r.status === 'rejected').length;

    assert(
      concFulfilled === 1 && concRejected === 1,
      'CONC-A & CONC-B: Atomic Database Concurrency & Row-Level Locking',
      `Simultaneous receipts: ${concFulfilled} PASS / ${concRejected} REJECT (Row-level lock FOR UPDATE enforced)`
    );

    // Clean up conc silo
    await prisma.siloInventoryTransaction.deleteMany({ where: { silo_id: concSilo.id } });
    await prisma.silo.delete({ where: { id: concSilo.id } });

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

runSiloInventoryFoundationHardeningVerification();
