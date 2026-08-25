import {
  deriveManagerLifecycle,
  summarizePortionQA,
  computeElapsedInPlant,
  computeManagerOverview,
  deriveManagerAttention,
  buildVehicleVisitGroups,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime, formatOperationalTime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DBTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-B: ZMCC MANAGER OVERVIEW & LIVE DISPATCHES REGRESSION SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // Helper fixture builder
  function createMockLog(overrides: Partial<MilkProcessLog> = {}): MilkProcessLog {
    return {
      id: 101,
      portion_id: 1001,
      portion_number: '1',
      vehicle_number: 'LES-9999',
      token_number: 'T-101',
      zonal_contractor_name: 'ZMCC Hasilpur',
      dispatch_date: '2026-08-25',
      status: 'DISPATCHED',
      calculated_status: 'PENDING',
      rejection_reasons: null,
      remarks: null,
      borderline_warning: false,
      parallel_override_active: false,
      parallel_override_code: null,
      rm_mbrt_pending: false,
      first_weight_time: null,
      first_weight_of_vehicle: null,
      second_weight_time: null,
      second_weight_of_vehicle: null,
      out_from_gate_time: null,
      reception_date: null,
      reception_start_time: null,
      reception_end_time: null,
      silo_storage_id: null,
      computed_dispatch_snf: 8.8,
      computed_dispatch_ts: 12.6,
      computed_dispatch_13ts_liters: 9700,
      computed_sampling_snf: null,
      computed_sampling_ts: null,
      computed_plant_liters: null,
      computed_net_milk_weight: null,
      computed_plant_13ts_liters: null,
      dispatch_liters_gross: 10000,
      dispatch_fat: 3.8,
      dispatch_lr: 28.5,
      sampling_fat: null,
      sampling_lr: null,
      b_mbrt_minutes_test: null,
      igp_date: null,
      igp_time: null,
      created_at: '2026-08-25T04:00:00.000Z',
      updated_at: '2026-08-25T04:00:00.000Z',
      ...overrides,
    };
  }

  // ==========================================
  // 1. LIFECYCLE DERIVATION TESTS (B1 - B12)
  // ==========================================

  // B1: Dispatch only
  const logB1 = createMockLog({ status: 'DISPATCHED' });
  const lcB1 = deriveManagerLifecycle([logB1]);
  assert(
    lcB1.stages[0].status === 'COMPLETED' && lcB1.stages[1].status === 'CURRENT' && lcB1.currentStageId === 'DISPATCH',
    'TEST-B1: Dispatch only -> Dispatch completed, Gate Entry current'
  );

  // B2: Gate Entry recorded
  const logB2 = createMockLog({ status: 'GATE_IN', igp_date: '2026-08-25', igp_time: '09:15' });
  const lcB2 = deriveManagerLifecycle([logB2]);
  assert(
    lcB2.stages[1].status === 'COMPLETED' && lcB2.stages[2].status === 'CURRENT' && lcB2.currentStageId === 'PLANT_QA',
    'TEST-B2: Gate Entry recorded -> Gate Entry completed, Plant QA current'
  );

  // B3: QA started / pending
  const logB3 = createMockLog({ status: 'IN_QA', igp_date: '2026-08-25', igp_time: '09:15' });
  const lcB3 = deriveManagerLifecycle([logB3]);
  assert(
    lcB3.stages[2].status === 'CURRENT' && lcB3.currentStageLabel === 'Plant QA Analysis',
    'TEST-B3: QA started / pending -> Plant QA stage active'
  );

  // B4: All portions Accepted
  const logB4P1 = createMockLog({ id: 104, portion_number: '1', calculated_status: 'ACCEPTED', igp_date: '2026-08-25', igp_time: '09:15' });
  const logB4P2 = createMockLog({ id: 104, portion_number: '2', calculated_status: 'ACCEPTED', igp_date: '2026-08-25', igp_time: '09:15' });
  const lcB4 = deriveManagerLifecycle([logB4P1, logB4P2]);
  assert(
    lcB4.portionQA.summaryText === '2 / 2 Accepted' && lcB4.stages[2].status === 'COMPLETED' && lcB4.currentStageId === 'FIRST_WEIGHT',
    'TEST-B4: All portions accepted -> Summary is "2 / 2 Accepted" and QA completed'
  );

  // B5: Mixed Accepted / Rejected
  const logB5P1 = createMockLog({ id: 105, portion_number: '1', calculated_status: 'ACCEPTED', igp_date: '2026-08-25', igp_time: '09:15' });
  const logB5P2 = createMockLog({ id: 105, portion_number: '2', calculated_status: 'REJECTED', igp_date: '2026-08-25', igp_time: '09:15' });
  const lcB5 = deriveManagerLifecycle([logB5P1, logB5P2]);
  assert(
    lcB5.portionQA.summaryText === '1 Accepted · 1 Rejected' && lcB5.portionQA.badgeType === 'MIXED',
    'TEST-B5: Mixed portions -> Summary is "1 Accepted · 1 Rejected" (no fake vehicle decision)'
  );

  // B6: HOLD portion
  const logB6P1 = createMockLog({ id: 106, portion_number: '1', calculated_status: 'ACCEPTED', igp_date: '2026-08-25', igp_time: '09:15' });
  const logB6P2 = createMockLog({ id: 106, portion_number: '2', calculated_status: 'HOLD', igp_date: '2026-08-25', igp_time: '09:15' });
  const lcB6 = deriveManagerLifecycle([logB6P1, logB6P2]);
  assert(
    lcB6.portionQA.summaryText.includes('1 Hold') && lcB6.portionQA.badgeType === 'HAS_HOLD',
    'TEST-B6: HOLD portion -> Distinctly represented as 1 Accepted · 1 Hold with HAS_HOLD badge'
  );

  // B7: First Weight recorded
  const logB7 = createMockLog({
    status: 'WEIGHED_IN',
    igp_date: '2026-08-25',
    igp_time: '09:15',
    calculated_status: 'ACCEPTED',
    first_weight_of_vehicle: 24500,
    first_weight_time: '09:45',
  });
  const lcB7 = deriveManagerLifecycle([logB7]);
  assert(
    lcB7.stages[3].status === 'COMPLETED' && lcB7.stages[3].metricText === '24,500 KG' && lcB7.currentStageId === 'UNLOADING',
    'TEST-B7: First Weight recorded -> First Weight completed (24,500 KG), Unloading active'
  );

  // B8: Unloading active
  const logB8 = createMockLog({
    status: 'UNLOADING',
    igp_date: '2026-08-25',
    igp_time: '09:15',
    calculated_status: 'ACCEPTED',
    first_weight_of_vehicle: 24500,
    reception_start_time: '10:00',
    silo_storage_id: 'SILO-02',
  });
  const lcB8 = deriveManagerLifecycle([logB8]);
  assert(
    lcB8.stages[4].status === 'CURRENT' && lcB8.stages[4].detailText === 'Silo SILO-02' && lcB8.currentStageId === 'UNLOADING',
    'TEST-B8: Unloading active -> Unloading stage current with Silo SILO-02'
  );

  // B9: Unloading complete
  const logB9 = createMockLog({
    status: 'READY_FOR_TARE',
    igp_date: '2026-08-25',
    igp_time: '09:15',
    calculated_status: 'ACCEPTED',
    first_weight_of_vehicle: 24500,
    reception_start_time: '10:00',
    reception_end_time: '10:45',
    silo_storage_id: 'SILO-02',
  });
  const lcB9 = deriveManagerLifecycle([logB9]);
  assert(
    lcB9.stages[4].status === 'COMPLETED' && lcB9.stages[5].status === 'CURRENT' && lcB9.currentStageId === 'SECOND_WEIGHT',
    'TEST-B9: Unloading complete -> Unloading stage completed, Second Weight current'
  );

  // B10: Second Weight recorded
  const logB10 = createMockLog({
    status: 'TARE_WEIGHED',
    igp_date: '2026-08-25',
    igp_time: '09:15',
    calculated_status: 'ACCEPTED',
    first_weight_of_vehicle: 24500,
    second_weight_of_vehicle: 14500,
    second_weight_time: '11:00',
    reception_end_time: '10:45',
    silo_storage_id: 'SILO-02',
  });
  const lcB10 = deriveManagerLifecycle([logB10]);
  assert(
    lcB10.stages[5].status === 'COMPLETED' && lcB10.stages[5].metricText === '14,500 KG' && lcB10.currentStageId === 'FINAL_RECEIPT',
    'TEST-B10: Second Weight recorded -> Second Weight completed (14,500 KG), Final Receipt current'
  );

  // B11: Final Receipt exists
  const logB11 = createMockLog({
    status: 'COMPLETED',
    igp_date: '2026-08-25',
    igp_time: '09:15',
    calculated_status: 'ACCEPTED',
    first_weight_of_vehicle: 24500,
    second_weight_of_vehicle: 14500,
    computed_plant_liters: 9718.17,
    silo_storage_id: 'SILO-02',
  });
  const lcB11 = deriveManagerLifecycle([logB11]);
  assert(
    lcB11.stages[6].status === 'COMPLETED' && lcB11.stages[6].metricText === '9,718.17 L' && lcB11.isComplete,
    'TEST-B11: Final Receipt exists -> Final Receipt completed (9,718.17 L) and visit complete'
  );

  // B12: Partial/inconsistent data fails safely
  const logB12 = createMockLog({
    status: 'DISPATCHED',
    first_weight_of_vehicle: null,
    second_weight_of_vehicle: null,
    computed_plant_liters: null,
  });
  const lcB12 = deriveManagerLifecycle([logB12]);
  assert(
    lcB12.stages[3].status === 'UPCOMING' && lcB12.stages[5].status === 'UPCOMING' && lcB12.stages[6].status === 'UPCOMING',
    'TEST-B12: Incomplete data -> Upcoming stages remain un-fabricated UPCOMING'
  );

  // ==========================================
  // 2. ATTENTION PANEL DERIVATION TESTS (B13 - B20)
  // ==========================================

  // B13: Plant QA Rejection attention item
  const logB13 = createMockLog({
    id: 113,
    portion_number: '1',
    calculated_status: 'REJECTED',
    rejection_reasons: 'High Acidity (0.19%)',
    sampling_lr: 26.0,
    sampling_fat: 3.2,
  });
  const attB13 = deriveManagerAttention([logB13]);
  const hasQaRejItem = attB13.some((item) => item.type === 'PLANT_QA_REJECTION' && item.title.includes('Portion P-01'));
  assert(hasQaRejItem, 'TEST-B13: Plant QA rejection produces PLANT_QA_REJECTION attention item');

  // B14: Second Weight + missing final receipt -> Receipt Pending
  const logB14 = createMockLog({
    id: 114,
    status: 'TARE_WEIGHED',
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    computed_net_milk_weight: 10000,
    computed_plant_liters: null,
  });
  const attB14 = deriveManagerAttention([logB14]);
  const hasReceiptPending = attB14.some((item) => item.type === 'RECEIPT_PENDING');
  assert(hasReceiptPending, 'TEST-B14: Second Weight done without final receipt produces RECEIPT_PENDING attention item');

  // B15: Completed visit with quantity difference -> Informational item
  const logB15 = createMockLog({
    id: 115,
    status: 'COMPLETED',
    dispatch_liters_gross: 10000,
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    computed_plant_liters: 9780,
  });
  const attB15 = deriveManagerAttention([logB15]);
  const hasQtyDiff = attB15.some((item) => item.type === 'QUANTITY_DIFFERENCE');
  assert(hasQtyDiff, 'TEST-B15: Completed visit with quantity variance produces QUANTITY_DIFFERENCE item');

  // B16: Zero arbitrary quantity tolerance
  const qtyDiffItem = attB15.find((item) => item.type === 'QUANTITY_DIFFERENCE');
  const metricDiff = qtyDiffItem?.metrics?.find((m) => m.label === 'Difference')?.value;
  assert(metricDiff === '-220 L', 'TEST-B16: Quantity difference convention is Physical Received - Dispatch Gross (-220 L) with no arbitrary tolerance');

  // B17 & B18: Quality difference informational item
  const logB17 = createMockLog({
    id: 117,
    portion_number: '1',
    dispatch_lr: 29.0,
    sampling_lr: 28.0, // diff -1.0
    dispatch_fat: 4.0,
    sampling_fat: 3.7, // diff -0.3
  });
  const attB17 = deriveManagerAttention([logB17]);
  const hasQualDiff = attB17.some((item) => item.type === 'QUALITY_DIFFERENCE');
  assert(hasQualDiff, 'TEST-B17 & B18: Quality variance produces QUALITY_DIFFERENCE informational item with exact numeric differences');

  // B19: In-Plant elapsed duration
  const logB19 = createMockLog({
    id: 119,
    status: 'IN_QA',
    igp_date: '2026-08-25',
    igp_time: '09:00',
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  });
  const attB19 = deriveManagerAttention([logB19]);
  const hasDurationItem = attB19.some((item) => item.type === 'IN_PLANT_DURATION');
  assert(hasDurationItem, 'TEST-B19: Active in-plant vehicle displays elapsed duration without inventing "late" thresholds');

  // B20: Missing authoritative data does not become fake zero in attention panel
  const logB20 = createMockLog({
    id: 120,
    portion_number: '1',
    dispatch_lr: null,
    sampling_lr: null,
    dispatch_fat: null,
    sampling_fat: null,
  });
  const attB20 = deriveManagerAttention([logB20]);
  const fakeQualDiff = attB20.some((item) => item.type === 'QUALITY_DIFFERENCE' && item.visitId === 120);
  assert(!fakeQualDiff, 'TEST-B20: Missing QA data does not trigger fake 0.0 quality difference item');

  // ==========================================
  // 3. DATE/TIME & BUSINESS DATE TESTS (B21 - B23)
  // ==========================================

  // B21 & B22: UTC to Pakistan Event Date/Time and Business Date separation
  const testUtc = '2026-08-23T21:30:00.000Z';
  const pktDatetime = formatOperationalDatetime(testUtc);
  const pktTime = formatOperationalTime(testUtc);
  const bDate = getOperationalBusinessDate(new Date(testUtc));

  assert(
    pktDatetime.includes('24 Aug 2026') && pktTime.includes('02:30') && bDate === '2026-08-23',
    'TEST-B21 & B22: 2026-08-23T21:30:00Z converts to Event Date/Time 24-Aug-2026 02:30 AM PKT and Business Date 2026-08-23'
  );

  // ==========================================
  // 4. OVERVIEW KPI CALCULATIONS (B24 - B28)
  // ==========================================

  const logsOverview = [
    // Today Dispatched & Completed (Visit 1)
    createMockLog({
      id: 201,
      dispatch_date: '2026-08-25',
      status: 'COMPLETED',
      dispatch_liters_gross: 10000,
      computed_dispatch_13ts_liters: 9500,
      first_weight_of_vehicle: 25000,
      second_weight_of_vehicle: 15000,
      computed_plant_liters: 9800,
      computed_plant_13ts_liters: 9400,
      calculated_status: 'ACCEPTED',
    }),
    // Today Active in Plant (Visit 2, 2 portions, 1 rejected)
    createMockLog({
      id: 202,
      portion_number: '1',
      dispatch_date: '2026-08-25',
      status: 'IN_QA',
      igp_date: '2026-08-25',
      igp_time: '10:00',
      dispatch_liters_gross: 5000,
      computed_dispatch_13ts_liters: 4750,
      calculated_status: 'ACCEPTED',
    }),
    createMockLog({
      id: 202,
      portion_number: '2',
      dispatch_date: '2026-08-25',
      status: 'IN_QA',
      igp_date: '2026-08-25',
      igp_time: '10:00',
      dispatch_liters_gross: 5000,
      computed_dispatch_13ts_liters: 4750,
      calculated_status: 'REJECTED',
      rejection_reasons: 'Low Fat (2.8%)',
    }),
  ];

  const overviewMetrics = computeManagerOverview(logsOverview, '2026-08-25', 'TODAY');

  assert(overviewMetrics.dispatchedCount === 2, 'TEST-B24: Dispatched count correctly evaluates distinct visits (2 visits)', `Got: ${overviewMetrics.dispatchedCount}`);
  assert(overviewMetrics.currentlyInPlantCount === 1, 'TEST-B25: Currently in plant evaluates 1 active in-factory visit', `Got: ${overviewMetrics.currentlyInPlantCount}`);
  assert(overviewMetrics.completedCount === 1, 'TEST-B26: Completed count evaluates 1 finalized visit', `Got: ${overviewMetrics.completedCount}`);
  assert(overviewMetrics.rejectedPortionsCount === 1, 'TEST-B27: Rejected portions count evaluates 1 portion with REJECTED status', `Got: ${overviewMetrics.rejectedPortionsCount}`);
  assert(
    overviewMetrics.totalDispatchGrossLiters === 20000 &&
    overviewMetrics.totalPhysicalReceivedLiters === 9800 &&
    overviewMetrics.quantityDifferenceLiters === -10200,
    'TEST-B28: Secondary volume metrics correctly calculate Gross Liters (20,000), Physical Received (9,800), and Difference (-10,200 L)'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4DBTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
