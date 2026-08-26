import fs from 'fs';
import path from 'path';
import {
  buildVehicleVisitGroups,
  deriveHistoryTransactionItems,
  filterHistoryTransactionItems,
  generateHistoryCsv,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '../src/backend/core/types';
import { formatOperationalDatetime } from '../src/lib/datetime-utils';

async function run4DFTests() {
  console.log('================================================================================');
  console.log('STAGE 4D-F: ZMCC MANAGER HISTORY & REPORTS TEST SUITE');
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
      vehicle_number: 'LES-1234',
      token_number: 'TK-777',
      zonal_contractor_name: 'ZMCC Hasilpur',
      dispatch_date: '2026-08-25',
      status: 'DISPATCHED',
      calculated_status: 'ACCEPTED',
      rejection_reasons: null,
      remarks: null,
      borderline_warning: false,
      parallel_override_active: false,
      parallel_override_code: null,
      rm_mbrt_pending: false,
      first_weight_time: null,
      first_weight_of_vehicle: 24000,
      second_weight_time: null,
      second_weight_of_vehicle: 14000,
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
      dispatch_timestamp: '2026-08-25T04:00:00.000Z',
      gate_entry_timestamp: '2026-08-25T04:30:00.000Z',
      gate_exit_timestamp: null,
      first_weight_timestamp: '2026-08-25T05:00:00.000Z',
      second_weight_timestamp: '2026-08-25T06:00:00.000Z',
      unloading_start_timestamp: null,
      unloading_end_timestamp: null,
      final_receipt_exists: true,
      final_receipt_transaction_id: 901,
      final_receipt_timestamp: '2026-08-25T07:00:00.000Z',
      authoritative_final_liters: 9800,
      created_at: '2026-08-25T04:00:00.000Z',
      updated_at: '2026-08-25T07:00:00.000Z',
      ...overrides,
    };
  }

  // F1: History search matches Vehicle Number
  const logF1 = createMockLog({ id: 1, vehicle_number: 'LES-9999' });
  const itemsF1 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF1]));
  const searchMatchF1 = filterHistoryTransactionItems(itemsF1, '9999', 'ALL', 'ALL', 'ALL');
  const searchNoMatchF1 = filterHistoryTransactionItems(itemsF1, 'XYZ', 'ALL', 'ALL', 'ALL');
  assert(
    searchMatchF1.length === 1 && searchNoMatchF1.length === 0,
    'F1: History search matches Vehicle Number'
  );

  // F2: History search matches Token Number
  const logF2 = createMockLog({ id: 2, token_number: 'TK-888' });
  const itemsF2 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF2]));
  const searchMatchF2 = filterHistoryTransactionItems(itemsF2, '888', 'ALL', 'ALL', 'ALL');
  assert(
    searchMatchF2.length === 1,
    'F2: History search matches Token Number'
  );

  // F3: Visit/Dispatch Business Date controls history inclusion
  const logF3A = createMockLog({ id: 31, dispatch_date: '2026-08-24' });
  const logF3B = createMockLog({ id: 32, dispatch_date: '2026-08-25' });
  const itemsF3 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF3A, logF3B]));
  const filteredF3 = filterHistoryTransactionItems(itemsF3, '', 'ALL', 'ALL', 'ALL', '2026-08-25', '2026-08-25');
  assert(
    filteredF3.length === 1 && filteredF3[0].visitId === 32,
    'F3: Visit/Dispatch Business Date controls history inclusion'
  );

  // F4: Cross-date receipt does NOT change the original History Business Date
  const logF4 = createMockLog({
    id: 4,
    dispatch_date: '2026-08-23',
    final_receipt_exists: true,
    final_receipt_timestamp: '2026-08-25T04:00:00.000Z',
  });
  const itemsF4 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF4]));
  assert(
    itemsF4[0].businessDate === '2026-08-23' && itemsF4[0].finalReceiptBusinessDate === '2026-08-25',
    'F4: Cross-date receipt preserves original Visit/Dispatch Business Date (2026-08-23) in History'
  );

  // F5: Authoritative vehicle Gross Liters is used
  const logF5 = createMockLog({ id: 5, vehicle_dispatch_gross_liters: 10000 });
  const itemsF5 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF5]));
  assert(
    itemsF5[0].dispatchGrossLiters === 10000,
    'F5: Authoritative vehicle Gross Liters is used (10,000 L)'
  );

  // F6: Vehicle Gross null + portion sum exists -> History Gross unavailable
  const logF6P1 = createMockLog({ id: 6, portion_number: '1', dispatch_liters_gross: 4000, vehicle_dispatch_gross_liters: null });
  const logF6P2 = createMockLog({ id: 6, portion_number: '2', dispatch_liters_gross: 5000, vehicle_dispatch_gross_liters: null });
  const itemsF6 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF6P1, logF6P2]));
  assert(
    itemsF6[0].dispatchGrossLiters === null,
    'F6: Vehicle Gross null with portion sum 9,000 yields null History Gross (no portion fallback)'
  );

  // F7: Authoritative_final_liters is used for Physical Received
  const logF7 = createMockLog({ id: 7, authoritative_final_liters: 9800 });
  const itemsF7 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF7]));
  assert(
    itemsF7[0].physicalReceivedLiters === 9800,
    'F7: authoritative_final_liters is used for Physical Received (9,800 L)'
  );

  // F8: Authoritative_final_liters null + computed_plant_liters exists -> Physical Received unavailable
  const logF8 = createMockLog({ id: 8, authoritative_final_liters: null, computed_plant_liters: 9800 });
  const itemsF8 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF8]));
  assert(
    itemsF8[0].physicalReceivedLiters === null,
    'F8: authoritative_final_liters null with computed_plant_liters 9,800 yields null Physical Received'
  );

  // F9: Portion decisions (Accepted / Rejected / Hold / Pending) produce correct display summary
  const logF9P1 = createMockLog({ id: 9, portion_number: '1', calculated_status: 'ACCEPTED' });
  const logF9P2 = createMockLog({ id: 9, portion_number: '2', calculated_status: 'REJECTED' });
  const logF9P3 = createMockLog({ id: 9, portion_number: '3', calculated_status: 'HOLD' });
  const itemsF9 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF9P1, logF9P2, logF9P3]));
  assert(
    itemsF9[0].hasAccepted && itemsF9[0].hasRejection && itemsF9[0].hasHold &&
    itemsF9[0].portionQASummaryText.includes('Accepted') &&
    itemsF9[0].portionQASummaryText.includes('Rejected') &&
    itemsF9[0].portionQASummaryText.includes('Hold'),
    'F9: Portion decisions produce correct QA display summary (Accepted, Rejected, Hold)'
  );

  // F10: Vehicle workflow status cannot overwrite portion QA summary
  const logF10 = createMockLog({ id: 10, status: 'QA_ACCEPTED', calculated_status: 'HOLD' });
  const itemsF10 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF10]));
  assert(
    itemsF10[0].hasHold === true && itemsF10[0].hasAccepted === false,
    'F10: Vehicle status (QA_ACCEPTED) does not overwrite portion QA status (HOLD)'
  );

  // F11: Final Receipt exists only from final_receipt_exists authority
  const logF11 = createMockLog({ id: 11, status: 'COMPLETED', final_receipt_exists: false });
  const itemsF11 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF11]));
  assert(
    itemsF11[0].isCompletedReceipt === false,
    'F11: COMPLETED status without final_receipt_exists is NOT marked as completed receipt'
  );

  // F12: Receipt Pending remains second-weight + no receipt
  const logF12 = createMockLog({ id: 12, second_weight_of_vehicle: 14000, final_receipt_exists: false });
  const itemsF12 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF12]));
  assert(
    itemsF12[0].isReceiptPending === true,
    'F12: Second Weight + no final receipt qualifies as Receipt Pending'
  );

  // F13: Final @13 does NOT use computed_plant_13ts_liters (unavailable)
  const logF13 = createMockLog({ id: 13, computed_plant_13ts_liters: 9500 });
  const groupsF13 = buildVehicleVisitGroups([logF13]);
  assert(
    groupsF13[0].plant13TsLiters === null,
    'F13: Final @13 TS does not use computed_plant_13ts_liters (plant13TsLiters is null)'
  );

  // F14: Missing authoritative event timestamp displays unavailable
  const logF14 = createMockLog({ id: 14, final_receipt_timestamp: null });
  const itemsF14 = deriveHistoryTransactionItems(buildVehicleVisitGroups([logF14]));
  assert(
    itemsF14[0].finalReceiptTimestamp === null,
    'F14: Missing final receipt timestamp is null (renders as "—")'
  );

  // F15: Known authoritative UTC timestamp formats to Asia/Karachi
  const utcTs = '2026-08-25T05:30:00.000Z';
  const pktStr = formatOperationalDatetime(utcTs);
  assert(
    pktStr.includes('25 Aug 2026') && pktStr.includes('10:30'),
    'F15: UTC timestamp (2026-08-25T05:30:00Z) formats to Asia/Karachi (25 Aug 2026, 10:30 am)'
  );

  // F16: Business Date wording is used; no manager-facing Operational Date
  const histCompSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerHistoryReports.tsx'),
    'utf8'
  );
  assert(
    histCompSrc.includes('Business Date') && !histCompSrc.includes('Operational Date'),
    'F16: Component uses "Business Date" label and avoids "Operational Date"'
  );

  // F17: Read-only History component contains no mutation controls
  const hasMutationControls =
    histCompSrc.includes('handleAccept') ||
    histCompSrc.includes('handleReject') ||
    histCompSrc.includes('handleFinalize') ||
    histCompSrc.includes('handleCorrect') ||
    histCompSrc.includes('handleDelete') ||
    histCompSrc.includes('handleEdit') ||
    histCompSrc.includes('onApprove') ||
    histCompSrc.includes('onAcknowledge');
  assert(!hasMutationControls, 'F17: History & Reports component contains no mutation controls');

  // F18: Export/print dataset is derived from filtered source-scoped history data
  const csvOut = generateHistoryCsv(itemsF1, 'ZMCC Hasilpur');
  assert(
    csvOut.includes('Business Date') &&
    csvOut.includes('LES-9999') &&
    csvOut.includes('10000') &&
    csvOut.includes('9800'),
    'F18: CSV export output correctly formats filtered transaction records with authoritative data'
  );

  // F19: Loading/error/empty states are distinct in component
  assert(
    histCompSrc.includes('Loading historical transactions...') &&
    histCompSrc.includes('No historical records found') &&
    histCompSrc.includes('AlertTriangle'),
    'F19: Loading, empty, and error states are distinctly implemented in component'
  );

  // F20: History & Reports appears as the sixth workspace tab
  const wsSrc = fs.readFileSync(
    path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'),
    'utf8'
  );
  assert(
    wsSrc.includes("id: 'HISTORY'") &&
    wsSrc.includes('<ZMCCManagerHistoryReports') &&
    wsSrc.includes("activeTab === 'HISTORY'"),
    'F20: History & Reports is correctly registered and rendered as Tab 6 in ZMCCManagerWorkspace.tsx'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4DFTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
