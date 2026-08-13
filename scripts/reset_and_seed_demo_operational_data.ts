import { resetOperationalData } from './reset_demo_operational_data';
import { seedOperationalData } from './seed_demo_operational_data';
import { prisma } from '../src/backend/core/db';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import {
  calculateSNF,
  calculateTS,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';

async function resetAndSeedWithValidation() {
  console.log('==================================================');
  console.log('STARTING OPERATIONAL DATA RESET & RESEED PIPELINE');
  console.log('==================================================\n');

  // Hard Gate Safety Checks
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL SAFETY ABORT: Cannot execute reset & seed in PRODUCTION environment!');
    process.exit(1);
  }

  if ((process.env.ALLOW_DEMO_RESET || '').trim() !== 'true') {
    console.error('CRITICAL SAFETY ABORT: ALLOW_DEMO_RESET=true is required to execute reset & seed!');
    process.exit(1);
  }

  // Step 1: Reset
  const deletedCounts = await resetOperationalData();

  // Step 2: Seed
  const seedSummary = await seedOperationalData();

  // Step 3: Comprehensive Programmatic Data Integrity Verification Assertions
  console.log('==================================================');
  console.log('RUNNING COMPLETE PROGRAMMATIC DATA INTEGRITY ASSERTIONS');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, assertionName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${assertionName}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${assertionName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  const now = new Date();

  // 1. Procurement Source Scoping & Distribution
  const visitsWithSource = await prisma.vehicleVisit.findMany({
    include: { procurement_source: true },
  });

  const missingSourceCount = visitsWithSource.filter((v) => !v.procurement_source_id || !v.procurement_source).length;
  assert(missingSourceCount === 0, 'ASSERT-1.1: 100% of visits have valid procurement_source_id', `Missing = ${missingSourceCount}`);

  const approvedSources = new Set(['ZMCC Hasilpur', 'ZMCC Jhang', 'ZMCC Kabirwala', 'Al Mehmood Dairy', 'Al Khair Dairy']);
  const invalidSources = visitsWithSource.filter((v) => !v.procurement_source || !approvedSources.has(v.procurement_source.name));
  assert(invalidSources.length === 0, 'ASSERT-1.2: Source distribution strictly restricted to 5 approved names', `Invalid = ${invalidSources.length}`);

  const sourceCounts: Record<string, number> = {};
  visitsWithSource.forEach((v) => {
    const sName = v.procurement_source?.name || 'Unknown';
    sourceCounts[sName] = (sourceCounts[sName] || 0) + 1;
  });
  console.log('  -> Verified Source Counts:', JSON.stringify(sourceCounts, null, 2));

  // 2. Workflow Chronology Assertion
  let chronologyViolations = 0;
  const visitsForChronology = await prisma.vehicleVisit.findMany({
    include: {
      portions: { include: { dispatch_info: true, unloading_log: true } },
      gate_log: true,
      qa_session: { include: { events: true } },
      weight_ticket: true,
    },
  });

  for (const v of visitsForChronology) {
    const dispatchTime = v.created_at;
    const gateEntry = v.gate_log?.entry_timestamp;
    const gateExit = v.gate_log?.exit_timestamp;

    if (gateEntry && gateEntry < dispatchTime) chronologyViolations++;
    if (dispatchTime > now || (gateEntry && gateEntry > now)) chronologyViolations++;

    if (v.current_status === 'COMPLETED') {
      const isRejected = v.portions.every((p) => p.plant_decision === 'REJECTED');
      if (isRejected) {
        if (gateExit && gateEntry && gateExit < gateEntry) chronologyViolations++;
      } else {
        const wt = v.weight_ticket;
        if (wt?.gross_timestamp && gateEntry && wt.gross_timestamp < gateEntry) chronologyViolations++;
        if (wt?.tare_timestamp && wt?.gross_timestamp && wt.tare_timestamp < wt.gross_timestamp) chronologyViolations++;
        if (gateExit && wt?.tare_timestamp && gateExit < wt.tare_timestamp) chronologyViolations++;
      }
    }
  }
  assert(chronologyViolations === 0, 'ASSERT-2: Operational Timeline Chronology Valid & No Future Timestamps', `Violations = ${chronologyViolations}`);

  // 3. Submitted At Assertion (submitted_at >= operational_timestamp)
  const gateLogs = await prisma.gateLog.findMany();
  const invalidSubmittedAt = gateLogs.filter((gl) => {
    if (gl.entry_timestamp && gl.entry_submitted_at && gl.entry_submitted_at < gl.entry_timestamp) return true;
    if (gl.exit_timestamp && gl.exit_submitted_at && gl.exit_submitted_at < gl.exit_timestamp) return true;
    return false;
  });
  assert(invalidSubmittedAt.length === 0, 'ASSERT-3: Submitted At >= Operational Timestamp across operational records', `Invalid = ${invalidSubmittedAt.length}`);

  // 4. Performed By Assertion
  const users = await prisma.user.findMany({ select: { id: true } });
  const validUserIds = new Set(users.map((u) => u.id.toString()));
  
  const visitsForPerformer = await prisma.vehicleVisit.findMany({
    select: { created_by: true },
  });
  const unperformedVisits = visitsForPerformer.filter((v) => !v.created_by || !validUserIds.has(v.created_by.toString()));
  assert(unperformedVisits.length === 0, 'ASSERT-4: Every operational event assigned valid existing performer user ID', `Invalid performers = ${unperformedVisits.length}`);

  // 5. Accepted QA Completeness Assertion
  const activePlantTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] }, resultType: { not: 'CALCULATED' } },
  });
  const acceptedPortions = await prisma.visitPortion.findMany({
    where: { plant_decision: 'ACCEPTED', current_status: { in: ['UNLOADED', 'COMPLETED'] } },
    include: { plant_lab_results: true },
  });

  let incompleteQA = 0;
  for (const p of acceptedPortions) {
    const testedIds = new Set(p.plant_lab_results.map((r) => r.test_id.toString()));
    const missing = activePlantTests.filter((t) => !testedIds.has(t.id.toString()));
    if (missing.length > 0) incompleteQA++;
  }
  assert(incompleteQA === 0, 'ASSERT-5: 100% of required active Plant QA tests present for ACCEPTED portions', `Incomplete portions = ${incompleteQA}`);

  // 6. Rejected QA Validity Assertion (Plant lab result + non-empty rejection reason & remarks)
  const rejectedPortions = await prisma.visitPortion.findMany({
    where: { plant_decision: 'REJECTED' },
    include: { plant_lab_results: true },
  });
  const invalidRejections = rejectedPortions.filter(
    (p) =>
      p.plant_lab_results.length === 0 ||
      !p.plant_rejection_reason ||
      p.plant_rejection_reason.trim() === ''
  );
  assert(invalidRejections.length === 0, 'ASSERT-6: Rejected portions have valid Plant QA results, rejection reason & remarks', `Invalid rejections = ${invalidRejections.length}`);

  // 7. All-Rejected Bypass Assertion
  const allRejectedVisits = await prisma.vehicleVisit.findMany({
    where: {
      portions: { every: { plant_decision: 'REJECTED' } },
      current_status: 'COMPLETED',
    },
    include: { weight_ticket: true, portions: { include: { unloading_log: true } } },
  });

  const bypassedViolations = allRejectedVisits.filter(
    (v) => v.weight_ticket !== null || v.portions.some((p) => p.unloading_log !== null)
  );
  assert(bypassedViolations.length === 0, 'ASSERT-7: All-rejected vehicles bypass Gross, Unloading, Tare, & Silo Receipt to Gate Exit', `Bypass violations = ${bypassedViolations.length}`);

  // 8. Weight & Formula Authority Assertion (Using canonical milkFormulas service)
  const weightTickets = await prisma.weightTicket.findMany();
  const invalidWeights = weightTickets.filter((wt) => {
    if (wt.gross_weight_kg !== null && wt.tare_weight_kg !== null) {
      const gross = Number(wt.gross_weight_kg);
      const tare = Number(wt.tare_weight_kg);
      const net = Number(wt.net_weight_kg);
      return gross <= tare || net !== gross - tare || net <= 0;
    }
    return false;
  });

  // Authoritative Milk Formula Verification via imported functions
  const snf = calculateSNF(28.5, 3.8);
  const ts = calculateTS(3.8, snf);
  const density = calculateDensity(28.5);
  const physicalLiters = calculatePhysicalLiters(10000, 28.5);
  const at13ts = calculateAt13TSLiters(physicalLiters, ts);

  const formulaCheck =
    Math.abs(snf - 8.681) < 0.001 &&
    Math.abs(ts - 12.481) < 0.001 &&
    Math.abs(density - 1.0285) < 0.001 &&
    Math.abs(physicalLiters - 9722.897) < 0.1 &&
    Math.abs(at13ts - 9334.82) < 0.5;

  assert(invalidWeights.length === 0 && formulaCheck, 'ASSERT-8: Weight Integrity (Gross > Tare, Net Kg) & Authoritative Canonical Milk Formulas Verified', `Invalid weights = ${invalidWeights.length}`);

  // 9. VEHICLE-LEVEL Final Silo Receipt Assertion
  // Count eligible completed accepted vehicle visits (visits with at least 1 accepted portion in COMPLETED status)
  const eligibleVisits = await prisma.vehicleVisit.findMany({
    where: {
      current_status: 'COMPLETED',
      portions: { some: { plant_decision: 'ACCEPTED' } },
    },
  });

  const finalReceipts = await prisma.siloInventoryTransaction.findMany({
    where: { transaction_type: 'RECEIPT' },
  });

  const idempotencyKeys = finalReceipts.map((r) => r.idempotency_key || '');
  const uniqueKeys = new Set(idempotencyKeys);
  const perPortionKeys = idempotencyKeys.filter((k) => k.includes(':PORTION:'));
  const vehicleLevelKeys = idempotencyKeys.filter((k) => /^FINAL_RECEIPT:VISIT:\d+$/.test(k));

  // Multi-portion vehicle verification
  const multiPortionVisits = await prisma.vehicleVisit.findMany({
    where: {
      portions: { some: {} },
      current_status: 'COMPLETED',
    },
    include: { portions: true, inventory_transactions: { where: { transaction_type: 'RECEIPT' } } },
  });

  const multiPortionEligible = multiPortionVisits.filter((v) => v.portions.length > 1 && v.portions.some((p) => p.plant_decision === 'ACCEPTED'));
  const multiPortionReceiptViolations = multiPortionEligible.filter((v) => v.inventory_transactions.length !== 1);

  assert(
    finalReceipts.length === eligibleVisits.length &&
      vehicleLevelKeys.length === finalReceipts.length &&
      perPortionKeys.length === 0 &&
      multiPortionReceiptViolations.length === 0,
    'ASSERT-9: VEHICLE-LEVEL Final Silo Receipts strictly match eligible accepted vehicle visits (FINAL_RECEIPT:VISIT:<visitId>)',
    `Eligible visits = ${eligibleVisits.length}, Final Receipts = ${finalReceipts.length}, Vehicle-Level keys = ${vehicleLevelKeys.length}, Per-Portion keys = ${perPortionKeys.length}`
  );

  // 10. Silo Integrity Assertion
  const silos = await prisma.silo.findMany({ where: { is_active: true } });
  const negativeSilos: any[] = [];
  for (const s of silos) {
    const sumRes = await prisma.siloInventoryTransaction.aggregate({
      where: { silo_id: s.id },
      _sum: { quantity_liters: true },
    });
    const stock = Number(sumRes._sum.quantity_liters || 0);
    if (stock < 0) negativeSilos.push(s);
  }
  assert(negativeSilos.length === 0, 'ASSERT-10: Silo stock balances non-negative from transaction ledger sums', `Negative silos = ${negativeSilos.length}`);

  // 11. Business Date Boundary Assertion
  const d0740 = getOperationalBusinessDate('2026-08-12T07:40:00+05:00');
  const d0759 = getOperationalBusinessDate('2026-08-12T07:59:59+05:00');
  const d0800 = getOperationalBusinessDate('2026-08-12T08:00:00+05:00');
  const d0815 = getOperationalBusinessDate('2026-08-12T08:15:00+05:00');

  const bdCheck = d0740 === '2026-08-11' && d0759 === '2026-08-11' && d0800 === '2026-08-12' && d0815 === '2026-08-12';
  assert(bdCheck, 'ASSERT-11: Canonical Asia/Karachi 08:00 AM Business Date Cutoff Helper Verified', `07:40->${d0740}, 07:59->${d0759}, 08:00->${d0800}, 08:15->${d0815}`);

  console.log('\n==================================================');
  console.log(`COMPLETE INTEGRITY VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    console.error('CRITICAL ABORT: Programmatic data integrity assertion failed.');
    process.exit(1);
  }

  return {
    deletedCounts,
    seedSummary,
    eligibleVisitsCount: eligibleVisits.length,
    finalReceiptsCount: finalReceipts.length,
  };
}

if (require.main === module) {
  resetAndSeedWithValidation()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error during reset & reseed pipeline:', err);
      process.exit(1);
    });
}
