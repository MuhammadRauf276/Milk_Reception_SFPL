import {
  deriveManagerLifecycle,
  summarizePortionQA,
  computeElapsedInPlant,
  computeManagerOverview,
  deriveManagerAttention,
  buildVehicleVisitGroups,
  filterGroupsByDateRange,
  isBusinessDateInPeriod,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime, formatOperationalTime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DBTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-B-R2: ZMCC MANAGER LIFECYCLE & RECEIPT AUTHORITY REGRESSION SUITE');
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
  // 3. QUANTITY AGGREGATES & MISSING != ZERO (R-B10 to R-B14)
  // ================================================================================

  // R-B10: All authoritative quantities present -> aggregate total available
  const logsComplete = [
    createMockLog({ id: 201, dispatch_liters_gross: 10000, final_receipt_exists: true, authoritative_final_liters: 9800, final_receipt_timestamp: '2026-08-25T06:00:00.000Z' }),
    createMockLog({ id: 202, dispatch_liters_gross: 5000, final_receipt_exists: true, authoritative_final_liters: 4900, final_receipt_timestamp: '2026-08-25T06:30:00.000Z' }),
  ];
  const metricsRB10 = computeManagerOverview(logsComplete, '2026-08-25', 'TODAY');
  assert(
    metricsRB10.totalDispatchGrossLiters === 15000 &&
    metricsRB10.totalPhysicalReceivedLiters === 14700 &&
    metricsRB10.quantityDifferenceLiters === -300,
    'R-B10: All authoritative quantities present -> complete totals (15,000 L / 14,700 L / -300 L)'
  );

  // R-B11: One required quantity missing -> aggregate unavailable (null), NOT partial
  const logsMissingDispatch = [
    createMockLog({ id: 203, dispatch_liters_gross: 10000 }),
    createMockLog({ id: 204, dispatch_liters_gross: null }),
  ];
  const metricsRB11 = computeManagerOverview(logsMissingDispatch, '2026-08-25', 'TODAY');
  assert(
    metricsRB11.totalDispatchGrossLiters === null,
    'R-B11: One required dispatch quantity missing -> aggregate Dispatch Gross is null (unavailable)'
  );

  // R-B12: Missing final quantity -> difference unavailable (null)
  const logsMissingFinal = [
    createMockLog({ id: 205, dispatch_liters_gross: 10000, final_receipt_exists: true, authoritative_final_liters: null, final_receipt_timestamp: '2026-08-25T06:00:00.000Z' }),
  ];
  const metricsRB12 = computeManagerOverview(logsMissingFinal, '2026-08-25', 'TODAY');
  assert(
    metricsRB12.totalPhysicalReceivedLiters === null && metricsRB12.quantityDifferenceLiters === null,
    'R-B12: Missing authoritative final receipt liters -> Physical Received and Quantity Difference are null'
  );

  // R-B13: Difference = 0.005 L -> no arbitrary 0.01 tolerance suppresses it
  const logRB13 = createMockLog({
    id: 213,
    dispatch_liters_gross: 10000,
    final_receipt_exists: true,
    authoritative_final_liters: 10000.005,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    status: 'COMPLETED',
  });
  const attRB13 = deriveManagerAttention([logRB13]);
  const hasQtyDiff13 = attRB13.some((a) => a.type === 'QUANTITY_DIFFERENCE' && a.visitId === 213);
  assert(hasQtyDiff13, 'R-B13: Small non-zero quantity difference (+0.01 L / 0.005 L) is NOT suppressed by arbitrary tolerance');

  // R-B14: Zero exact difference -> no difference attention item
  const logRB14 = createMockLog({
    id: 214,
    dispatch_liters_gross: 10000,
    final_receipt_exists: true,
    authoritative_final_liters: 10000,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    status: 'COMPLETED',
  });
  const attRB14 = deriveManagerAttention([logRB14]);
  const hasZeroDiffItem = attRB14.some((a) => a.type === 'QUANTITY_DIFFERENCE' && a.visitId === 214);
  assert(!hasZeroDiffItem, 'R-B14: Exact zero quantity difference produces NO difference attention item');

  // ================================================================================
  // 4. QUALITY DIFFERENCE & ZERO TOLERANCE (R-B15 to R-B19)
  // ================================================================================

  // R-B15: LR difference +0.1 -> informational difference visible (no arbitrary >= 0.5 threshold)
  const logRB15 = createMockLog({
    id: 315,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.1,
    dispatch_fat: 3.5,
    sampling_fat: 3.5,
  });
  const attRB15 = deriveManagerAttention([logRB15]);
  const hasQualDiff15 = attRB15.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 315);
  assert(hasQualDiff15, 'R-B15: LR difference +0.1 is visible (no arbitrary >= 0.5 threshold)');

  // R-B16: Fat difference +0.05 -> informational difference visible (no arbitrary >= 0.2 threshold)
  const logRB16 = createMockLog({
    id: 316,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.0,
    dispatch_fat: 3.50,
    sampling_fat: 3.55,
  });
  const attRB16 = deriveManagerAttention([logRB16]);
  const hasQualDiff16 = attRB16.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 316);
  assert(hasQualDiff16, 'R-B16: Fat difference +0.05 is visible (no arbitrary >= 0.2 threshold)');

  // R-B17: Exact zero quality difference -> no difference item
  const logRB17 = createMockLog({
    id: 317,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.0,
    dispatch_fat: 3.5,
    sampling_fat: 3.5,
  });
  const attRB17 = deriveManagerAttention([logRB17]);
  const hasQualDiff17 = attRB17.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 317);
  assert(!hasQualDiff17, 'R-B17: Exact zero quality difference produces NO difference attention item');

  // R-B18: Missing dispatch/Plant value -> unavailable; no fake zero default
  const logRB18 = createMockLog({
    id: 318,
    portion_number: '1',
    dispatch_lr: null,
    sampling_lr: 28.0,
    dispatch_fat: null,
    sampling_fat: 3.5,
  });
  const attRB18 = deriveManagerAttention([logRB18]);
  const hasQualDiff18 = attRB18.some((a) => a.type === 'QUALITY_DIFFERENCE' && a.visitId === 318);
  assert(!hasQualDiff18, 'R-B18: Missing dispatch quality values produce NO fake difference');

  // R-B19: Multi-portion values remain portion-specific (no fake vehicle average)
  const logRB19P1 = createMockLog({ id: 319, portion_number: '1', dispatch_lr: 28.0, sampling_lr: 29.0, dispatch_fat: 3.5, sampling_fat: 3.5 });
  const logRB19P2 = createMockLog({ id: 319, portion_number: '2', dispatch_lr: 29.0, sampling_lr: 29.0, dispatch_fat: 3.8, sampling_fat: 3.8 });
  const attRB19 = deriveManagerAttention([logRB19P1, logRB19P2]);
  const p1Item = attRB19.find((a) => a.type === 'QUALITY_DIFFERENCE' && a.title.includes('Portion P-01'));
  const p2Item = attRB19.find((a) => a.type === 'QUALITY_DIFFERENCE' && a.title.includes('Portion P-02'));
  assert(Boolean(p1Item) && !p2Item, 'R-B19: Quality difference is strictly portion-specific (Portion P-01 flagged, P-02 not flagged)');

  // ================================================================================
  // 5. LIVE BOUNDARY INDEPENDENCE (R-B24)
  // ================================================================================

  // R-B24: Active vehicle from previous Business Date remains visible in Live Dispatches
  const logsLiveBoundary = [
    createMockLog({
      id: 401,
      dispatch_date: '2026-08-23', // previous business date
      status: 'UNLOADING',
      gate_entry_timestamp: '2026-08-23T22:00:00.000Z',
      final_receipt_exists: false,
    }),
  ];
  const groupsAll = buildVehicleVisitGroups(logsLiveBoundary);
  // Overview filtered for TODAY (2026-08-24)
  const overviewFiltered = filterGroupsByDateRange(groupsAll, '2026-08-24', 'TODAY');
  assert(
    overviewFiltered.length === 0 &&
    groupsAll.length === 1 &&
    groupsAll[0].lifecycle.isInPlant === true,
    'R-B24: Active vehicle from previous Business Date is excluded from Overview Today but preserved in Live Dispatches'
  );

  // ================================================================================
  // 6. EVENT TIMESTAMPS & IN-PLANT DURATION (R-B25 to R-B29)
  // ================================================================================

  // R-B25: In-plant duration uses gate entry instant
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const dur1 = computeElapsedInPlant(tenMinsAgo);
  assert(dur1 === '10m', 'R-B25: computeElapsedInPlant evaluates exact 10m from gate entry instant', `Got: ${dur1}`);

  // R-B26: No dispatch fallback for in-plant duration (missing gate entry returns null)
  const durNull = computeElapsedInPlant(null);
  assert(durNull === null, 'R-B26: Missing gate entry timestamp yields null duration (no dispatch fallback)');

  // R-B27 & R-B28: Known UTC instant displays in Asia/Karachi (PKT)
  const testUtc = '2026-08-23T21:30:00.000Z';
  const formattedPkt = formatOperationalDatetime(testUtc);
  assert(
    formattedPkt.includes('24 Aug 2026') && formattedPkt.includes('02:30'),
    'R-B27 & R-B28: 2026-08-23T21:30:00Z formats to 24 Aug 2026, 02:30 in Asia/Karachi'
  );

  // R-B29: Business Date for same instant is 2026-08-23 (08:00 cutoff boundary intact)
  const bDate = getOperationalBusinessDate(new Date(testUtc));
  assert(bDate === '2026-08-23', 'R-B29: Business Date for 02:30 AM PKT event is 2026-08-23');

  // ================================================================================
  // 7. FINAL RECEIPT TIMESTAMP & COMPLETED TODAY VIA FINAL RECEIPT BUSINESS DATE (R-B30 to R-B31)
  // ================================================================================

  const logRB30 = createMockLog({
    id: 530,
    final_receipt_exists: true,
    final_receipt_timestamp: '2026-08-25T07:30:00.000Z',
    authoritative_final_liters: 9900,
  });
  const lcRB30 = deriveManagerLifecycle([logRB30]);
  assert(
    lcRB30.stages[6].eventTimestamp !== null && lcRB30.latestEventLabel === 'Final Receipt Posted',
    'R-B30: Authoritative receipt transaction timestamp is exposed and used as Final Receipt Date/Time'
  );

  // R-B31: Completed Today follows Final Receipt Business Date (not Dispatch Business Date)
  const crossDateLog = createMockLog({
    id: 531,
    dispatch_date: '2026-08-24', // Dispatched yesterday
    status: 'COMPLETED',
    dispatch_liters_gross: 10000,
    final_receipt_exists: true,
    final_receipt_transaction_id: 999,
    final_receipt_timestamp: '2026-08-25T05:00:00.000Z', // Finalized today (Business Date 2026-08-25)
    authoritative_final_liters: 9850,
  });
  const overviewCrossDate = computeManagerOverview([crossDateLog], '2026-08-25', 'TODAY');
  assert(
    overviewCrossDate.dispatchedCount === 0 &&
    overviewCrossDate.completedCount === 1 &&
    overviewCrossDate.totalPhysicalReceivedLiters === 9850,
    'R-B31: Vehicle dispatched yesterday but finalized today counts 0 in Dispatched Today, 1 in Completed Today, with 9,850 L Received'
  );

  // R-B32: Locked Weighbridge Labels
  const stageLabels = lcRB30.stages.map((s) => s.label);
  assert(
    stageLabels.includes('First Weight (Loaded Vehicle)') &&
    stageLabels.includes('Second Weight (After Unloading)'),
    'R-B32: Full locked Weighbridge labels used across all lifecycle definitions'
  );

  // R-B33: LAST_7 and LAST_15 Semantics
  const sampleGroups = [
    { businessDate: '2026-08-25' }, // Day 0 (today)
    { businessDate: '2026-08-24' }, // Day 1
    { businessDate: '2026-08-23' }, // Day 2
    { businessDate: '2026-08-22' }, // Day 3
    { businessDate: '2026-08-21' }, // Day 4
    { businessDate: '2026-08-20' }, // Day 5
    { businessDate: '2026-08-19' }, // Day 6
    { businessDate: '2026-08-18' }, // Day 7 (8th date -> excluded from LAST_7)
  ] as any[];

  const last7 = filterGroupsByDateRange(sampleGroups, '2026-08-25', 'LAST_7');
  assert(
    last7.length === 7,
    'R-B33: LAST_7 contains exactly 7 Business Dates (today + 6 prior)',
    `Got ${last7.length} dates`
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
