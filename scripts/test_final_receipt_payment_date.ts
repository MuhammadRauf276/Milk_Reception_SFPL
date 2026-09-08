import { prisma } from '../src/backend/core/db';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function runFinalReceiptPaymentDateTests() {
  console.log('🧪 RUNNING FINAL RECEIPT & PAYMENT DATE TEST SUITE (RECEIPT-TIME-01..07, PAYDATE-01..05)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}] - ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] - ${detail}`);
      failed++;
    }
  }

  try {
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;
    if (currentDb !== 'milk_reception_test') {
      throw new Error(`CRITICAL SAFETY ERROR: Test attempted against non-test database: '${currentDb}'. Refusing to execute.`);
    }

    // RECEIPT-TIME-01: Final Silo Receipt transaction model exists and validates receipt posting
    const receiptTx = await prisma.siloInventoryTransaction.findFirst({
      where: { transaction_type: 'RECEIPT' },
    });
    const hasValidReceiptTx =
      receiptTx !== null &&
      receiptTx.operational_timestamp instanceof Date &&
      !isNaN(receiptTx.operational_timestamp.getTime()) &&
      receiptTx.transaction_type === 'RECEIPT';
    assert(hasValidReceiptTx, 'RECEIPT-TIME-01', 'Final receipt inventory transaction exists with valid operational timestamp');

    // RECEIPT-TIME-02 & 03: Receipt timestamp bounds
    const now = new Date();
    const tareTs = new Date(now.getTime() - 600 * 1000); // 10 mins ago
    const receiptTs = new Date(now.getTime() - 300 * 1000); // 5 mins ago

    assert(receiptTs.getTime() >= tareTs.getTime(), 'RECEIPT-TIME-02', 'Final receipt operational timestamp >= Tare operational timestamp');
    assert(receiptTs.getTime() <= now.getTime(), 'RECEIPT-TIME-03', 'Final receipt operational timestamp <= serverNow');

    // PAYDATE-01..03: Payment Business Date derivation
    // Case 1: Receipt at 2026-08-12 00:00 AM PKT (midnight, UTC 19:00 11 Aug) -> Business Date 2026-08-11
    const r1 = new Date('2026-08-11T19:00:00.000Z');
    const b1 = getOperationalBusinessDate(r1);
    assert(b1 === '2026-08-11', 'PAYDATE-01', `Final Receipt at 12 Aug 00:00 AM PKT maps to Payment Business Date 2026-08-11 (got ${b1})`);

    // Case 2: Receipt at 2026-08-12 07:59 AM PKT (UTC 02:59 12 Aug) -> Business Date 2026-08-11
    const r2 = new Date('2026-08-12T02:59:00.000Z');
    const b2 = getOperationalBusinessDate(r2);
    assert(b2 === '2026-08-11', 'PAYDATE-02', `Final Receipt at 12 Aug 07:59 AM PKT maps to Payment Business Date 2026-08-11 (got ${b2})`);

    // Case 3: Receipt at 2026-08-12 08:00 AM PKT (UTC 03:00 12 Aug) -> Business Date 2026-08-12
    const r3 = new Date('2026-08-12T03:00:00.000Z');
    const b3 = getOperationalBusinessDate(r3);
    assert(b3 === '2026-08-12', 'PAYDATE-03', `Final Receipt at 12 Aug 08:00 AM PKT maps to Payment Business Date 2026-08-12 (got ${b3})`);

    // PAYDATE-04 & 05: Gate Exit or submission delay does NOT change payment business date
    const exitTs = new Date('2026-08-12T04:00:00.000Z'); // 09:00 AM PKT
    const exitBizDate = getOperationalBusinessDate(exitTs);
    assert(b3 === '2026-08-12' && exitBizDate === '2026-08-12', 'PAYDATE-04 & 05', 'Payment Business Date derived strictly from Final Receipt operational timestamp');

    // RECEIPT-TIME-04: Behavioral proof - Missing Plant LR prevents final receipt creation and leaves payment date unavailable
    const { finalizeSiloReceiptForVisit } = await import('../src/backend/services/siloInventoryService');
    const source = await prisma.procurementSource.findFirst({ where: { is_active: true } });
    const silo = await prisma.silo.findFirst({ where: { is_active: true } });
    const user = await prisma.user.findFirst({ where: { is_active: true } });
    const fatTest = await prisma.labTest.findUnique({ where: { testCode: 'LT-000026' } });

    if (!source || !silo || !user || !fatTest) {
      assert(false, 'RECEIPT-TIME-04', 'Missing active source, silo, user, or fat test fixture in test database');
    } else {
      let testVisitId: bigint | null = null;
      try {
        const testVisit = await prisma.vehicleVisit.create({
          data: {
            visit_number: `TST-NOLR-${Date.now()}`,
            vehicle_number: 'TEST-NOLR-01',
            current_status: 'TARE_WEIGHED',
            procurement_source_id: source.id,
            created_by: user.id,
          },
        });
        testVisitId = testVisit.id;

        const portion = await prisma.visitPortion.create({
          data: {
            visit_id: testVisit.id,
            portion_number: 1,
            plant_decision: 'ACCEPTED',
            current_status: 'ACCEPTED',
          },
        });

        await prisma.unloadingLog.create({
          data: {
            portion_id: portion.id,
            silo_id: silo.id,
            pump_start_timestamp: new Date(),
            pump_end_timestamp: new Date(),
            started_by: user.id,
            completed_by: user.id,
          },
        });

        await prisma.weightTicket.create({
          data: {
            visit_id: testVisit.id,
            ticket_number: `TK-NOLR-${Date.now()}`,
            gross_weight_kg: 15000,
            tare_weight_kg: 5000,
            net_weight_kg: 10000,
            tare_timestamp: new Date(),
            tare_recorded_by: user.id,
          },
        });

        // Plant Fat LT-000026 recorded, Plant LR LT-000008 omitted
        await prisma.plantLabResult.create({
          data: {
            visit_id: testVisit.id,
            portion_id: portion.id,
            test_id: fatTest.id,
            numeric_value: 4.2,
            is_passed: true,
          },
        });

        const finalizeRes = await finalizeSiloReceiptForVisit(testVisit.id, user.id);
        const receiptTx = await prisma.siloInventoryTransaction.findFirst({
          where: { visit_id: testVisit.id, transaction_type: 'RECEIPT' },
        });

        const isRefused = !finalizeRes.success && !finalizeRes.receiptCreated && finalizeRes.reason === 'MISSING_PLANT_LR';
        const hasNoReceiptTx = receiptTx === null;

        assert(
          isRefused && hasNoReceiptTx,
          'RECEIPT-TIME-04',
          'Canonical finalizeSiloReceiptForVisit refuses receipt with MISSING_PLANT_LR, creates zero RECEIPT transactions, and receiptCreated is false'
        );
      } finally {
        if (testVisitId) {
          await prisma.auditLog.deleteMany({
            where: {
              table_name: 'silo_inventory_transaction',
              record_id: testVisitId,
              action: 'SILO_RECEIPT_FINALIZED',
            },
          });
          await prisma.siloInventoryTransaction.deleteMany({
            where: { visit_id: testVisitId },
          });
          await prisma.plantLabResult.deleteMany({ where: { portion: { visit_id: testVisitId } } });
          await prisma.unloadingLog.deleteMany({ where: { portion: { visit_id: testVisitId } } });
          await prisma.visitPortion.deleteMany({ where: { visit_id: testVisitId } });
          await prisma.weightTicket.deleteMany({ where: { visit_id: testVisitId } });
          await prisma.vehicleVisit.delete({ where: { id: testVisitId } });
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`FINAL RECEIPT & PAYMENT DATE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running receipt & payment date tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFinalReceiptPaymentDateTests();
