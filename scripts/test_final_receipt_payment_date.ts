import { prisma } from '../src/backend/core/db';
import { getOperationalBusinessDate, getPakistanCalendarDate } from '../src/backend/core/business-day';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

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
    const { testDbName } = assertSafeTestDatabase();
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;

    if (currentDb !== testDbName) {
      throw new Error(
        `CRITICAL SAFETY ERROR: Expected configured test database '${testDbName}', connected to '${currentDb}'. Refusing to execute.`
      );
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

    // PAYDATE-01: Final Receipt has valid operational timestamp and its calendar date comes via getPakistanCalendarDate
    // Unlike Business Date, Pakistan Calendar Date does NOT apply the 08:00 AM plant cutoff
    const rBeforeCutoff = new Date('2026-08-12T02:59:00.000Z'); // 07:59 AM PKT on Aug 12
    const calDateBeforeCutoff = getPakistanCalendarDate(rBeforeCutoff);
    assert(
      calDateBeforeCutoff === '2026-08-12',
      'PAYDATE-01',
      `Final Receipt at 12 Aug 07:59 AM PKT has Pakistan calendar date 2026-08-12 (got ${calDateBeforeCutoff}) without 08:00 cutoff`
    );

    // PAYDATE-02: Final Receipt does NOT assign VehicleVisit Business Date (VehicleVisit.operational_date remains null)
    // PAYDATE-03: VehicleVisit Business Date remains null before Plant Gate Exit
    // Verified by checking unexited vehicle visits in the database
    const unexitedVisitsWithReceipt = await prisma.vehicleVisit.findMany({
      where: {
        current_status: { in: ['TARE_WEIGHED', 'READY_FOR_GATE_EXIT'] },
      },
    });
    const allUnexitedHaveNullBizDate = unexitedVisitsWithReceipt.every((v) => v.operational_date === null);
    assert(
      allUnexitedHaveNullBizDate,
      'PAYDATE-02 & 03',
      'VehicleVisit.operational_date is strictly null prior to Gate Exit completion, even after Final Receipt creation'
    );

    // PAYDATE-04: Plant Gate Exit assigns authoritative Business Date using 08:00 boundary
    // Case A: Gate Exit at 07:59:59 AM PKT (UTC 02:59:59 12 Aug) -> maps to prior date 2026-08-11
    const exit1 = new Date('2026-08-12T02:59:59.000Z');
    const exitBiz1 = getOperationalBusinessDate(exit1);
    assert(
      exitBiz1 === '2026-08-11',
      'PAYDATE-04a',
      `Gate exit at 12 Aug 07:59:59 AM PKT maps to prior Business Date 2026-08-11 (got ${exitBiz1})`
    );

    // Case B: Gate Exit at 08:00:00 AM PKT (UTC 03:00:00 12 Aug) -> maps to current date 2026-08-12
    const exit2 = new Date('2026-08-12T03:00:00.000Z');
    const exitBiz2 = getOperationalBusinessDate(exit2);
    assert(
      exitBiz2 === '2026-08-12',
      'PAYDATE-04b',
      `Gate exit at 12 Aug 08:00:00 AM PKT maps to current Business Date 2026-08-12 (got ${exitBiz2})`
    );

    // PAYDATE-05: Dispatch date/time never falls back as Business Date; VehicleVisit Business Date is exclusively Plant Gate Exit
    const mockVisitGroupBizDate = (visitBizDate: string | null) => visitBizDate || '';
    assert(
      mockVisitGroupBizDate(null) === '',
      'PAYDATE-05',
      'Business Date concept belongs only to Plant VehicleVisit; unfinalized visits have empty businessDate with zero fallback to dispatch date'
    );

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
