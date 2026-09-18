import { PrismaClient, Prisma, SiloTransactionType } from '@prisma/client';
import { recordSiloTransaction, finalizeSiloReceiptForVisit } from '../src/backend/services/siloInventoryService';

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function main() {
  console.log('==================================================');
  console.log('REAL CONCURRENCY & IDEMPOTENCY VERIFICATION');
  console.log('==================================================\n');

  // 1. Silo Issue Idempotency & Retry Test
  console.log('--- Test 1: Silo Issue Idempotency Key (clientRequestId) ---');
  const silo = await prisma.silo.findFirst({ where: { is_active: true } });
  assert(silo, 'Active silo must exist for concurrency verification');

  const user = await prisma.user.findFirst({ where: { is_active: true } });
  assert(user, 'Active user must exist for concurrency verification');

  const clientReqId = `CONC-ISSUE-${Date.now()}`;
  const opTs = new Date();

  try {
    const [issueRes1, issueRes2] = await Promise.allSettled([
      recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.ISSUE,
        quantity_kg: 100,
        quantity_liters: 100,
        operational_timestamp: opTs,
        idempotency_key: clientReqId,
        performed_by: user.id,
        notes: 'Concurrency Test Issue',
      }),
      recordSiloTransaction({
        silo_id: silo.id,
        transaction_type: SiloTransactionType.ISSUE,
        quantity_kg: 100,
        quantity_liters: 100,
        operational_timestamp: opTs,
        idempotency_key: clientReqId,
        performed_by: user.id,
        notes: 'Concurrency Test Issue Retry',
      }),
    ]);

    assert(issueRes1.status === 'fulfilled', 'Issue call 1 must be fulfilled');
    assert(issueRes2.status === 'fulfilled', 'Issue call 2 must be fulfilled');

    const issueTxs = await prisma.siloInventoryTransaction.findMany({
      where: { idempotency_key: clientReqId },
    });

    assert(issueTxs.length === 1, `Expected exactly 1 issue transaction, got ${issueTxs.length}`);
    console.log(`[PASS] Submitted 2 simultaneous issue requests with same clientRequestId.`);
    console.log(`[PASS] Resulting DB transactions created: ${issueTxs.length} (Expected exactly 1)`);
  } finally {
    await prisma.siloInventoryTransaction.deleteMany({ where: { idempotency_key: clientReqId } });
  }

  // 2. Final Receipt Real Concurrency & Post-Lock Idempotency Test
  console.log('\n--- Test 2: Real Concurrency & Post-Lock Idempotency for Final Receipt ---');

  const source = await prisma.procurementSource.findFirst({ where: { is_active: true } });
  assert(source, 'Active procurement source required');

  const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
  assert(lrTest, 'Authoritative Plant LR test (LT-000008) must exist');

  const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });
  assert(fatTest, 'Authoritative Plant Fat test (LT-000026) must exist');

  const uniqueKey = `CONC_${Date.now()}`;
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

    console.log(`Executing 2 concurrent finalizeSiloReceiptForVisit calls for isolated visit #${visit.id}...`);
    const [rec1, rec2] = await Promise.allSettled([
      finalizeSiloReceiptForVisit(visit.id, user.id),
      finalizeSiloReceiptForVisit(visit.id, user.id),
    ]);

    // 1. Both calls must complete safely without uncaught unique-constraint errors
    assert(rec1.status === 'fulfilled', `Call 1 rejected: ${(rec1 as any).reason}`);
    assert(rec2.status === 'fulfilled', `Call 2 rejected: ${(rec2 as any).reason}`);

    const resVal1 = (rec1 as PromiseFulfilledResult<any>).value;
    const resVal2 = (rec2 as PromiseFulfilledResult<any>).value;

    assert(resVal1.success === true, `Call 1 failed: ${resVal1.message}`);
    assert(resVal2.success === true, `Call 2 failed: ${resVal2.message}`);

    // 2. Exactly one call creates receipt, losing call reports alreadyFinalized: true
    const createdCount = (resVal1.receiptCreated ? 1 : 0) + (resVal2.receiptCreated ? 1 : 0);
    assert(createdCount === 1, `Expected exactly 1 call to report receiptCreated: true, got ${createdCount}`);

    const winner = resVal1.receiptCreated ? resVal1 : resVal2;
    const replay = resVal1.receiptCreated ? resVal2 : resVal1;

    assert(winner.receiptCreated === true, 'Winner must have receiptCreated: true');
    assert(replay.receiptCreated === false, 'Replay must have receiptCreated: false');
    assert(replay.alreadyFinalized === true, 'Replay must report alreadyFinalized: true');
    assert(replay.isHistorical === false, 'Fresh receipt must not be marked isHistorical');

    // 3. Database assertions
    const receiptTxs = await prisma.siloInventoryTransaction.findMany({
      where: { visit_id: visit.id, transaction_type: SiloTransactionType.RECEIPT },
    });
    assert(receiptTxs.length === 1, `Expected exactly 1 SiloInventoryTransaction RECEIPT, found ${receiptTxs.length}`);

    const reconRows = await prisma.plantFinalDualReconciliation.findMany({
      where: { visit_id: visit.id },
    });
    assert(reconRows.length === 1, `Expected exactly 1 PlantFinalDualReconciliation row, found ${reconRows.length}`);

    // 4. Stock changed exactly once
    const postTxCount = await prisma.siloInventoryTransaction.count({
      where: { silo_id: silo.id, transaction_type: SiloTransactionType.RECEIPT },
    });
    assert(postTxCount === preTxCount + 1, `Expected silo receipts to increase by 1, but changed from ${preTxCount} to ${postTxCount}`);

    // 5. Verification of quality snapshot and dual reconciliation fields
    const receipt = receiptTxs[0];
    assert(receipt.plant_composite_lr !== null, 'plant_composite_lr must be populated');
    assert(receipt.plant_composite_fat !== null, 'plant_composite_fat must be populated');
    assert(receipt.plant_density !== null, 'plant_density must be populated');
    assert(receipt.plant_snf !== null, 'plant_snf must be populated');
    assert(receipt.plant_ts !== null, 'plant_ts must be populated');
    assert(receipt.plant_final_at_13ts_liters !== null, 'plant_final_at_13ts_liters must be populated');

    const recon = reconRows[0];
    assert(recon.final_receipt_transaction_id === receipt.id, 'PlantFinalDualReconciliation must link to receipt transaction ID');
    assert(Number(recon.sent_gross_liters) === 10000, `sent_gross_liters expected 10000, got ${recon.sent_gross_liters}`);
    assert(Number(recon.received_gross_liters) === Number(receipt.quantity_liters), 'received_gross_liters must match receipt quantity_liters');
    assert(Number(recon.sent_at_13ts_liters) === 9500, `sent_at_13ts_liters expected 9500, got ${recon.sent_at_13ts_liters}`);
    assert(Number(recon.received_at_13ts_liters) === Number(receipt.plant_final_at_13ts_liters), 'received_at_13ts_liters must match receipt plant_final_at_13ts_liters');
    assert(recon.gross_variance_liters !== null, 'gross_variance_liters must be non-null');
    assert(recon.gross_variance_percent !== null, 'gross_variance_percent must be non-null');
    assert(recon.at_13ts_variance_liters !== null, 'at_13ts_variance_liters must be non-null');
    assert(recon.at_13ts_variance_percent !== null, 'at_13ts_variance_percent must be non-null');

    console.log(`[PASS] Both concurrent calls completed safely without unique-constraint errors.`);
    console.log(`[PASS] Exactly 1 SiloInventoryTransaction created (id: ${receipt.id}, volume: ${receipt.quantity_liters} L).`);
    console.log(`[PASS] Exactly 1 PlantFinalDualReconciliation created (gross diff: ${recon.gross_variance_liters} L, @13TS diff: ${recon.at_13ts_variance_liters} L).`);
    console.log(`[PASS] Winner reported receiptCreated: true; losing call reported alreadyFinalized: true.`);
    console.log(`[PASS] Silo stock transactions increased by exactly 1.`);
  } finally {
    // Cleanup isolated test data in reverse foreign-key order
    await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: visit.id } });
    await prisma.auditLog.deleteMany({ where: { record_id: visit.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: visit.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visit.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion_id: portion.id } });
    await prisma.plantLabResult.deleteMany({ where: { portion_id: portion.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.deleteMany({ where: { id: visit.id } });
    console.log(`[CLEANUP] Isolated test data for visit #${visit.id} successfully removed.`);
  }

  console.log('\n==================================================');
  console.log('REAL CONCURRENCY & IDEMPOTENCY VERIFICATION COMPLETE: ALL ASSERTIONS PASSED');
  console.log('==================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ CONCURRENCY VERIFICATION FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
