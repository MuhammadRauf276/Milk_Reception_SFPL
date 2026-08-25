import fs from 'fs';
import path from 'path';
import {
  deriveManagerLifecycle,
  summarizePortionQA,
  computeElapsedInPlant,
  computeManagerOverview,
  computeCompletedReceiptQuantityComparison,
  deriveManagerAttention,
  buildVehicleVisitGroups,
  filterGroupsByDateRange,
  isBusinessDateInPeriod,
  formatMetricDiff,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime, formatOperationalTime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DBTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-B-R3: ZMCC MANAGER LIFECYCLE & RECEIPT AUTHORITY REGRESSION SUITE');
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
      dispatch_timestamp: '2026-08-25T04:00:00.000Z',
      gate_entry_timestamp: null,
      gate_exit_timestamp: null,
      first_weight_timestamp: null,
      second_weight_timestamp: null,
      unloading_start_timestamp: null,
      unloading_end_timestamp: null,
      final_receipt_exists: false,
      final_receipt_transaction_id: null,
      final_receipt_timestamp: null,
      authoritative_final_liters: null,
      created_at: '2026-08-25T04:00:00.000Z',
      updated_at: '2026-08-25T04:00:00.000Z',
      ...overrides,
    };
  }

  // ================================================================================
  // 1. HOLD & QA COMPLETION SEMANTICS (R-B1 to R-B5)
  // ================================================================================

  // R-B1: 1 Accepted + 1 HOLD -> Plant QA remains current / incomplete
  const logRB1P1 = createMockLog({ id: 101, portion_number: '1', calculated_status: 'ACCEPTED', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const logRB1P2 = createMockLog({ id: 101, portion_number: '2', calculated_status: 'HOLD', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const lcRB1 = deriveManagerLifecycle([logRB1P1, logRB1P2]);
  assert(
    lcRB1.stages[2].status === 'CURRENT' && lcRB1.currentStageId === 'PLANT_QA',
    'R-B1: 1 Accepted + 1 HOLD -> Plant QA remains CURRENT (incomplete)'
  );

  // R-B2: All HOLD -> Plant QA incomplete
  const logRB2 = createMockLog({ id: 102, portion_number: '1', calculated_status: 'HOLD', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const lcRB2 = deriveManagerLifecycle([logRB2]);
  assert(
    lcRB2.stages[2].status === 'CURRENT' && lcRB2.portionQA.badgeType === 'HAS_HOLD',
    'R-B2: All HOLD -> Plant QA incomplete with HAS_HOLD badge'
  );

  // R-B3: 1 Accepted + 1 Pending -> Plant QA incomplete
  const logRB3P1 = createMockLog({ id: 103, portion_number: '1', calculated_status: 'ACCEPTED', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const logRB3P2 = createMockLog({ id: 103, portion_number: '2', calculated_status: 'PENDING', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const lcRB3 = deriveManagerLifecycle([logRB3P1, logRB3P2]);
  assert(
    lcRB3.stages[2].status === 'CURRENT' && lcRB3.currentStageId === 'PLANT_QA',
    'R-B3: 1 Accepted + 1 Pending -> Plant QA remains CURRENT'
  );

  // R-B4: Accepted + Rejected only -> QA definitive / completed
  const logRB4P1 = createMockLog({ id: 104, portion_number: '1', calculated_status: 'ACCEPTED', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const logRB4P2 = createMockLog({ id: 104, portion_number: '2', calculated_status: 'REJECTED', gate_entry_timestamp: '2026-08-25T04:15:00.000Z' });
  const lcRB4 = deriveManagerLifecycle([logRB4P1, logRB4P2]);
  assert(
    lcRB4.stages[2].status === 'COMPLETED' && lcRB4.portionQA.summaryText === '1 Accepted · 1 Rejected',
    'R-B4: Accepted + Rejected only -> Plant QA COMPLETED'
  );

  // R-B5: HOLD displayed distinctly
  const qaSummaryHold = summarizePortionQA([logRB1P1, logRB1P2]);
  assert(
    qaSummaryHold.summaryText === '1 Accepted · 1 Hold' && qaSummaryHold.badgeType === 'HAS_HOLD',
    'R-B5: HOLD displayed distinctly as "1 Accepted · 1 Hold" with HAS_HOLD badge'
  );

  // ================================================================================
  // 2. AUTHORITATIVE FINAL RECEIPT (R-B6 to R-B9)
  // ================================================================================

  // R-B6: computed_plant_liters exists but NO SiloInventoryTransaction RECEIPT -> Final Receipt NOT complete
  const logRB6 = createMockLog({
    id: 106,
    status: 'COMPLETED',
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    computed_plant_liters: 9800,
    final_receipt_exists: false,
  });
  const lcRB6 = deriveManagerLifecycle([logRB6]);
  assert(
    lcRB6.stages[6].status === 'CURRENT' && lcRB6.isComplete === false && lcRB6.currentStageId === 'FINAL_RECEIPT',
    'R-B6: computed_plant_liters without authoritative receipt transaction -> Final Receipt NOT complete (CURRENT)'
  );

  // R-B7: Second Weight exists + no receipt -> Receipt Pending attention
  const logRB7 = createMockLog({
    id: 107,
    status: 'TARE_WEIGHED',
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    final_receipt_exists: false,
  });
  const attRB7 = deriveManagerAttention([logRB7]);
  const hasReceiptPending = attRB7.some((a) => a.type === 'RECEIPT_PENDING' && a.visitId === 107);
  assert(hasReceiptPending, 'R-B7: Second Weight without authoritative receipt produces RECEIPT_PENDING attention item');

  // Check full locked labels in Receipt Pending item
  const rpItem = attRB7.find((a) => a.type === 'RECEIPT_PENDING' && a.visitId === 107);
  const rpLabels = rpItem?.metrics?.map((m) => m.label) || [];
  assert(
    rpLabels.includes('First Weight (Loaded Vehicle)') && rpLabels.includes('Second Weight (After Unloading)'),
    'R-B7.1: Receipt Pending attention metrics use full locked Weighbridge labels'
  );

  // R-B8: Authoritative RECEIPT transaction exists -> Final Receipt complete
  const logRB8 = createMockLog({
    id: 108,
    status: 'COMPLETED',
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    computed_plant_liters: 9800,
    final_receipt_exists: true,
    final_receipt_transaction_id: 888,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: 9800,
  });
  const lcRB8 = deriveManagerLifecycle([logRB8]);
  assert(
    lcRB8.stages[6].status === 'COMPLETED' && lcRB8.isComplete === true && lcRB8.stages[6].metricText === '9,800 L',
    'R-B8: Authoritative RECEIPT transaction exists -> Final Receipt COMPLETED with exact receipt metric'
  );

  // R-B9: Status = GATE_OUT without receipt transaction -> does NOT mark Final Receipt complete
  const logRB9 = createMockLog({
    id: 109,
    status: 'GATE_OUT',
    final_receipt_exists: false,
  });
  const lcRB9 = deriveManagerLifecycle([logRB9]);
  assert(
    lcRB9.stages[6].status !== 'COMPLETED' && lcRB9.isComplete === false,
    'R-B9: Status GATE_OUT without receipt transaction -> Final Receipt remains incomplete'
  );

  // ================================================================================
  // 3. PAIRED QUANTITY AGGREGATES & MISSING != ZERO (R3-1 to R3-4)
  // ================================================================================

  // R3-1: Cross-date quantity population: Vehicle A dispatched 23-Aug (10,000 L), finalized 24-Aug (9,800 L).
  // Selected reporting date: 24-Aug.
  const crossDateLogA = createMockLog({
    id: 201,
    dispatch_date: '2026-08-23', // Dispatched 23-Aug
    dispatch_liters_gross: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 701,
    final_receipt_timestamp: '2026-08-24T05:00:00.000Z', // Finalized 24-Aug Business Date
    authoritative_final_liters: 9800,
  });
  const metricsR31 = computeManagerOverview([crossDateLogA], '2026-08-24', 'TODAY');
  assert(
    metricsR31.dispatchedCount === 0 &&
    metricsR31.completedCount === 1 &&
    metricsR31.totalDispatchGrossLiters === 10000 &&
    metricsR31.totalPhysicalReceivedLiters === 9800 &&
    metricsR31.quantityDifferenceLiters === -200,
    'R3-1: Cross-date visit: Dispatched Today = 0, Completed Today = 1, Paired Dispatch = 10,000 L, Received = 9,800 L, Diff = -200 L'
  );

  // R3-2: Same population paired comparison (A: 5000/4900, B: 6000/5900)
  const logsR32 = [
    createMockLog({ id: 202, dispatch_liters_gross: 5000, final_receipt_exists: true, authoritative_final_liters: 4900, final_receipt_timestamp: '2026-08-25T04:00:00.000Z' }),
    createMockLog({ id: 203, dispatch_liters_gross: 6000, final_receipt_exists: true, authoritative_final_liters: 5900, final_receipt_timestamp: '2026-08-25T05:00:00.000Z' }),
  ];
  const groupsR32 = buildVehicleVisitGroups(logsR32);
  const pairedR32 = computeCompletedReceiptQuantityComparison(groupsR32);
  assert(
    pairedR32.dispatchGrossLiters === 11000 &&
    pairedR32.finalPhysicalReceivedLiters === 10800 &&
    pairedR32.differenceLiters === -200,
    'R3-2: Paired comparison across same completed population produces 11,000 L / 10,800 L / -200 L'
  );

  // R3-3: Missing member in receipt period (A: 5000/4900, B: 6000/null) -> aggregates are null
  const logsR33 = [
    createMockLog({ id: 204, dispatch_liters_gross: 5000, final_receipt_exists: true, authoritative_final_liters: 4900, final_receipt_timestamp: '2026-08-25T04:00:00.000Z' }),
    createMockLog({ id: 205, dispatch_liters_gross: 6000, final_receipt_exists: true, authoritative_final_liters: null, final_receipt_timestamp: '2026-08-25T05:00:00.000Z' }),
  ];
  const groupsR33 = buildVehicleVisitGroups(logsR33);
  const pairedR33 = computeCompletedReceiptQuantityComparison(groupsR33);
  assert(
    pairedR33.dispatchGrossLiters === null &&
    pairedR33.finalPhysicalReceivedLiters === null &&
    pairedR33.differenceLiters === null,
    'R3-3: One missing final quantity in completed population makes paired totals and difference null (never partial sum)'
  );

  // R3-4: Empty receipt population -> all quantity fields are null (NOT 0 L)
  const pairedR34 = computeCompletedReceiptQuantityComparison([]);
  assert(
    pairedR34.comparableVisitCount === 0 &&
    pairedR34.dispatchGrossLiters === null &&
    pairedR34.finalPhysicalReceivedLiters === null &&
    pairedR34.differenceLiters === null,
    'R3-4: Empty completed receipts population produces null quantities (NOT 0 L)'
  );

  // ================================================================================
  // 4. QUALITY DIFFERENCE — ZERO EPSILON & VISIBLE NON-ZERO (R3-5 to R3-8)
  // ================================================================================

  // R3-5: Exact quality non-zero (Plant LR 28.04, Dispatch LR 28.00 -> diff +0.04)
  const logR35 = createMockLog({
    id: 305,
    portion_number: '1',
    dispatch_lr: 28.00,
    sampling_lr: 28.04,
    dispatch_fat: 3.5,
    sampling_fat: 3.5,
  });
  const attR35 = deriveManagerAttention([logR35]);
  const hasQualDiff35 = attR35.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 305);
  assert(hasQualDiff35, 'R3-5: LR difference +0.04 produces QUALITY_DIFFERENCE attention without epsilon suppression');

  // R3-6: Small fat difference (Plant Fat 4.104, Dispatch Fat 4.100 -> diff +0.004)
  const logR36 = createMockLog({
    id: 306,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.0,
    dispatch_fat: 4.100,
    sampling_fat: 4.104,
  });
  const attR36 = deriveManagerAttention([logR36]);
  const qualItem36 = attR36.find((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 306);
  const fatMetricStr = qualItem36?.metrics?.find((m) => m.label.includes('Fat'))?.value || '';
  assert(
    Boolean(qualItem36) && fatMetricStr.includes('+0.004') && !fatMetricStr.includes('(+0%)'),
    'R3-6: Small fat difference +0.004 is visibly displayed as non-zero (+0.004%), not rounded to 0'
  );

  // R3-7: Exact zero quality difference produces NO item
  const logR37 = createMockLog({
    id: 307,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.0,
    dispatch_fat: 3.5,
    sampling_fat: 3.5,
  });
  const attR37 = deriveManagerAttention([logR37]);
  const hasQualDiff37 = attR37.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 307);
  assert(!hasQualDiff37, 'R3-7: Exact zero quality difference produces NO difference attention item');

  // R3-8: Static inspection: Verify NO artificial 1e-9 / epsilon in zmccManagerHelpers.ts
  const helpersSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers.ts'),
    'utf8'
  );
  const has1e9 = helpersSrc.includes('1e-9');
  const hasEpsilon = helpersSrc.includes('EPSILON');
  assert(!has1e9 && !hasEpsilon, 'R3-8: Static check: No 1e-9 or EPSILON tolerance exists in zmccManagerHelpers.ts');

  // ================================================================================
  // 5. LIVE DISPATCHES & ARCHITECTURE STATE ISOLATION (R3-9 to R3-12)
  // ================================================================================

  // R3-9: Live source data isolation
  const activeYesterdayLog = createMockLog({
    id: 401,
    vehicle_number: 'LIVE-TANKER-99',
    dispatch_date: '2026-08-23',
    gate_entry_timestamp: '2026-08-23T22:00:00.000Z',
    status: 'UNLOADING',
    final_receipt_exists: false,
  });
  const liveGroups = buildVehicleVisitGroups([activeYesterdayLog]);
  const activeInLive = liveGroups.filter((g) => g.lifecycle.isInPlant);
  assert(
    activeInLive.length === 1 && activeInLive[0].vehicleNumber === 'LIVE-TANKER-99',
    'R3-9: Live Dispatches retains active tanker from previous Business Date in pipeline'
  );

  // R3-10 to R3-12: Static check for state separation in ZMCCManagerWorkspace.tsx
  const workspaceSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'),
    'utf8'
  );
  const hasSeparateLiveLogs = workspaceSrc.includes('liveLogs') && workspaceSrc.includes('reportingLogs');
  const hasSeparateLoading = workspaceSrc.includes('liveLoading') && workspaceSrc.includes('reportingLoading');
  const hasSeparateError = workspaceSrc.includes('liveError') && workspaceSrc.includes('reportingError');
  const liveDispatchesReceivesLive = workspaceSrc.includes('logs={liveLogs}');
  assert(
    hasSeparateLiveLogs && hasSeparateLoading && hasSeparateError && liveDispatchesReceivesLive,
    'R3-10 to R3-12: ZMCCManagerWorkspace has separate liveLogs, reportingLogs, liveLoading/error, and passes liveLogs to Live Dispatches'
  );

  // ================================================================================
  // 6. UNLOADING COMPLETE & LATEST EVENT TIMESTAMPS (R3-13 to R3-15)
  // ================================================================================

  // R3-13: Unloading stage exposes both Start and End timestamps
  const logR313 = createMockLog({
    id: 513,
    status: 'TARE_WEIGHED',
    first_weight_of_vehicle: 25000,
    unloading_start_timestamp: '2026-08-25T05:00:00.000Z',
    unloading_end_timestamp: '2026-08-25T05:45:00.000Z',
  });
  const lcR313 = deriveManagerLifecycle([logR313]);
  const unloadStage = lcR313.stages.find((s) => s.id === 'UNLOADING');
  assert(
    Boolean(
      unloadStage?.eventTimestamp &&
      unloadStage?.eventTimestampEnd &&
      unloadStage.eventTimestamp.includes('10:00') &&
      unloadStage.eventTimestampEnd.includes('10:45')
    ),
    'R3-13: Unloading stage exposes both eventTimestamp (Start) and eventTimestampEnd (Completed)'
  );

  // R3-14: Latest Event Date/Time is exposed
  assert(
    lcR313.latestEventLabel !== null && lcR313.latestEventTimestamp !== null,
    'R3-14: Manager lifecycle exposes both latestEventLabel and latestEventTimestamp'
  );

  // R3-15: Timezone formatting: 2026-08-23T21:30:00Z -> 24 Aug 2026, 02:30 in Asia/Karachi, Business Date 2026-08-23
  const testUtc = '2026-08-23T21:30:00.000Z';
  const formattedPkt = formatOperationalDatetime(testUtc);
  const bDate = getOperationalBusinessDate(new Date(testUtc));
  assert(
    formattedPkt.includes('24 Aug 2026') && formattedPkt.includes('02:30') && bDate === '2026-08-23',
    'R3-15: 2026-08-23T21:30:00Z formats to 24 Aug 2026, 02:30 in Asia/Karachi while Business Date is 2026-08-23'
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
