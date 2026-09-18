// 1. Initialize test environment FIRST before importing app modules or database clients
import '../tests/helpers/testEnv';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { getTestPrisma, disconnectTestPrisma } from '../tests/helpers/testPrisma';
import { Prisma, SiloTransactionType } from '@prisma/client';
import { finalizeSiloReceiptForVisit } from '../src/backend/services/siloInventoryService';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function main() {
  console.log('==================================================');
  console.log('STAGE 6G-F: FINAL RECEIPT CONCURRENCY & IDEMPOTENCY');
  console.log('==================================================\n');

  // 1. Enforce Test Database Safety Guard (fail-closed)
  const { testDbName, isSafe } = assertSafeTestDatabase({ isDestructive: true });
  assert(isSafe, 'Test DB safety assertion failed');
  console.log(`[SAFETY CHECK] Connected strictly to isolated test database: "${testDbName}".\n`);

  const prisma = getTestPrisma();

  // 2. Resolve Prerequisites in Test Database
  let silo = await prisma.silo.findFirst({ where: { is_active: true } });
  let createdSilo = false;
  if (!silo) {
    silo = await prisma.silo.create({
      data: {
        silo_code: 'SILO-TEST-01',
        silo_name: 'Test Concurrency Silo',
        capacity_liters: new Prisma.Decimal(50000),
        is_active: true,
      },
    });
    createdSilo = true;
  }

  const user = await prisma.user.findFirst({ where: { is_active: true } });
  assert(user, 'Active user must exist in test database for concurrency verification');

  const source = await prisma.procurementSource.findFirst({ where: { is_active: true } });
  assert(source, 'Active procurement source required in test database');

  const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
  assert(lrTest, 'Authoritative Plant LR test (LT-000008) must exist in test database');

  const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });
  assert(fatTest, 'Authoritative Plant Fat test (LT-000026) must exist in test database');

  // 3. Create Isolated Test Fixtures for Vehicle Visit
  const uniqueKey = `CONC_6GF_${Date.now()}`;
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VN_${uniqueKey}`,
      vehicle_number: `VEH_${uniqueKey}`,
      token_number: `TK_${uniqueKey}`,
      procurement_source_id: source.id,
      current_status: 'TARE_WEIGHED',
      vehicle_dispatch_gross_liters: new Prisma.Decimal(10000.0),
      vehicle_dispatch_at_13ts_liters: new Prisma.Decimal(9500.0),
    },
  });

  const portion = await prisma.visitPortion.create({
    data: {
      visit_id: visit.id,
      portion_number: 1,
      plant_decision: 'ACCEPTED',
    },
  });

  await prisma.plantLabResult.createMany({
    data: [
      {
        visit_id: visit.id,
        portion_id: portion.id,
        test_id: lrTest.id,
        numeric_value: new Prisma.Decimal(28.0),
        performance_status: 'PERFORMED',
        is_passed: true,
        tested_by: user.id,
      },
      {
        visit_id: visit.id,
        portion_id: portion.id,
        test_id: fatTest.id,
        numeric_value: new Prisma.Decimal(3.8),
        performance_status: 'PERFORMED',
        is_passed: true,
        tested_by: user.id,
      },
    ],
  });

  await prisma.unloadingLog.create({
    data: {
      portion_id: portion.id,
      silo_id: silo.id,
      silo_number: silo.silo_code,
      pump_start_timestamp: new Date(),
      pump_end_timestamp: new Date(),
      started_by: user.id,
      completed_by: user.id,
    },
  });

  await prisma.weightTicket.create({
    data: {
      visit_id: visit.id,
      ticket_number: `WT_${uniqueKey}`,
      gross_weight_kg: 25000,
      tare_weight_kg: 15000,
      net_weight_kg: 10000,
      gross_timestamp: new Date(),
      tare_timestamp: new Date(),
      gross_recorded_by: user.id,
      tare_recorded_by: user.id,
    },
  });

  try {
    const preTxCount = await prisma.siloInventoryTransaction.count({
      where: { silo_id: silo.id, transaction_type: SiloTransactionType.RECEIPT },
    });

    console.log(`Executing 2 simultaneous finalizeSiloReceiptForVisit calls for visit #${visit.id}...`);
    const [rec1, rec2] = await Promise.allSettled([
      finalizeSiloReceiptForVisit(visit.id, user.id),
      finalizeSiloReceiptForVisit(visit.id, user.id),
    ]);

    // Assertion 1: Both calls must complete safely without uncaught unique-constraint errors
    assert(rec1.status === 'fulfilled', `Call 1 rejected: ${(rec1 as any).reason}`);
    assert(rec2.status === 'fulfilled', `Call 2 rejected: ${(rec2 as any).reason}`);

    const resVal1 = (rec1 as PromiseFulfilledResult<any>).value;
    const resVal2 = (rec2 as PromiseFulfilledResult<any>).value;

    assert(resVal1.success === true, `Call 1 failed: ${resVal1.message}`);
    assert(resVal2.success === true, `Call 2 failed: ${resVal2.message}`);

    // Assertion 2: Exactly one call creates receipt, losing replay call reports alreadyFinalized: true
    const createdCount = (resVal1.receiptCreated ? 1 : 0) + (resVal2.receiptCreated ? 1 : 0);
    assert(createdCount === 1, `Expected exactly 1 call to report receiptCreated: true, got ${createdCount}`);

    const winner = resVal1.receiptCreated ? resVal1 : resVal2;
    const replay = resVal1.receiptCreated ? resVal2 : resVal1;

    assert(winner.receiptCreated === true, 'Winner must have receiptCreated: true');
    assert(replay.receiptCreated === false, 'Replay must have receiptCreated: false');
    assert(replay.alreadyFinalized === true, 'Replay must report alreadyFinalized: true');
    assert(replay.isHistorical === false, 'Fresh receipt must not be marked isHistorical');

    // Assertion 3: Exactly one SiloInventoryTransaction RECEIPT created
    const receiptTxs = await prisma.siloInventoryTransaction.findMany({
      where: { visit_id: visit.id, transaction_type: SiloTransactionType.RECEIPT },
    });
    assert(receiptTxs.length === 1, `Expected exactly 1 SiloInventoryTransaction RECEIPT, found ${receiptTxs.length}`);

    // Assertion 4: Exactly one PlantFinalDualReconciliation record created
    const reconRows = await prisma.plantFinalDualReconciliation.findMany({
      where: { visit_id: visit.id },
    });
    assert(reconRows.length === 1, `Expected exactly 1 PlantFinalDualReconciliation row, found ${reconRows.length}`);

    // Assertion 5: Silo stock movement occurred exactly once
    const postTxCount = await prisma.siloInventoryTransaction.count({
      where: { silo_id: silo.id, transaction_type: SiloTransactionType.RECEIPT },
    });
    assert(
      postTxCount === preTxCount + 1,
      `Expected silo receipts to increase by 1, but changed from ${preTxCount} to ${postTxCount}`
    );

    // Assertion 6: Frozen Plant snapshot fields on receipt are fully populated
    const receipt = receiptTxs[0];
    assert(receipt.plant_composite_lr !== null, 'plant_composite_lr must be populated');
    assert(receipt.plant_composite_fat !== null, 'plant_composite_fat must be populated');
    assert(receipt.plant_density !== null, 'plant_density must be populated');
    assert(receipt.plant_snf !== null, 'plant_snf must be populated');
    assert(receipt.plant_ts !== null, 'plant_ts must be populated');
    assert(receipt.plant_final_at_13ts_liters !== null, 'plant_final_at_13ts_liters must be populated');
    assert(receipt.plant_calculation_version === '1.0', 'plant_calculation_version must be 1.0');

    // Assertion 7: Dual reconciliation audit fields are fully populated
    const recon = reconRows[0];
    assert(recon.final_receipt_transaction_id === receipt.id, 'Dual reconciliation must link to receipt ID');
    assert(Number(recon.sent_gross_liters) === 10000, `sent_gross_liters expected 10000, got ${recon.sent_gross_liters}`);
    assert(
      Number(recon.received_gross_liters) === Number(receipt.quantity_liters),
      'received_gross_liters must match receipt quantity_liters'
    );
    assert(Number(recon.sent_at_13ts_liters) === 9500, `sent_at_13ts_liters expected 9500, got ${recon.sent_at_13ts_liters}`);
    assert(
      Number(recon.received_at_13ts_liters) === Number(receipt.plant_final_at_13ts_liters),
      'received_at_13ts_liters must match receipt plant_final_at_13ts_liters'
    );
    assert(recon.gross_variance_liters !== null, 'gross_variance_liters must be non-null');
    assert(recon.gross_variance_percent !== null, 'gross_variance_percent must be non-null');
    assert(recon.at_13ts_variance_liters !== null, 'at_13ts_variance_liters must be non-null');
    assert(recon.at_13ts_variance_percent !== null, 'at_13ts_variance_percent must be non-null');
    assert(recon.reconciliation_calculation_version === '1.0', 'reconciliation_calculation_version must be 1.0');

    console.log('[PASS] Both concurrent finalization calls completed safely without unique-constraint errors.');
    console.log(`[PASS] Exactly 1 SiloInventoryTransaction created (id: ${receipt.id}, volume: ${receipt.quantity_liters} L).`);
    console.log(`[PASS] Exactly 1 PlantFinalDualReconciliation created (gross diff: ${recon.gross_variance_liters} L, @13TS diff: ${recon.at_13ts_variance_liters} L).`);
    console.log('[PASS] Winner reported receiptCreated: true; concurrent call reported alreadyFinalized: true.');
    console.log('[PASS] Silo stock movement occurred exactly once.');
    console.log('[PASS] Frozen Plant snapshot and dual reconciliation fields are fully populated.');
  } finally {
    // Reverse foreign-key cleanup of isolated test visit data
    await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: visit.id } });
    await prisma.auditLog.deleteMany({ where: { record_id: visit.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: visit.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visit.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion_id: portion.id } });
    await prisma.plantLabResult.deleteMany({ where: { portion_id: portion.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.deleteMany({ where: { id: visit.id } });

    if (createdSilo) {
      await prisma.silo.deleteMany({ where: { id: silo.id } });
    }

    console.log(`[CLEANUP] Isolated test data for visit #${visit.id} successfully removed.`);
  }

  console.log('\n==================================================');
  console.log('FINAL RECEIPT CONCURRENCY VERIFICATION: ALL ASSERTIONS PASSED');
  console.log('==================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ CONCURRENCY VERIFICATION FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectTestPrisma();
  });
