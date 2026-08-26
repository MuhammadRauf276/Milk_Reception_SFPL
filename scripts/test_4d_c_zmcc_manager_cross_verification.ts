import fs from 'fs';
import path from 'path';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
  filterVehicleReconciliationItems,
  formatMetricDiff,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { isPlantLrTest, isPlantFatTest } from '../src/backend/services/vehicleQuantityService';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DCTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-C-R1: ZMCC MANAGER CROSS VERIFICATION AUTHORITY REGRESSION SUITE');
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
  // 1. FIX #1 & SECTION 4: VEHICLE DISPATCH QUANTITY AUTHORITY (10,000 L vs portions 4,000+5,000)
  // ================================================================================
  const logVAuthP1 = createMockLog({
    id: 100,
    portion_number: '1',
    dispatch_liters_gross: 4000,
    vehicle_dispatch_gross_liters: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 601,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: 9800,
  });
  const logVAuthP2 = createMockLog({
    id: 100,
    portion_number: '2',
    dispatch_liters_gross: 5000,
    vehicle_dispatch_gross_liters: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 601,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: 9800,
  });
  const groupsVAuth = buildVehicleVisitGroups([logVAuthP1, logVAuthP2]);
  const reconVAuth = deriveVehicleReconciliationItems(groupsVAuth);

  assert(
    reconVAuth[0].dispatchGrossLiters === 10000,
    'FIX #1.1: Vehicle authoritative dispatch uses vehicle_dispatch_gross_liters (10,000 L, NOT portions sum 9,000 L)'
  );
  assert(
    reconVAuth[0].quantityDifferenceLiters === -200 && reconVAuth[0].quantityDifferenceText === '-200 L',
    'FIX #1.2: Difference against 9,800 L Final Receipt is 9,800 - 10,000 = -200 L (NOT +800 L)'
  );

  // ================================================================================
  // 2. FIX #2 & SECTION 6: NO VEHICLE STATUS QA OVERWRITE (HOLD CONTAMINATION)
  // ================================================================================
  // Case 1: portion.calculated_status = HOLD, vehicle.status = QA_ACCEPTED -> displays HOLD, NOT ACCEPTED
  const logHoldContam = createMockLog({
    id: 201,
    portion_number: '1',
    calculated_status: 'HOLD',
    status: 'QA_ACCEPTED',
  });
  const reconHoldContam = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logHoldContam]));
  assert(
    reconHoldContam[0].portions[0].qaDecision === 'HOLD',
    'FIX #2.1: portion.calculated_status=HOLD with vehicle status=QA_ACCEPTED displays HOLD (NOT ACCEPTED)'
  );

  // Case 2: portion.calculated_status = PENDING, vehicle.status = READY_FOR_REJECT / REJECTED -> displays PENDING
  const logPendingContam = createMockLog({
    id: 202,
    portion_number: '1',
    calculated_status: 'PENDING',
    status: 'COMPLETED',
  });
  const reconPendingContam = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logPendingContam]));
  assert(
    reconPendingContam[0].portions[0].qaDecision === 'PENDING',
    'FIX #2.2: portion.calculated_status=PENDING with vehicle status=COMPLETED displays PENDING (no status overwrite)'
  );

  // ================================================================================
  // 3. FIX #3 & SECTION 8: STRICT PLANT LAB IDENTITY
  // ================================================================================
  // Plant LR: LT-000008 only
  assert(isPlantLrTest('LT-000008', 'Any Name') === true, 'FIX #3.1: LT-000008 is authoritative Plant LR');
  assert(isPlantLrTest('LT-000027', 'Lactometer Reading') === false, 'FIX #3.2: LT-000027 is NOT authoritative Plant LR');
  assert(isPlantLrTest('LT-999999', 'LR at 20 Celsius') === false, 'FIX #3.3: Name-based fallback "LR at 20 Celsius" with wrong ID is NOT Plant LR');

  // Plant Fat: LT-000026 only
  assert(isPlantFatTest('LT-000026', 'Any Name') === true, 'FIX #3.4: LT-000026 is authoritative Plant Fat');
  assert(isPlantFatTest('LT-000001', 'Fat') === false, 'FIX #3.5: LT-000001 (Temperature) is NOT Plant Fat');
  assert(isPlantFatTest('LT-000027', 'Fat') === false, 'FIX #3.6: LT-000027 is NOT authoritative Plant Fat');
  assert(isPlantFatTest('LT-999999', 'Fat %') === false, 'FIX #3.7: Name-based fallback "Fat %" with wrong ID is NOT Plant Fat');

  // ================================================================================
  // 4. FIX #4: LOCKED CROSS VERIFICATION LABELS
  // ================================================================================
  const compSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerCrossVerification.tsx'),
    'utf8'
  );

  assert(compSrc.includes('Physical Received Liters:'), 'FIX #4.1: Component uses "Physical Received Liters:" label');
  assert(!compSrc.includes('Final Physical Received:'), 'FIX #4.2: Component does NOT use "Final Physical Received:" label');
  assert(compSrc.includes('Dispatch Liters @ 13% TS:'), 'FIX #4.3: Component uses "Dispatch Liters @ 13% TS:" label');
  assert(compSrc.includes('Final Liters @ 13% TS:'), 'FIX #4.4: Component uses "Final Liters @ 13% TS:" label');
  assert(compSrc.includes('Business Date:'), 'FIX #4.5: Component uses "Business Date:" label');
  assert(!compSrc.includes('Operational Date'), 'FIX #4.6: Component does NOT use "Operational Date"');

  // ================================================================================
  // 5. FIX #5: LOADING / ERROR SUMMARY KPI PLACEHOLDERS
  // ================================================================================
  assert(
    compSrc.includes('showKpiPlaceholders ? \'—\' : summary.total') ||
    compSrc.includes('showKpiPlaceholders ? "—" : summary.total'),
    'FIX #5: Summary KPI cards display placeholder "—" during loading or error'
  );

  // ================================================================================
  // 6. CORE 4D-C CANONICAL RECONCILIATION CASES (C1 to C15)
  // ================================================================================

  // C1: Completed visit: 10,000 L Dispatch Gross vs 9,800 L Final Received -> Difference -200 L
  const logC1 = createMockLog({
    id: 101,
    dispatch_liters_gross: 10000,
    vehicle_dispatch_gross_liters: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 501,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: 9800,
  });
  const reconC1 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC1]));
  assert(
    reconC1[0].dispatchGrossLiters === 10000 &&
    reconC1[0].physicalReceivedLiters === 9800 &&
    reconC1[0].quantityDifferenceLiters === -200 &&
    reconC1[0].quantityDifferenceText === '-200 L',
    'C1: Completed visit: 10,000 L vs 9,800 L yields -200 L difference'
  );

  // C2: authoritative_final_liters = null, computed_plant_liters = 9800 -> Final Physical Received unavailable
  const logC2 = createMockLog({
    id: 102,
    dispatch_liters_gross: 10000,
    vehicle_dispatch_gross_liters: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    final_receipt_transaction_id: 502,
    final_receipt_timestamp: '2026-08-25T06:00:00.000Z',
    authoritative_final_liters: null,
    computed_plant_liters: 9800,
  });
  const reconC2 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC2]));
  assert(
    reconC2[0].physicalReceivedLiters === null &&
    reconC2[0].quantityDifferenceLiters === null &&
    reconC2[0].quantityDifferenceText === '—',
    'C2: authoritative_final_liters=null with computed_plant_liters=9800 yields unavailable received quantity'
  );

  // C3: Missing dispatch liters -> no direct quantity difference
  const logC3 = createMockLog({
    id: 103,
    dispatch_liters_gross: null,
    vehicle_dispatch_gross_liters: null,
    status: 'COMPLETED',
    final_receipt_exists: true,
    authoritative_final_liters: 9800,
  });
  const reconC3 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC3]));
  assert(
    reconC3[0].dispatchGrossLiters === null &&
    reconC3[0].quantityDifferenceLiters === null &&
    reconC3[0].quantityDifferenceText === '—',
    'C3: Missing dispatch liters yields no direct quantity difference'
  );

  // C4: Portion: Dispatch LR 28.0, Plant LR 28.4 -> LR difference +0.4
  const logC4 = createMockLog({
    id: 104,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: 28.4,
  });
  const reconC4 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC4]));
  assert(
    reconC4[0].portions[0].lrDiff === 0.4 &&
    reconC4[0].portions[0].lrDiffText === '+0.4',
    'C4: Portion Dispatch LR 28.0 vs Plant LR 28.4 yields LR difference +0.4'
  );

  // C5: Plant Fat 4.104, Dispatch Fat 4.100 -> +0.004 remains visibly non-zero
  const logC5 = createMockLog({
    id: 105,
    portion_number: '1',
    dispatch_fat: 4.100,
    sampling_fat: 4.104,
  });
  const reconC5 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC5]));
  assert(
    reconC5[0].portions[0].fatDiff === 0.004 &&
    reconC5[0].portions[0].fatDiffText === '+0.004%',
    'C5: Portion Plant Fat 4.104 vs Dispatch Fat 4.100 yields visibly non-zero +0.004%'
  );

  // C6: Missing Plant LR/Fat -> unavailable, no fallback
  const logC6 = createMockLog({
    id: 106,
    portion_number: '1',
    dispatch_lr: 28.0,
    sampling_lr: null,
    dispatch_fat: 3.8,
    sampling_fat: null,
  });
  const reconC6 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC6]));
  assert(
    reconC6[0].portions[0].plantLr === null &&
    reconC6[0].portions[0].plantFat === null &&
    reconC6[0].portions[0].lrDiffText === '—' &&
    reconC6[0].portions[0].fatDiffText === '—',
    'C6: Missing Plant LR/Fat results in unavailable plant results without fake fallbacks'
  );

  // C7: HOLD portion remains HOLD
  const logC7 = createMockLog({
    id: 107,
    portion_number: '1',
    calculated_status: 'HOLD',
  });
  const reconC7 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC7]));
  assert(
    reconC7[0].portions[0].qaDecision === 'HOLD' &&
    reconC7[0].hasHold === true,
    'C7: Portion in HOLD status remains HOLD in reconciliation'
  );

  // C8: Rejected Plant portion represented accurately
  const logC8 = createMockLog({
    id: 108,
    portion_number: '2',
    calculated_status: 'REJECTED',
    rejection_reasons: 'High Acidity & Clot on Boiling',
  });
  const reconC8 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC8]));
  assert(
    reconC8[0].portions[0].qaDecision === 'REJECTED' &&
    reconC8[0].hasRejection === true &&
    reconC8[0].portions[0].qaDecisionRemarks === 'High Acidity & Clot on Boiling',
    'C8: Rejected portion accurately shows REJECTED decision and rejection reasons'
  );

  // C9: No fake vehicle-level QA decision
  const logC9P1 = createMockLog({ id: 109, portion_number: '1', calculated_status: 'ACCEPTED' });
  const logC9P2 = createMockLog({ id: 109, portion_number: '2', calculated_status: 'REJECTED' });
  const reconC9 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC9P1, logC9P2]));
  assert(
    reconC9[0].portions[0].qaDecision === 'ACCEPTED' &&
    reconC9[0].portions[1].qaDecision === 'REJECTED' &&
    reconC9[0].portionCount === 2,
    'C9: Vehicle with mixed portions preserves separate portion-level QA decisions (no fake vehicle QA status)'
  );

  // C10 & C11: No quantity or quality tolerance in reconciliation logic
  const logC10 = createMockLog({
    id: 110,
    dispatch_liters_gross: 10000,
    status: 'COMPLETED',
    final_receipt_exists: true,
    authoritative_final_liters: 10000.01,
  });
  const reconC10 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC10]));
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

  // C12: Final receipt requires authoritative receipt evidence (final_receipt_exists)
  const logC12NoReceipt = createMockLog({
    id: 112,
    status: 'GATE_OUT',
    final_receipt_exists: false,
  });
  const reconC12 = deriveVehicleReconciliationItems(buildVehicleVisitGroups([logC12NoReceipt]));
  assert(
    reconC12[0].isCompletedReceipt === false &&
    reconC12[0].physicalReceivedLiters === null,
    'C12: GATE_OUT without final_receipt_exists does NOT qualify as a completed receipt'
  );

  // C13: Event timestamps formatted in Asia/Karachi
  const testUtc = '2026-08-25T05:30:00.000Z';
  const formattedEvent = formatOperationalDatetime(testUtc);
  assert(
    formattedEvent.includes('25 Aug 2026') && formattedEvent.includes('10:30'),
    'C13: Event timestamp 2026-08-25T05:30:00Z formats to 25 Aug 2026, 10:30 am in Asia/Karachi'
  );

  // C14: Business Date remains separate from Event Date/Time
  const earlyMorningUtc = '2026-08-25T02:00:00.000Z'; // 07:00 AM PKT on 25-Aug -> Business Date 2026-08-24
  const eventStr = formatOperationalDatetime(earlyMorningUtc);
  const bDateStr = getOperationalBusinessDate(new Date(earlyMorningUtc));
  assert(
    eventStr.includes('25 Aug 2026') && eventStr.includes('07:00') && bDateStr === '2026-08-24',
    'C14: Event timestamp 25 Aug 2026, 07:00 am correctly maps to Business Date 2026-08-24'
  );

  // C15: Filter mechanism preserves states
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
