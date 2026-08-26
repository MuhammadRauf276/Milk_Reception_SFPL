import fs from 'fs';
import path from 'path';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
  filterVehicleReconciliationItems,
  formatMetricDiff,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DCTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-C: ZMCC MANAGER CROSS VERIFICATION TEST SUITE');
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
  // C1: One completed visit: Dispatch Gross 10,000 L, Final Physical Received 9,800 L -> Difference = -200 L
  // ================================================================================
  const logC1 = createMockLog({
    id: 101,
    dispatch_liters_gross: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 501,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: 9800,
  });
  const groupsC1 = buildVehicleVisitGroups([logC1]);
  const reconC1 = deriveVehicleReconciliationItems(groupsC1);
  assert(
    reconC1[0].dispatchGrossLiters === 10000 &&
    reconC1[0].physicalReceivedLiters === 9800 &&
    reconC1[0].quantityDifferenceLiters === -200 &&
    reconC1[0].quantityDifferenceText === '-200 L',
    'C1: Completed visit: 10,000 L Dispatch Gross vs 9,800 L Final Received yields -200 L difference'
  );

  // ================================================================================
  // C2: authoritative_final_liters = null, computed_plant_liters = 9800 -> Final Physical Received unavailable, no difference
  // ================================================================================
  const logC2 = createMockLog({
    id: 102,
    dispatch_liters_gross: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 502,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: null,
    computed_plant_liters: 9800,
  });
  const groupsC2 = buildVehicleVisitGroups([logC2]);
  const reconC2 = deriveVehicleReconciliationItems(groupsC2);
  assert(
    reconC2[0].physicalReceivedLiters === null &&
    reconC2[0].quantityDifferenceLiters === null &&
    reconC2[0].quantityDifferenceText === '—',
    'C2: authoritative_final_liters=null with computed_plant_liters=9800 yields unavailable received quantity and no difference'
  );

  // ================================================================================
  // C3: Dispatch quantity not comparable in liters -> no KG/L comparison invented
  // ================================================================================
  const logC3 = createMockLog({
    id: 103,
    dispatch_liters_gross: null,
    status: 'COMPLETED',
    final_receipt_exists: true,
    authoritative_final_liters: 9800,
  });
  const groupsC3 = buildVehicleVisitGroups([logC3]);
  const reconC3 = deriveVehicleReconciliationItems(groupsC3);
  assert(
    reconC3[0].dispatchGrossLiters === null &&
    reconC3[0].quantityDifferenceLiters === null &&
    reconC3[0].quantityDifferenceText === '—',
    'C3: Missing dispatch liters yields no direct quantity difference (no fabricated KG/L comparison)'
  );

  // ================================================================================
  // C4: Portion: Dispatch LR 28.0, Plant LR 28.4 -> LR difference +0.4
  // ================================================================================
  const logC4 = createMockLog({
    id: 104,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.4,
  });
  const groupsC4 = buildVehicleVisitGroups([logC4]);
  const reconC4 = deriveVehicleReconciliationItems(groupsC4);
  assert(
    reconC4[0].portions[0].lrDiff === 0.4 &&
    reconC4[0].portions[0].lrDiffText === '+0.4',
    'C4: Portion Dispatch LR 28.0 vs Plant LR 28.4 yields LR difference +0.4'
  );

  // ================================================================================
  // C5: Plant Fat 4.104, Dispatch Fat 4.100 -> +0.004 remains visibly non-zero
  // ================================================================================
  const logC5 = createMockLog({
    id: 105,
    portion_number: '1',
    dispatch_fat: 4.100,
    sampling_fat: 4.104,
  });
  const groupsC5 = buildVehicleVisitGroups([logC5]);
  const reconC5 = deriveVehicleReconciliationItems(groupsC5);
  assert(
    reconC5[0].portions[0].fatDiff === 0.004 &&
    reconC5[0].portions[0].fatDiffText === '+0.004%',
    'C5: Portion Plant Fat 4.104 vs Dispatch Fat 4.100 yields visibly non-zero +0.004%'
  );

  // ================================================================================
  // C6: Missing Plant LR/Fat -> unavailable, no fallback
  // ================================================================================
  const logC6 = createMockLog({
    id: 106,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: null,
    dispatch_fat: 3.8,
    sampling_fat: null,
  });
  const groupsC6 = buildVehicleVisitGroups([logC6]);
  const reconC6 = deriveVehicleReconciliationItems(groupsC6);
  assert(
    reconC6[0].portions[0].plantLr === null &&
    reconC6[0].portions[0].plantFat === null &&
    reconC6[0].portions[0].lrDiffText === '—' &&
    reconC6[0].portions[0].fatDiffText === '—',
    'C6: Missing Plant LR/Fat results in unavailable plant results without fake fallbacks'
  );

  // ================================================================================
  // C7: HOLD portion remains HOLD
  // ================================================================================
  const logC7 = createMockLog({
    id: 107,
    portion_number: '1',
    calculated_status: 'HOLD',
  });
  const groupsC7 = buildVehicleVisitGroups([logC7]);
  const reconC7 = deriveVehicleReconciliationItems(groupsC7);
  assert(
    reconC7[0].portions[0].qaDecision === 'HOLD' &&
    reconC7[0].hasHold === true,
    'C7: Portion in HOLD status remains HOLD in reconciliation'
  );

  // ================================================================================
  // C8: Rejected Plant portion represented accurately
  // ================================================================================
  const logC8 = createMockLog({
    id: 108,
    portion_number: '2',
    calculated_status: 'REJECTED',
    rejection_reasons: 'High Acidity & Clot on Boiling',
  });
  const groupsC8 = buildVehicleVisitGroups([logC8]);
  const reconC8 = deriveVehicleReconciliationItems(groupsC8);
  assert(
    reconC8[0].portions[0].qaDecision === 'REJECTED' &&
    reconC8[0].hasRejection === true &&
    reconC8[0].portions[0].qaDecisionRemarks === 'High Acidity & Clot on Boiling',
    'C8: Rejected portion accurately shows REJECTED decision and rejection reasons'
  );

  // ================================================================================
  // C9: No fake vehicle-level QA decision
  // ================================================================================
  const logC9P1 = createMockLog({ id: 109, portion_number: '1', calculated_status: 'ACCEPTED' });
  const logC9P2 = createMockLog({ id: 109, portion_number: '2', calculated_status: 'REJECTED' });
  const groupsC9 = buildVehicleVisitGroups([logC9P1, logC9P2]);
  const reconC9 = deriveVehicleReconciliationItems(groupsC9);
  assert(
    reconC9[0].portions[0].qaDecision === 'ACCEPTED' &&
    reconC9[0].portions[1].qaDecision === 'REJECTED' &&
    reconC9[0].portionCount === 2,
    'C9: Vehicle with mixed portions preserves separate portion-level QA decisions (no fake vehicle QA status)'
  );

  // ================================================================================
  // C10 & C11: No quantity or quality tolerance in reconciliation logic
  // ================================================================================
  const logC10 = createMockLog({
    id: 110,
    dispatch_liters_gross: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    authoritative_final_liters: 10000.01,
  });
  const groupsC10 = buildVehicleVisitGroups([logC10]);
  const reconC10 = deriveVehicleReconciliationItems(groupsC10);
  assert(
    reconC10[0].hasQuantityDifference === true &&
    reconC10[0].quantityDifferenceLiters === 0.01 &&
    reconC10[0].quantityDifferenceText === '+0.01 L',
    'C10: Minute quantity difference (+0.01 L) is not swallowed by tolerance'
  );

  const helperSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers.ts'),
    'utf8'
  );
  const hasToleranceEnum = helperSrc.includes('WITHIN_TOLERANCE') || helperSrc.includes('OUTSIDE_TOLERANCE');
  assert(!hasToleranceEnum, 'C11: No tolerance classification enums in reconciliation pure helpers');

  // ================================================================================
  // C12: Final receipt requires authoritative receipt evidence (final_receipt_exists)
  // ================================================================================
  const logC12NoReceipt = createMockLog({
    id: 112,
    status: 'GATE_OUT',
    final_receipt_exists: false,
  });
  const groupsC12 = buildVehicleVisitGroups([logC12NoReceipt]);
  const reconC12 = deriveVehicleReconciliationItems(groupsC12);
  assert(
    reconC12[0].isCompletedReceipt === false &&
    reconC12[0].physicalReceivedLiters === null,
    'C12: GATE_OUT without final_receipt_exists does NOT qualify as a completed receipt'
  );

  // ================================================================================
  // C13: Event timestamps formatted in Asia/Karachi
  // ================================================================================
  const testUtc = '2026-08-25T05:30:00.000Z';
  const formattedEvent = formatOperationalDatetime(testUtc);
  assert(
    formattedEvent.includes('25 Aug 2026') && formattedEvent.includes('10:30'),
    'C13: Event timestamp 2026-08-25T05:30:00Z formats to 25 Aug 2026, 10:30 am in Asia/Karachi'
  );

  // ================================================================================
  // C14: Business Date remains separate from Event Date/Time
  // ================================================================================
  const earlyMorningUtc = '2026-08-25T02:00:00.000Z'; // 07:00 AM PKT on 25-Aug -> Business Date 2026-08-24
  const eventStr = formatOperationalDatetime(earlyMorningUtc);
  const bDateStr = getOperationalBusinessDate(new Date(earlyMorningUtc));
  assert(
    eventStr.includes('25 Aug 2026') && eventStr.includes('07:00') && bDateStr === '2026-08-24',
    'C14: Event timestamp 25 Aug 2026, 07:00 am correctly maps to Business Date 2026-08-24'
  );

  // ================================================================================
  // C15: Filter mechanism preserves states
  // ================================================================================
  const allItems = [...reconC1, ...reconC2, ...reconC7, ...reconC8];
  const completedOnly = filterVehicleReconciliationItems(allItems, '', 'COMPLETED');
  const rejectedOnly = filterVehicleReconciliationItems(allItems, '', 'HAS_REJECTION');
  assert(
    completedOnly.length === 2 && rejectedOnly.length === 1,
    'C15: Filtering by reconciliation state filters items accurately without state mutation'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4DCTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
