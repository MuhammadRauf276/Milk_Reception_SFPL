import fs from 'fs';
import path from 'path';
import {
  deriveQualityRejectionItems,
  deriveQualityRejectionSummary,
  filterQualityRejectionItems,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { isPlantLrTest, isPlantFatTest } from '../src/backend/services/vehicleQuantityService';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime } from '../src/lib/datetime-utils';

async function run4DDTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-D-R1: ZMCC MANAGER QUALITY & REJECTIONS TEST SUITE');
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

  // Mock log builder
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
      dispatch_kg_gross: null,
      dispatch_liters_gross: 10000,
      vehicle_dispatch_quantity_value: 10000,
      vehicle_dispatch_quantity_unit: 'LITER',
      vehicle_dispatch_quantity_basis: 'GROSS',
      vehicle_dispatch_gross_liters: 10000,
      dispatch_fat: 3.8,
      dispatch_lr: 28.5,
      sampling_fat: null,
      sampling_lr: null,
      b_mbrt_minutes_test: null,
      igp_date: null,
      igp_time: null,
      sampling_date: null,
      sampling_time_start: null,
      sampling_time_end: null,
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

  // D1: Accepted portion: calculated_status = ACCEPTED -> Accepted count +1
  const logD1 = createMockLog({ id: 1, portion_number: '1', calculated_status: 'ACCEPTED' });
  const itemsD1 = deriveQualityRejectionItems([logD1]);
  const summaryD1 = deriveQualityRejectionSummary(itemsD1);
  assert(
    itemsD1[0].qaDecision === 'ACCEPTED' && summaryD1.acceptedCount === 1 && summaryD1.rejectedCount === 0,
    'D1: Accepted portion: calculated_status = ACCEPTED -> Accepted count = 1'
  );

  // D2: Rejected portion: calculated_status = REJECTED -> Rejected count +1
  const logD2 = createMockLog({
    id: 2,
    portion_number: '1',
    calculated_status: 'REJECTED',
    rejection_reasons: 'High Temperature & MBRT Fail',
  });
  const itemsD2 = deriveQualityRejectionItems([logD2]);
  const summaryD2 = deriveQualityRejectionSummary(itemsD2);
  assert(
    itemsD2[0].qaDecision === 'REJECTED' &&
    summaryD2.rejectedCount === 1 &&
    itemsD2[0].rejectionReasons === 'High Temperature & MBRT Fail',
    'D2: Rejected portion: calculated_status = REJECTED -> Rejected count = 1'
  );

  // D3: HOLD portion: Hold count +1 -> not Accepted -> not Rejected
  const logD3 = createMockLog({ id: 3, portion_number: '1', calculated_status: 'HOLD' });
  const itemsD3 = deriveQualityRejectionItems([logD3]);
  const summaryD3 = deriveQualityRejectionSummary(itemsD3);
  assert(
    itemsD3[0].qaDecision === 'HOLD' &&
    summaryD3.holdCount === 1 &&
    summaryD3.acceptedCount === 0 &&
    summaryD3.rejectedCount === 0,
    'D3: HOLD portion -> Hold count = 1 (not Accepted, not Rejected)'
  );

  // D4: PENDING portion: Pending count +1 -> not Accepted -> not Rejected
  const logD4 = createMockLog({ id: 4, portion_number: '1', calculated_status: null });
  const itemsD4 = deriveQualityRejectionItems([logD4]);
  const summaryD4 = deriveQualityRejectionSummary(itemsD4);
  assert(
    itemsD4[0].qaDecision === 'PENDING' &&
    summaryD4.pendingCount === 1 &&
    summaryD4.acceptedCount === 0 &&
    summaryD4.rejectedCount === 0,
    'D4: PENDING portion -> Pending count = 1 (not Accepted, not Rejected)'
  );

  // D5: Vehicle status = QA_ACCEPTED, portion = HOLD -> portion remains HOLD
  const logD5 = createMockLog({ id: 5, portion_number: '1', calculated_status: 'HOLD', status: 'QA_ACCEPTED' });
  const itemsD5 = deriveQualityRejectionItems([logD5]);
  assert(
    itemsD5[0].qaDecision === 'HOLD',
    'D5: Vehicle status = QA_ACCEPTED with portion calculated_status = HOLD -> portion remains HOLD'
  );

  // D6: Vehicle status = COMPLETED (or rejected-like), portion = PENDING -> portion remains PENDING
  const logD6 = createMockLog({ id: 6, portion_number: '1', calculated_status: 'PENDING', status: 'COMPLETED' });
  const itemsD6 = deriveQualityRejectionItems([logD6]);
  assert(
    itemsD6[0].qaDecision === 'PENDING',
    'D6: Vehicle status = COMPLETED with portion calculated_status = PENDING -> portion remains PENDING'
  );

  // D7: LT-000008: authoritative Plant LR
  assert(isPlantLrTest('LT-000008', 'LR at 20 Celsius') === true, 'D7: LT-000008 is authoritative Plant LR');

  // D8: wrong ID with LR-like name: NOT authoritative Plant LR
  assert(isPlantLrTest('LT-000027', 'Lactometer Reading') === false, 'D8.1: LT-000027 is NOT authoritative Plant LR');
  assert(isPlantLrTest('LT-999999', 'LR at 20 Celsius') === false, 'D8.2: Unknown test code with LR name is NOT Plant LR');

  // D9: LT-000026: authoritative Plant Fat
  assert(isPlantFatTest('LT-000026', 'Fat') === true, 'D9: LT-000026 is authoritative Plant Fat');

  // D10: LT-000027: NOT authoritative Fat
  assert(isPlantFatTest('LT-000027', 'Fat') === false, 'D10: LT-000027 is NOT authoritative Fat');

  // D11: wrong ID named Fat: NOT authoritative Plant Fat
  assert(isPlantFatTest('LT-000001', 'Fat') === false, 'D11.1: LT-000001 (Temperature) is NOT Plant Fat');
  assert(isPlantFatTest('LT-999999', 'Fat %') === false, 'D11.2: Unknown test code with Fat name is NOT Plant Fat');

  // D12: Plant LR 28.04, Dispatch LR 28.00 -> +0.04 difference
  const logD12 = createMockLog({ id: 12, portion_number: '1', dispatch_lr: 28.0, sampling_lr: 28.04 });
  const itemsD12 = deriveQualityRejectionItems([logD12]);
  assert(
    itemsD12[0].lrDiff === 0.04 && itemsD12[0].lrDiffText === '+0.04',
    'D12: Plant LR 28.04 vs Dispatch LR 28.00 yields +0.04 difference'
  );

  // D13: Plant Fat 4.104, Dispatch Fat 4.100 -> +0.004 visibly non-zero
  const logD13 = createMockLog({ id: 13, portion_number: '1', dispatch_fat: 4.1, sampling_fat: 4.104 });
  const itemsD13 = deriveQualityRejectionItems([logD13]);
  assert(
    itemsD13[0].fatDiff === 0.004 && itemsD13[0].fatDiffText === '+0.004%',
    'D13: Plant Fat 4.104 vs Dispatch Fat 4.100 yields +0.004% visibly non-zero'
  );

  // D14: Exact equal quality -> zero difference
  const logD14 = createMockLog({ id: 14, portion_number: '1', dispatch_lr: 28.5, sampling_lr: 28.5, dispatch_fat: 4.0, sampling_fat: 4.0 });
  const itemsD14 = deriveQualityRejectionItems([logD14]);
  assert(
    itemsD14[0].lrDiff === 0 &&
    itemsD14[0].lrDiffText === '0' &&
    itemsD14[0].fatDiff === 0 &&
    itemsD14[0].fatDiffText === '0%' &&
    itemsD14[0].hasQualityDifference === false,
    'D14: Exact equal quality produces 0 differences and hasQualityDifference = false'
  );

  // D15: Missing Plant quality -> unavailable, no fallback
  const logD15 = createMockLog({ id: 15, portion_number: '1', dispatch_lr: 28.0, sampling_lr: null, dispatch_fat: 3.8, sampling_fat: null });
  const itemsD15 = deriveQualityRejectionItems([logD15]);
  assert(
    itemsD15[0].plantLr === null &&
    itemsD15[0].plantFat === null &&
    itemsD15[0].lrDiffText === '—' &&
    itemsD15[0].fatDiffText === '—',
    'D15: Missing Plant quality results in unavailable metrics without fallback'
  );

  // D16: Quality difference alone does NOT change ACCEPTED decision to REJECTED
  const logD16 = createMockLog({
    id: 16,
    portion_number: '1',
    calculated_status: 'ACCEPTED',
    dispatch_fat: 4.5,
    sampling_fat: 3.5, // Large fat difference
    dispatch_lr: 30.0,
    sampling_lr: 26.0, // Large LR difference
  });
  const itemsD16 = deriveQualityRejectionItems([logD16]);
  assert(
    itemsD16[0].qaDecision === 'ACCEPTED' && itemsD16[0].hasQualityDifference === true,
    'D16: Quality difference alone does NOT change ACCEPTED decision to REJECTED'
  );

  // D17: Mixed vehicle: Portion 1 ACCEPTED, Portion 2 REJECTED -> no fake authoritative vehicle QA decision
  const logD17P1 = createMockLog({ id: 17, portion_number: '1', calculated_status: 'ACCEPTED', vehicle_number: 'MIX-01' });
  const logD17P2 = createMockLog({ id: 17, portion_number: '2', calculated_status: 'REJECTED', vehicle_number: 'MIX-01' });
  const itemsD17 = deriveQualityRejectionItems([logD17P1, logD17P2]);
  const summaryD17 = deriveQualityRejectionSummary(itemsD17);
  assert(
    itemsD17[0].qaDecision === 'ACCEPTED' &&
    itemsD17[1].qaDecision === 'REJECTED' &&
    summaryD17.acceptedCount === 1 &&
    summaryD17.rejectedCount === 1 &&
    summaryD17.vehiclesWithRejectionsCount === 1,
    'D17: Mixed vehicle preserves separate portion-level QA decisions (1 Accepted · 1 Rejected)'
  );

  // D18 & D19: Loading & Error summary placeholder checks in component
  const compSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerQualityRejections.tsx'),
    'utf8'
  );
  assert(
    compSrc.includes('showKpiPlaceholders ? \'—\' : summary.totalPortions') ||
    compSrc.includes('showKpiPlaceholders ? "—" : summary.totalPortions'),
    'D18 & D19: Summary KPI cards display placeholder "—" during loading or error'
  );

  // D20: Success empty: legitimate zero counts
  const emptySummary = deriveQualityRejectionSummary([]);
  assert(
    emptySummary.totalPortions === 0 &&
    emptySummary.acceptedCount === 0 &&
    emptySummary.rejectedCount === 0 &&
    emptySummary.holdCount === 0 &&
    emptySummary.pendingCount === 0,
    'D20: Success empty summary produces legitimate zero counts'
  );

  // D21: Business Date label is used
  assert(compSrc.includes('Business Date:'), 'D21.1: Component uses "Business Date:" label');
  assert(!compSrc.includes('Operational Date'), 'D21.2: Component does NOT use "Operational Date"');

  // D22: QA event timestamp formats in Asia/Karachi
  const testUtc = '2026-08-25T05:30:00.000Z';
  const formattedEvent = formatOperationalDatetime(testUtc);
  assert(
    formattedEvent.includes('25 Aug 2026') && formattedEvent.includes('10:30'),
    'D22: Event timestamp 2026-08-25T05:30:00Z formats to 25 Aug 2026, 10:30 am in Asia/Karachi'
  );

  // D23: No mutation controls in Quality & Rejections component
  const hasMutationControls =
    compSrc.includes('onClick={() => handleAccept') ||
    compSrc.includes('onClick={() => handleReject') ||
    compSrc.includes('onClick={() => handleHold') ||
    compSrc.includes('handleFinalize') ||
    compSrc.includes('onApprove');
  assert(!hasMutationControls, 'D23: Quality & Rejections component contains no mutation action controls');

  // ================================================================================
  // R1 REGRESSION #1: QA EVENT TIMESTAMP AUTHORITY (NO RECONSTRUCTION / NO CREATED_AT)
  // ================================================================================
  const logNoQaIso = createMockLog({
    id: 101,
    portion_number: '1',
    sampling_date: '2026-08-25',
    sampling_time_end: '14:30:00',
    sampling_time_start: '14:00:00',
    created_at: '2026-08-25T04:00:00.000Z',
  });
  const itemsNoQaIso = deriveQualityRejectionItems([logNoQaIso]);
  assert(
    itemsNoQaIso[0].qaEventTimestamp === null,
    'R1.1: When no authoritative QA ISO instant exists, qaEventTimestamp is null (no date+time string reconstruction and no created_at fallback)'
  );

  const testIsoInstant = '2026-08-23T21:30:00.000Z'; // 24 Aug 2026, 02:30 AM PKT
  const formattedPkTime = formatOperationalDatetime(testIsoInstant);
  assert(
    formattedPkTime.includes('24 Aug 2026') && formattedPkTime.includes('02:30'),
    'R1.2: Known UTC ISO instant (2026-08-23T21:30:00Z) formats to 24 Aug 2026, 02:30 in Asia/Karachi'
  );

  // ================================================================================
  // R1 REGRESSION #2: OFFICIAL REJECTION REASON AUTHORITY (rejectionReasons only)
  // ================================================================================
  const logRejectionWithGenericRemarksOnly = createMockLog({
    id: 201,
    portion_number: '1',
    calculated_status: 'REJECTED',
    rejection_reasons: null,
    remarks: 'Operator checked sample',
  });
  const itemsRejectionGeneric = deriveQualityRejectionItems([logRejectionWithGenericRemarksOnly]);
  assert(
    itemsRejectionGeneric[0].rejectionReasons === null &&
    itemsRejectionGeneric[0].qaDecisionRemarks === 'Operator checked sample',
    'R1.3: Portion rejection with no official rejection_reasons has rejectionReasons = null (generic remarks NOT promoted)'
  );

  const logRejectionWithAuthoritativeReason = createMockLog({
    id: 202,
    portion_number: '1',
    calculated_status: 'REJECTED',
    rejection_reasons: 'Plant LR outside accepted decision criteria',
    remarks: 'Sample tested twice',
  });
  const itemsRejectionAuth = deriveQualityRejectionItems([logRejectionWithAuthoritativeReason]);
  assert(
    itemsRejectionAuth[0].rejectionReasons === 'Plant LR outside accepted decision criteria' &&
    itemsRejectionAuth[0].qaDecisionRemarks === 'Sample tested twice',
    'R1.4: Portion rejection with authoritative rejection_reasons preserves exact official reason'
  );

  // Filter testing
  const allItems = [...itemsD1, ...itemsD2, ...itemsD3, ...itemsD4];
  const acceptedFiltered = filterQualityRejectionItems(allItems, '', 'ACCEPTED');
  const rejectedFiltered = filterQualityRejectionItems(allItems, '', 'REJECTED');
  const holdFiltered = filterQualityRejectionItems(allItems, '', 'HOLD');
  const pendingFiltered = filterQualityRejectionItems(allItems, '', 'PENDING');
  assert(
    acceptedFiltered.length === 1 &&
    rejectedFiltered.length === 1 &&
    holdFiltered.length === 1 &&
    pendingFiltered.length === 1,
    'D24: Filtering by portion QA decision state correctly filters portion items'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4DDTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
