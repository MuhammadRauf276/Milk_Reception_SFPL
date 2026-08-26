import fs from 'fs';
import path from 'path';
import {
  buildVehicleVisitGroups,
  deriveReceiptPerformanceItems,
  deriveReceiptsPerformanceSummary,
  filterReceiptPerformanceItems,
  filterCompletedReceiptsByDateRange,
  computeCompletedReceiptQuantityComparison,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function run4DETests() {
  console.log('================================================================================');
  console.log('STAGE 4D-E: ZMCC MANAGER RECEIPTS & PERFORMANCE TEST SUITE');
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
      dispatch_date: '2026-08-23',
      status: 'DISPATCHED',
      calculated_status: 'ACCEPTED',
      rejection_reasons: null,
      remarks: null,
      borderline_warning: false,
      parallel_override_active: false,
      parallel_override_code: null,
      rm_mbrt_pending: false,
      first_weight_time: null,
      first_weight_of_vehicle: 25000,
      second_weight_time: null,
      second_weight_of_vehicle: 15000,
      out_from_gate_time: null,
      reception_date: null,
      reception_start_time: null,
      reception_end_time: null,
      silo_storage_id: 'SILO-01',
      computed_dispatch_snf: 8.8,
      computed_dispatch_ts: 12.6,
      computed_dispatch_13ts_liters: 9700,
      computed_sampling_snf: 8.8,
      computed_sampling_ts: 12.6,
      computed_plant_liters: 9800,
      computed_net_milk_weight: 10000,
      computed_plant_13ts_liters: 9500,
      dispatch_kg_gross: null,
      dispatch_liters_gross: 10000,
      vehicle_dispatch_quantity_value: 10000,
      vehicle_dispatch_quantity_unit: 'LITER',
      vehicle_dispatch_quantity_basis: 'GROSS',
      vehicle_dispatch_gross_liters: 10000,
      dispatch_fat: 3.8,
      dispatch_lr: 28.5,
      sampling_fat: 3.8,
      sampling_lr: 28.5,
      b_mbrt_minutes_test: null,
      igp_date: null,
      igp_time: null,
      sampling_date: null,
      sampling_time_start: null,
      sampling_time_end: null,
      dispatch_timestamp: '2026-08-23T04:00:00.000Z',
      gate_entry_timestamp: null,
      gate_exit_timestamp: null,
      first_weight_timestamp: '2026-08-23T05:00:00.000Z',
      second_weight_timestamp: '2026-08-23T06:00:00.000Z',
      unloading_start_timestamp: null,
      unloading_end_timestamp: null,
      final_receipt_exists: true,
      final_receipt_transaction_id: 801,
      final_receipt_timestamp: '2026-08-24T03:00:00.000Z', // 24 Aug 08:00 AM PKT -> Business Date 2026-08-24
      authoritative_final_liters: 9800,
      created_at: '2026-08-23T04:00:00.000Z',
      updated_at: '2026-08-24T03:00:00.000Z',
      ...overrides,
    };
  }

  // E1: Authoritative Final Receipt exists -> Completed Receipt
  const logE1 = createMockLog({ id: 1, final_receipt_exists: true, final_receipt_timestamp: '2026-08-24T04:00:00.000Z', authoritative_final_liters: 9800 });
  const itemsE1 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE1]));
  assert(
    itemsE1[0].isCompletedReceipt === true && itemsE1[0].physicalReceivedLiters === 9800,
    'E1: Authoritative Final Receipt exists -> Completed Receipt'
  );

  // E2: COMPLETED status but no RECEIPT transaction -> NOT Completed Receipt
  const logE2 = createMockLog({ id: 2, status: 'COMPLETED', final_receipt_exists: false, final_receipt_timestamp: null, authoritative_final_liters: null });
  const itemsE2 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE2]));
  assert(
    itemsE2[0].isCompletedReceipt === false && itemsE2[0].physicalReceivedLiters === null,
    'E2: COMPLETED status without authoritative RECEIPT transaction -> NOT Completed Receipt'
  );

  // E3: Second Weight + no receipt -> Receipt Pending
  const logE3 = createMockLog({
    id: 3,
    second_weight_of_vehicle: 14500,
    final_receipt_exists: false,
    final_receipt_timestamp: null,
    authoritative_final_liters: null,
  });
  const itemsE3 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE3]));
  assert(
    itemsE3[0].isReceiptPending === true && itemsE3[0].isCompletedReceipt === false,
    'E3: Second Weight + no receipt -> Receipt Pending'
  );

  // E4: Final Receipt timestamp: 2026-08-23T21:30:00Z -> Event display 24 Aug 2026, 02:30 PKT, Final Receipt Business Date 2026-08-23
  const tsUtc = '2026-08-23T21:30:00.000Z';
  const eventStr = formatOperationalDatetime(tsUtc);
  const rBDate = getOperationalBusinessDate(new Date(tsUtc));
  assert(
    eventStr.includes('24 Aug 2026') && eventStr.includes('02:30') && rBDate === '2026-08-23',
    'E4: Final Receipt timestamp (2026-08-23T21:30:00Z) formats to 24 Aug 2026, 02:30 PKT with Business Date 2026-08-23'
  );

  // E5: Dispatch Business Date 23-Aug, Final Receipt Business Date 24-Aug, Selected receipt date 24-Aug -> included
  const logE5 = createMockLog({
    id: 5,
    dispatch_date: '2026-08-23',
    final_receipt_exists: true,
    final_receipt_timestamp: '2026-08-24T05:00:00.000Z', // Business Date 2026-08-24
    authoritative_final_liters: 9800,
  });
  const itemsE5 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE5]));
  const inPeriod24 = filterCompletedReceiptsByDateRange(itemsE5, '2026-08-24', '2026-08-24');
  const inPeriod23 = filterCompletedReceiptsByDateRange(itemsE5, '2026-08-23', '2026-08-23');
  assert(
    inPeriod24.length === 1 && inPeriod23.length === 0,
    'E5: Visit with Dispatch Date 23-Aug and Final Receipt Date 24-Aug is included when filtering receipt date 24-Aug'
  );

  // E6: Vehicle dispatch Gross = 10000, final physical = 9800 -> difference -200
  const logE6 = createMockLog({ id: 6, vehicle_dispatch_gross_liters: 10000, authoritative_final_liters: 9800 });
  const itemsE6 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE6]));
  assert(
    itemsE6[0].dispatchGrossLiters === 10000 &&
    itemsE6[0].physicalReceivedLiters === 9800 &&
    itemsE6[0].quantityDifferenceLiters === -200 &&
    itemsE6[0].quantityDifferenceText === '-200 L',
    'E6: Vehicle dispatch Gross 10,000 vs Final Physical 9,800 yields difference -200 L'
  );

  // E7: Vehicle Gross null, portion sum 9000, final 9800 -> comparison unavailable, no portion fallback
  const logE7P1 = createMockLog({ id: 7, portion_number: '1', dispatch_liters_gross: 4000, vehicle_dispatch_gross_liters: null, authoritative_final_liters: 9800 });
  const logE7P2 = createMockLog({ id: 7, portion_number: '2', dispatch_liters_gross: 5000, vehicle_dispatch_gross_liters: null, authoritative_final_liters: 9800 });
  const itemsE7 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE7P1, logE7P2]));
  assert(
    itemsE7[0].dispatchGrossLiters === null &&
    itemsE7[0].quantityDifferenceLiters === null &&
    itemsE7[0].quantityDifferenceText === '—',
    'E7: Vehicle Gross null with portion sum 9,000 yields unavailable comparison (no portion fallback)'
  );

  // E8: authoritative_final_liters null, computed_plant_liters 9800 -> final physical unavailable
  const logE8 = createMockLog({ id: 8, authoritative_final_liters: null, computed_plant_liters: 9800 });
  const itemsE8 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE8]));
  assert(
    itemsE8[0].physicalReceivedLiters === null &&
    itemsE8[0].quantityDifferenceLiters === null &&
    itemsE8[0].quantityDifferenceText === '—',
    'E8: authoritative_final_liters null with computed_plant_liters 9,800 yields unavailable physical received quantity'
  );

  // E9: Two complete comparable vehicles -> paired aggregate correct
  const logE9A = createMockLog({ id: 91, vehicle_dispatch_gross_liters: 5000, authoritative_final_liters: 4900, computed_dispatch_13ts_liters: 4800, computed_plant_13ts_liters: 4700 });
  const logE9B = createMockLog({ id: 92, vehicle_dispatch_gross_liters: 6000, authoritative_final_liters: 5900, computed_dispatch_13ts_liters: 5800, computed_plant_13ts_liters: 5700 });
  const itemsE9 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE9A, logE9B]));
  const summaryE9 = deriveReceiptsPerformanceSummary(itemsE9, '2026-08-24', '2026-08-24');
  assert(
    summaryE9.completedReceiptCount === 2 &&
    summaryE9.pairedComparison.dispatchGrossLiters === 11000 &&
    summaryE9.pairedComparison.finalPhysicalReceivedLiters === 10800 &&
    summaryE9.pairedComparison.differenceLiters === -200 &&
    summaryE9.pairedComparison.dispatch13TsLiters === 10600 &&
    summaryE9.pairedComparison.plant13TsLiters === 10400 &&
    summaryE9.pairedComparison.tsDifferenceLiters === -200,
    'E9: Two complete comparable vehicles produce correct paired aggregates (11,000 L vs 10,800 L -> -200 L)'
  );

  // E10: One required member missing -> all paired aggregate values null
  const logE10A = createMockLog({ id: 101, vehicle_dispatch_gross_liters: 5000, authoritative_final_liters: 4900 });
  const logE10B = createMockLog({ id: 102, vehicle_dispatch_gross_liters: 6000, authoritative_final_liters: null }); // Missing final
  const itemsE10 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE10A, logE10B]));
  const summaryE10 = deriveReceiptsPerformanceSummary(itemsE10, '2026-08-24', '2026-08-24');
  assert(
    summaryE10.pairedComparison.dispatchGrossLiters === null &&
    summaryE10.pairedComparison.finalPhysicalReceivedLiters === null &&
    summaryE10.pairedComparison.differenceLiters === null,
    'E10: When one member lacks final quantity, paired aggregates are null (no partial aggregation)'
  );

  // E11: Zero completed receipts -> count 0, quantity totals unavailable (not 0 L)
  const summaryEmpty = deriveReceiptsPerformanceSummary([], '2026-08-24', '2026-08-24');
  assert(
    summaryEmpty.completedReceiptCount === 0 &&
    summaryEmpty.pairedComparison.dispatchGrossLiters === null &&
    summaryEmpty.pairedComparison.finalPhysicalReceivedLiters === null &&
    summaryEmpty.pairedComparison.differenceLiters === null,
    'E11: Zero completed receipts produces count = 0 and null quantity totals (NOT 0 L)'
  );

  // E12: Dispatch @13 and Final @13 both present -> difference computed for same completed vehicle population
  const logE12 = createMockLog({ id: 12, computed_dispatch_13ts_liters: 9700, computed_plant_13ts_liters: 9500 });
  const itemsE12 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE12]));
  assert(
    itemsE12[0].dispatch13TsLiters === 9700 &&
    itemsE12[0].plant13TsLiters === 9500 &&
    itemsE12[0].tsDifferenceLiters === -200 &&
    itemsE12[0].tsDifferenceText === '-200 L',
    'E12: Dispatch @13 and Final @13 produce difference -200 L'
  );

  // E13: Missing @13 member -> aggregate unavailable / no partial aggregation
  const logE13A = createMockLog({ id: 131, computed_dispatch_13ts_liters: 5000, computed_plant_13ts_liters: 4900 });
  const logE13B = createMockLog({ id: 132, computed_dispatch_13ts_liters: 6000, computed_plant_13ts_liters: null }); // Missing plant @13
  const itemsE13 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE13A, logE13B]));
  const summaryE13 = deriveReceiptsPerformanceSummary(itemsE13, '2026-08-24', '2026-08-24');
  assert(
    summaryE13.pairedComparison.dispatch13TsLiters === null &&
    summaryE13.pairedComparison.plant13TsLiters === null &&
    summaryE13.pairedComparison.tsDifferenceLiters === null,
    'E13: Missing @13 member in completed population makes paired @13 TS aggregates null'
  );

  // E14: Destination silo displays authoritative value only
  const logE14 = createMockLog({ id: 14, silo_storage_id: 'SILO-SOUTH-04' });
  const itemsE14 = deriveReceiptPerformanceItems(buildVehicleVisitGroups([logE14]));
  assert(
    itemsE14[0].destinationSilo === 'SILO-SOUTH-04',
    'E14: Destination silo displays authoritative value ("SILO-SOUTH-04")'
  );

  // Component source checks for E15, E16, E17, E18, E19
  const compSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerReceiptsPerformance.tsx'),
    'utf8'
  );

  // E15: No receipt mutation controls
  const hasMutationControls =
    compSrc.includes('handleFinalize') ||
    compSrc.includes('handleCorrect') ||
    compSrc.includes('handleDelete') ||
    compSrc.includes('handleEdit') ||
    compSrc.includes('handleRepost') ||
    compSrc.includes('handleReallocate') ||
    compSrc.includes('onApprove') ||
    compSrc.includes('onAcknowledge');
  assert(!hasMutationControls, 'E15: Receipts & Performance component contains no mutation action controls');

  // E16 & E17: Loading & Error summary placeholder checks
  assert(
    compSrc.includes('showKpiPlaceholders ? \'—\' : summary.completedReceiptCount') ||
    compSrc.includes('showKpiPlaceholders ? "—" : summary.completedReceiptCount'),
    'E16 & E17: Summary KPI cards display placeholder "—" during loading or error'
  );

  // E18: Success-empty Completed count = 0 but Physical Received unavailable
  assert(
    summaryEmpty.completedReceiptCount === 0 && summaryEmpty.pairedComparison.finalPhysicalReceivedLiters === null,
    'E18: Success-empty summary produces Completed count = 0 and Physical Received = null'
  );

  // E19: Full locked labels
  assert(compSrc.includes('Physical Received Liters'), 'E19.1: Component uses "Physical Received Liters"');
  assert(compSrc.includes('Dispatch Liters @ 13% TS'), 'E19.2: Component uses "Dispatch Liters @ 13% TS"');
  assert(compSrc.includes('Final Liters @ 13% TS'), 'E19.3: Component uses "Final Liters @ 13% TS"');
  assert(compSrc.includes('First Weight (Loaded Vehicle)'), 'E19.4: Component uses "First Weight (Loaded Vehicle)"');
  assert(compSrc.includes('Second Weight (After Unloading)'), 'E19.5: Component uses "Second Weight (After Unloading)"');
  assert(compSrc.includes('Net Milk Weight'), 'E19.6: Component uses "Net Milk Weight"');
  assert(compSrc.includes('Final Receipt Business Date'), 'E19.7: Component uses "Final Receipt Business Date"');

  // Filter testing
  const allFilterItems = [...itemsE1, ...itemsE3, ...itemsE6];
  const completedOnly = filterReceiptPerformanceItems(allFilterItems, '', 'COMPLETED');
  const pendingOnly = filterReceiptPerformanceItems(allFilterItems, '', 'RECEIPT_PENDING');
  const diffOnly = filterReceiptPerformanceItems(allFilterItems, '', 'HAS_QUANTITY_DIFF');
  assert(
    completedOnly.length === 2 && pendingOnly.length === 1 && diffOnly.length === 2,
    'E20: Filtering by receipt state correctly filters items without mutation'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4DETests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
