import { prisma } from '../core/db';
import { MilkProcessLog, User, ProcessStatus, PortionLabTestResult } from '../core/types';
import { PLANT_TIMEZONE, isValidDateOnly, parseStrictDateOnly } from '@/lib/datetime-utils';
import { getOperationalBusinessDate, getPakistanCalendarDate } from '../core/business-day';
import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateAt13TSLiters,
} from '../utils/milkFormulas';
import {
  calculateVehicleReceivedQuantity,
  isPlantLrTest,
  isPlantFatTest,
  VehicleCalculationPortion,
} from './vehicleQuantityService';

export type RetrievalMode = 'live' | 'recent' | 'search' | 'report';

export interface OperationalLogFilters {
  mode?: RetrievalMode;
  page?: number;
  pageSize?: number;
  fromDate?: string;
  toDate?: string;
  contractor?: string;
  status?: string;
  search?: string;
  dateBasis?: 'dispatch' | 'reporting';
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasMore: boolean;
  page_size?: number;
  total_count?: number;
  total_pages?: number;
  has_more?: boolean;
}

export interface PaginatedOperationalLogs {
  items: MilkProcessLog[];
  logs: MilkProcessLog[];
  pagination: PaginationMeta;
  summary?: {
    totalVisits: number;
    completedVisits: number;
    activeInPlantVisits: number;
  };
  serverBusinessDate: string;
  serverCalendarDate?: string;
  metadata: {
    serverBusinessDate: string;
    serverCalendarDate?: string;
    serverTimestamp: string;
    mode: RetrievalMode;
    fromDate?: string;
    toDate?: string;
  };
}

/**
 * Returns default 7 calendar day date range [7 days ago, today] in PKT (Asia/Karachi).
 */
export function getDefaultRecentDateRange(): { fromDate: string; toDate: string } {
  const todayStr = getPakistanCalendarDate(new Date());
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const fromStr = getPakistanCalendarDate(d);
  return { fromDate: fromStr, toDate: todayStr };
}

function formatTimeOnly(ts?: Date | string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PLANT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function extractTestNumericValue(
  results: Array<{
    performance_status?: string | null;
    numeric_value?: any;
    lab_test?: { testCode?: string | null; testName?: string | null } | null;
  }>,
  matcher: (code?: string | null, name?: string | null) => boolean
): number | null {
  for (const r of results) {
    if (r.performance_status === 'PERFORMED' && r.numeric_value != null) {
      const code = r.lab_test?.testCode;
      const name = r.lab_test?.testName;
      if (matcher(code, name)) {
        const val = Number(r.numeric_value);
        if (!isNaN(val)) return val;
      }
    }
  }
  return null;
}

function isDispatchLrTest(code?: string | null, name?: string | null): boolean {
  return isPlantLrTest(code, name);
}

function isDispatchFatTest(code?: string | null, name?: string | null): boolean {
  return isPlantFatTest(code, name);
}

function isMbrtTest(code?: string | null, name?: string | null): boolean {
  if (code && code.trim().toUpperCase() === 'LT-000025') return true;
  if (name && name.trim().toUpperCase().includes('MBRT')) return true;
  return false;
}

function isConfiguredSnfTest(code?: string | null, name?: string | null): boolean {
  const c = (code || '').trim().toUpperCase();
  const n = (name || '').trim().toUpperCase();
  if (c === 'SNF' || c === 'LT-SNF') return true;
  if (n === 'SNF' || n.includes('SOLIDS-NOT-FAT') || n.includes('SOLIDS NOT FAT')) {
    if (!n.includes('RATIO')) return true;
  }
  return false;
}

function isConfiguredTsTest(code?: string | null, name?: string | null): boolean {
  const c = (code || '').trim().toUpperCase();
  const n = (name || '').trim().toUpperCase();
  if (c === 'TS' || c === 'LT-TS') return true;
  if (n === 'TS' || n === 'TOTAL SOLIDS' || n.includes('TOTAL SOLIDS')) {
    if (!n.includes('RATIO')) return true;
  }
  return false;
}


/**
 * Maps a single Prisma VehicleVisit (with relations) to flat, unit-safe MilkProcessLog[]
 */
export function mapVisitToLogs(
  visit: any,
  masterLabTests: Array<{
    id: bigint;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    displayOrder: number;
    isActive: boolean;
  }>
): MilkProcessLog[] {
  const logs: MilkProcessLog[] = [];
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthsOfYear = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const opDate = visit.operational_date ? new Date(visit.operational_date) : null;
  let dateStr: string | null = null;
  if (opDate && !isNaN(opDate.getTime())) {
    const y = opDate.getUTCFullYear().toString().padStart(4, '0');
    const m = (opDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = opDate.getUTCDate().toString().padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }

  // Authoritative Plant-Exit Business Date
  let finalizedBusinessDate: string | null = null;
  const hasPlantExit = Boolean(visit.gate_log?.exit_timestamp);

  if (hasPlantExit && visit.gate_log?.exit_timestamp) {
    finalizedBusinessDate = getOperationalBusinessDate(visit.gate_log.exit_timestamp);
  } else if (hasPlantExit && dateStr) {
    finalizedBusinessDate = dateStr;
  }

  // Dispatch Calendar Date
  let dispatchDateStr: string | null = null;
  const firstDispatchTs = visit.portions.find((p: any) => p.dispatch_info?.dispatch_timestamp)?.dispatch_info?.dispatch_timestamp;
  if (firstDispatchTs) {
    const dt = new Date(firstDispatchTs);
    if (!isNaN(dt.getTime())) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: PLANT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(dt);
      const pMap: Record<string, string> = {};
      for (const p of parts) pMap[p.type] = p.value;
      dispatchDateStr = `${pMap.year}-${pMap.month}-${pMap.day}`;
    }
  }
  const sourceName = visit.procurement_source?.name || 'ZMCC / Contractor';

  // Weights
  const firstWeightKg = visit.weight_ticket?.gross_weight_kg ? Number(visit.weight_ticket.gross_weight_kg) : null;
  const secondWeightKg = visit.weight_ticket?.tare_weight_kg ? Number(visit.weight_ticket.tare_weight_kg) : null;
  const netWeightKg = visit.weight_ticket?.net_weight_kg ? Number(visit.weight_ticket.net_weight_kg) : null;

  // Evaluate authoritative vehicle calculation if weights exist
  let vehicleCalcResult: ReturnType<typeof calculateVehicleReceivedQuantity> | null = null;
  if (firstWeightKg != null && secondWeightKg != null && firstWeightKg > secondWeightKg) {
    const calcPortions: VehicleCalculationPortion[] = visit.portions.map((p: any) => ({
      portionId: p.id,
      portionNumber: p.portion_number,
      plantDecision: p.plant_decision,
      plantLabResults: p.plant_lab_results.map((r: any) => ({
        testCode: r.lab_test?.testCode,
        testName: r.lab_test?.testName,
        numericValue: r.numeric_value ? Number(r.numeric_value) : null,
        performanceStatus: r.performance_status,
      })),
    }));

    vehicleCalcResult = calculateVehicleReceivedQuantity({
      grossWeightKg: firstWeightKg,
      secondWeightKg: secondWeightKg,
      portions: calcPortions,
    });
  }

  // Posted Silo receipt if finalized
  const finalizedReceipt = visit.inventory_transactions?.find((tx: any) => tx.transaction_type === 'RECEIPT');
  const finalPhysicalLiters = finalizedReceipt?.quantity_liters
    ? Number(finalizedReceipt.quantity_liters)
    : vehicleCalcResult?.isCalculable
    ? vehicleCalcResult.finalPhysicalLiters
    : null;

  const finalAt13TsLiters = vehicleCalcResult?.isCalculable
    ? vehicleCalcResult.finalAt13TSLiters
    : null;

  // Stage 6G-F: Authoritative Plant Final Quality & Commercial Snapshot
  const plantFinalNetKg = finalizedReceipt?.quantity_kg != null ? Number(finalizedReceipt.quantity_kg) : null;
  const plantFinalGrossLiters = finalizedReceipt?.quantity_liters != null ? Number(finalizedReceipt.quantity_liters) : null;
  const plantFinalLr = finalizedReceipt?.plant_composite_lr != null ? Number(finalizedReceipt.plant_composite_lr) : null;
  const plantFinalFat = finalizedReceipt?.plant_composite_fat != null ? Number(finalizedReceipt.plant_composite_fat) : null;
  const plantFinalDensity = finalizedReceipt?.plant_density != null ? Number(finalizedReceipt.plant_density) : null;
  const plantFinalSnf = finalizedReceipt?.plant_snf != null ? Number(finalizedReceipt.plant_snf) : null;
  const plantFinalTs = finalizedReceipt?.plant_ts != null ? Number(finalizedReceipt.plant_ts) : null;
  const plantFinalAt13TsLiters = finalizedReceipt?.plant_final_at_13ts_liters != null ? Number(finalizedReceipt.plant_final_at_13ts_liters) : null;
  const plantFinalCalculationVersion = finalizedReceipt?.plant_calculation_version || null;

  // Stage 6G-F: Source-Neutral Dual Reconciliation
  const recon = visit.dual_reconciliation;
  const reconciliationExists = Boolean(recon && finalizedReceipt);
  const sentGrossLiters = recon?.sent_gross_liters != null ? Number(recon.sent_gross_liters) : null;
  const receivedGrossLiters = recon?.received_gross_liters != null ? Number(recon.received_gross_liters) : null;
  const grossVarianceLiters = recon?.gross_variance_liters != null ? Number(recon.gross_variance_liters) : null;
  const grossVariancePercent = recon?.gross_variance_percent != null ? Number(recon.gross_variance_percent) : null;
  const sentAt13tsLiters = recon?.sent_at_13ts_liters != null ? Number(recon.sent_at_13ts_liters) : null;
  const receivedAt13tsLiters = recon?.received_at_13ts_liters != null ? Number(recon.received_at_13ts_liters) : null;
  const at13tsVarianceLiters = recon?.at_13ts_variance_liters != null ? Number(recon.at_13ts_variance_liters) : null;
  const at13tsVariancePercent = recon?.at_13ts_variance_percent != null ? Number(recon.at_13ts_variance_percent) : null;
  const reconciliationCalculationVersion = recon?.reconciliation_calculation_version || null;

  // Authoritative Whole-Vehicle Dispatch Quantity
  const vDeclaredVal = visit.vehicle_dispatch_quantity_value != null ? Number(visit.vehicle_dispatch_quantity_value) : null;
  const vDeclaredUnit = visit.vehicle_dispatch_quantity_unit ? visit.vehicle_dispatch_quantity_unit.toUpperCase() : null;
  const vDeclaredBasis = visit.vehicle_dispatch_quantity_basis || null;

  let vehicleDispatchGrossLiters: number | null = null;
  if (visit.vehicle_dispatch_gross_liters != null) {
    vehicleDispatchGrossLiters = Number(visit.vehicle_dispatch_gross_liters);
  } else if (vDeclaredVal != null) {
    if (vDeclaredUnit === 'LITER') {
      vehicleDispatchGrossLiters = vDeclaredVal;
    } else if (vDeclaredUnit === 'KG') {
      const firstPortionWithLr = visit.portions.find((p: any) =>
        extractTestNumericValue(p.dispatch_lab_results, isDispatchLrTest) != null
      );
      const vLr = firstPortionWithLr
        ? extractTestNumericValue(firstPortionWithLr.dispatch_lab_results, isDispatchLrTest)
        : null;
      if (vLr != null) {
        const density = calculateDensity(vLr);
        vehicleDispatchGrossLiters = Number((vDeclaredVal / density).toFixed(2));
      }
    }
  }

  for (const portion of visit.portions) {
    const portionStr = `P-${String(portion.portion_number).padStart(2, '0')}`;
    const declaredVal = portion.dispatch_quantity_value ? Number(portion.dispatch_quantity_value) : null;
    const declaredUnit = portion.dispatch_quantity_unit ? portion.dispatch_quantity_unit.toUpperCase() : null;

    // Dispatch QA
    const dFat = extractTestNumericValue(portion.dispatch_lab_results, isDispatchFatTest);
    const dLr = extractTestNumericValue(portion.dispatch_lab_results, isDispatchLrTest);

    // Unit-safe dispatch gross liters
    let dispatchGrossLiters: number | null = null;
    if (declaredVal != null) {
      if (declaredUnit === 'LITER') {
        dispatchGrossLiters = declaredVal;
      } else if (declaredUnit === 'KG') {
        if (dLr != null) {
          const density = calculateDensity(dLr);
          dispatchGrossLiters = Number((declaredVal / density).toFixed(2));
        }
      }
    }

    // Canonical Dispatch SNF / TS
    let computedDispatchSnf: number | null = null;
    let computedDispatchTs: number | null = null;
    let computedDispatch13tsLiters: number | null = null;

    if (dFat != null && dLr != null) {
      computedDispatchSnf = Number(calculateSNF(dLr, dFat).toFixed(3));
      computedDispatchTs = Number(calculateTS(dFat, computedDispatchSnf).toFixed(3));
      if (dispatchGrossLiters != null) {
        computedDispatch13tsLiters = Number(calculateAt13TSLiters(dispatchGrossLiters, computedDispatchTs).toFixed(2));
      }
    }

    // Plant QA
    const pFat = extractTestNumericValue(portion.plant_lab_results, isPlantFatTest);
    const pLr = extractTestNumericValue(portion.plant_lab_results, isPlantLrTest);
    const pMbrt = extractTestNumericValue(portion.plant_lab_results, isMbrtTest);

    // Canonical Plant SNF / TS
    let computedPlantSnf: number | null = null;
    let computedPlantTs: number | null = null;

    if (pFat != null && pLr != null) {
      computedPlantSnf = Number(calculateSNF(pLr, pFat).toFixed(3));
      computedPlantTs = Number(calculateTS(pFat, computedPlantSnf).toFixed(3));
    }

    // Portion decision
    const plantDecision = portion.plant_decision || null;

    // Silo assignment
    const unloadingLog = portion.unloading_log;
    const siloStorageId = unloadingLog?.silo?.silo_code || unloadingLog?.silo_number || null;

    // Borderline warning
    const activeSnf = computedPlantSnf ?? computedDispatchSnf;
    const isBorderline = activeSnf != null && activeSnf >= 8.5 && activeSnf <= 8.6;

    const finalReceiptTs = finalizedReceipt?.operational_timestamp
      ? new Date(finalizedReceipt.operational_timestamp).toISOString()
      : null;

    const finalReceiptDate = (Boolean(finalizedReceipt) && finalReceiptTs)
      ? getPakistanCalendarDate(finalReceiptTs)
      : null;

    const reportingDate = Boolean(finalizedReceipt)
      ? finalReceiptDate
      : dispatchDateStr;

    // Build dynamic configured and historical lab test results for this portion
    const dispatchResultMap = new Map<string, (typeof portion.dispatch_lab_results)[0]>();
    for (const dr of portion.dispatch_lab_results) {
      if (dr.test_id != null) {
        dispatchResultMap.set(String(dr.test_id), dr);
      }
      if (dr.lab_test?.testCode) {
        dispatchResultMap.set(dr.lab_test.testCode.trim().toUpperCase(), dr);
      }
      if (dr.lab_test?.testName) {
        dispatchResultMap.set(dr.lab_test.testName.trim().toLowerCase(), dr);
      }
    }

    const plantResultMap = new Map<string, (typeof portion.plant_lab_results)[0]>();
    for (const pr of portion.plant_lab_results) {
      if (pr.test_id != null) {
        plantResultMap.set(String(pr.test_id), pr);
      }
      if (pr.lab_test?.testCode) {
        plantResultMap.set(pr.lab_test.testCode.trim().toUpperCase(), pr);
      }
      if (pr.lab_test?.testName) {
        plantResultMap.set(pr.lab_test.testName.trim().toLowerCase(), pr);
      }
    }

    const portionLabResults: PortionLabTestResult[] = [];

    for (const t of masterLabTests) {
      const testIdStr = String(t.id);
      const codeKey = t.testCode.trim().toUpperCase();
      const nameKey = t.testName.trim().toLowerCase();

      const dRes = dispatchResultMap.get(testIdStr) || dispatchResultMap.get(codeKey) || dispatchResultMap.get(nameKey);
      const pRes = plantResultMap.get(testIdStr) || plantResultMap.get(codeKey) || plantResultMap.get(nameKey);

      const isApplicable = t.isActive || Boolean(dRes) || Boolean(pRes);
      if (!isApplicable) continue;

      const isDisFat = isDispatchFatTest(t.testCode, t.testName);
      const isDisLr = isDispatchLrTest(t.testCode, t.testName);
      const isDisSnf = isConfiguredSnfTest(t.testCode, t.testName);
      const isDisTs = isConfiguredTsTest(t.testCode, t.testName);

      let dNumeric: number | null = null;
      if (dRes?.numeric_value != null) {
        dNumeric = Number(dRes.numeric_value);
      } else if (isDisFat && dFat != null) {
        dNumeric = dFat;
      } else if (isDisLr && dLr != null) {
        dNumeric = dLr;
      } else if (isDisSnf && computedDispatchSnf != null) {
        dNumeric = computedDispatchSnf;
      } else if (isDisTs && computedDispatchTs != null) {
        dNumeric = computedDispatchTs;
      }

      const dText = dRes?.text_value || null;
      const dPerformed = Boolean(
        (dRes && dRes.performance_status === 'PERFORMED') ||
        dNumeric != null ||
        (dText != null && dText !== '')
      );

      const isPlFat = isPlantFatTest(t.testCode, t.testName);
      const isPlLr = isPlantLrTest(t.testCode, t.testName);
      const isPlMbrt = isMbrtTest(t.testCode, t.testName);
      const isPlSnf = isConfiguredSnfTest(t.testCode, t.testName);
      const isPlTs = isConfiguredTsTest(t.testCode, t.testName);

      let pNumeric: number | null = null;
      if (pRes?.numeric_value != null) {
        pNumeric = Number(pRes.numeric_value);
      } else if (isPlFat && pFat != null) {
        pNumeric = pFat;
      } else if (isPlLr && pLr != null) {
        pNumeric = pLr;
      } else if (isPlMbrt && pMbrt != null) {
        pNumeric = pMbrt;
      } else if (isPlSnf && computedPlantSnf != null) {
        pNumeric = computedPlantSnf;
      } else if (isPlTs && computedPlantTs != null) {
        pNumeric = computedPlantTs;
      }

      const pText = pRes?.text_value || null;
      const pPerformed = Boolean(
        (pRes && pRes.performance_status === 'PERFORMED') ||
        pNumeric != null ||
        (pText != null && pText !== '')
      );

      let plantStatus: string | null = null;
      if (pRes?.is_passed === true) {
        plantStatus = 'PASSED';
      } else if (pRes?.is_passed === false) {
        plantStatus = 'REJECTED';
      } else if (pRes?.performance_status) {
        plantStatus = pRes.performance_status;
      } else if ((isPlSnf || isPlTs) && pNumeric != null) {
        plantStatus = 'CALCULATED';
      }

      portionLabResults.push({
        test_id: Number(t.id) || null,
        test_code: t.testCode,
        test_name: t.testName,
        result_type: t.resultType,
        unit: t.unit || null,
        display_order: t.displayOrder,
        is_active: t.isActive,
        dispatch_performed: dPerformed,
        dispatch_numeric_value: dNumeric,
        dispatch_text_value: dText,
        plant_performed: pPerformed,
        plant_numeric_value: pNumeric,
        plant_text_value: pText,
        plant_status: plantStatus,
        plant_is_passed: pRes?.is_passed ?? null,
      });
    }

    // Add calculated SNF and TS if not explicitly represented by configured tests
    if (!portionLabResults.some((r) => isConfiguredSnfTest(r.test_code, r.test_name))) {
      portionLabResults.push({
        test_code: 'SNF',
        test_name: 'Solids-Not-Fat (SNF)',
        result_type: 'CALCULATED',
        unit: '%',
        display_order: 998,
        is_active: true,
        dispatch_performed: computedDispatchSnf != null,
        dispatch_numeric_value: computedDispatchSnf,
        dispatch_text_value: null,
        plant_performed: computedPlantSnf != null,
        plant_numeric_value: computedPlantSnf,
        plant_text_value: null,
        plant_status: computedPlantSnf != null ? 'CALCULATED' : null,
        plant_is_passed: null,
      });
    }

    if (!portionLabResults.some((r) => isConfiguredTsTest(r.test_code, r.test_name))) {
      portionLabResults.push({
        test_code: 'TS',
        test_name: 'Total Solids (TS)',
        result_type: 'CALCULATED',
        unit: '%',
        display_order: 999,
        is_active: true,
        dispatch_performed: computedDispatchTs != null,
        dispatch_numeric_value: computedDispatchTs,
        dispatch_text_value: null,
        plant_performed: computedPlantTs != null,
        plant_numeric_value: computedPlantTs,
        plant_text_value: null,
        plant_status: computedPlantTs != null ? 'CALCULATED' : null,
        plant_is_passed: null,
      });
    }

    const logRow: MilkProcessLog = {
      id: Number(visit.id) || 0,
      portion_id: Number(portion.id) || null,
      visit_number: visit.visit_number || null,
      reception_number: visit.reception_number || null,
      vehicle_number: visit.vehicle_number || '',
      portion_number: portionStr,
      token_number: visit.token_number || null,
      zonal_contractor_name: sourceName,
      status: (visit.current_status as ProcessStatus) || 'DISPATCHED',
      business_date: finalizedBusinessDate,

      dispatch_date: dispatchDateStr,
      dispatch_day: dispatchDateStr
        ? daysOfWeek[new Date(`${dispatchDateStr}T12:00:00Z`).getUTCDay()]
        : null,
      dispatch_week: dispatchDateStr
        ? Math.ceil(new Date(`${dispatchDateStr}T12:00:00Z`).getUTCDate() / 7) + 28
        : null,
      dispatch_month: dispatchDateStr
        ? monthsOfYear[new Date(`${dispatchDateStr}T12:00:00Z`).getUTCMonth()]
        : null,
      dispatch_year: dispatchDateStr
        ? new Date(`${dispatchDateStr}T12:00:00Z`).getUTCFullYear()
        : null,
      zonal_contractor_dispatch_time: formatTimeOnly(portion.dispatch_info?.dispatch_timestamp),
      dispatch_kg_gross: declaredUnit === 'KG' ? declaredVal : null,
      dispatch_liters_gross: dispatchGrossLiters,
      vehicle_dispatch_quantity_value: vDeclaredVal,
      vehicle_dispatch_quantity_unit: vDeclaredUnit,
      vehicle_dispatch_quantity_basis: vDeclaredBasis,
      vehicle_dispatch_lr: visit.vehicle_dispatch_lr != null ? Number(visit.vehicle_dispatch_lr) : null,
      vehicle_dispatch_fat: visit.vehicle_dispatch_fat != null ? Number(visit.vehicle_dispatch_fat) : null,
      vehicle_dispatch_density: visit.vehicle_dispatch_density != null ? Number(visit.vehicle_dispatch_density) : null,
      vehicle_dispatch_gross_liters: vehicleDispatchGrossLiters,
      vehicle_dispatch_snf: visit.vehicle_dispatch_snf != null ? Number(visit.vehicle_dispatch_snf) : null,
      vehicle_dispatch_ts: visit.vehicle_dispatch_ts != null ? Number(visit.vehicle_dispatch_ts) : null,
      vehicle_dispatch_at_13ts_liters: visit.vehicle_dispatch_at_13ts_liters != null ? Number(visit.vehicle_dispatch_at_13ts_liters) : null,
      vehicle_dispatch_calculation_version: visit.vehicle_dispatch_calculation_version || null,
      dispatch_tests: null,
      dispatch_fat: dFat,
      dispatch_lr: dLr,

      igp_date: visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp).toISOString().split('T')[0] : null,
      igp_time: formatTimeOnly(visit.gate_log?.entry_timestamp),
      out_from_gate_time: formatTimeOnly(visit.gate_log?.exit_timestamp),

      sampling_date: portion.plant_lab_results.length > 0 && portion.plant_lab_results[0].sample_timestamp
        ? new Date(portion.plant_lab_results[0].sample_timestamp).toISOString().split('T')[0]
        : null,
      sampling_time_start: formatTimeOnly(portion.plant_lab_results[0]?.sample_timestamp),
      sampling_time_end: formatTimeOnly(portion.plant_lab_results[0]?.result_timestamp),
      sampling_fat: pFat,
      sampling_lr: pLr,
      b_mbrt_minutes_test: pMbrt,
      calculated_status: plantDecision,
      rejection_reasons: portion.plant_rejection_reason || null,
      borderline_warning: isBorderline,

      first_weight_time: formatTimeOnly(visit.weight_ticket?.gross_timestamp),
      first_weight_of_vehicle: firstWeightKg,
      second_weight_time: formatTimeOnly(visit.weight_ticket?.tare_timestamp),
      second_weight_of_vehicle: secondWeightKg,

      reception_date: unloadingLog?.pump_start_timestamp ? new Date(unloadingLog.pump_start_timestamp).toISOString().split('T')[0] : null,
      reception_start_time: formatTimeOnly(unloadingLog?.pump_start_timestamp),
      reception_end_time: formatTimeOnly(unloadingLog?.pump_end_timestamp),
      silo_storage_id: siloStorageId,

      computed_dispatch_snf: computedDispatchSnf,
      computed_dispatch_ts: computedDispatchTs,
      computed_dispatch_13ts_liters: computedDispatch13tsLiters,
      computed_sampling_snf: computedPlantSnf,
      computed_sampling_ts: computedPlantTs,
      computed_plant_liters: finalPhysicalLiters,
      computed_net_milk_weight: netWeightKg,
      computed_plant_13ts_liters: finalAt13TsLiters,

      // Authoritative Event Timestamps (ISO Instants)
      dispatch_timestamp: portion.dispatch_info?.dispatch_timestamp
        ? new Date(portion.dispatch_info.dispatch_timestamp).toISOString()
        : null,
      gate_entry_timestamp: visit.gate_log?.entry_timestamp
        ? new Date(visit.gate_log.entry_timestamp).toISOString()
        : null,
      gate_exit_timestamp: visit.gate_log?.exit_timestamp
        ? new Date(visit.gate_log.exit_timestamp).toISOString()
        : null,
      first_weight_timestamp: visit.weight_ticket?.gross_timestamp
        ? new Date(visit.weight_ticket.gross_timestamp).toISOString()
        : null,
      second_weight_timestamp: visit.weight_ticket?.tare_timestamp
        ? new Date(visit.weight_ticket.tare_timestamp).toISOString()
        : null,
      unloading_start_timestamp: unloadingLog?.pump_start_timestamp
        ? new Date(unloadingLog.pump_start_timestamp).toISOString()
        : null,
      unloading_end_timestamp: unloadingLog?.pump_end_timestamp
        ? new Date(unloadingLog.pump_end_timestamp).toISOString()
        : null,

      // Authoritative Final Receipt (Silo Transaction Evidence)
      final_receipt_exists: Boolean(finalizedReceipt),
      final_receipt_transaction_id: finalizedReceipt ? Number(finalizedReceipt.id) : null,
      final_receipt_timestamp: finalReceiptTs,
      final_receipt_date: finalReceiptDate,
      reporting_date: reportingDate,
      authoritative_final_liters: finalizedReceipt?.quantity_liters
        ? Number(finalizedReceipt.quantity_liters)
        : null,

      // Stage 6G-F: Authoritative Plant Final Quality & Commercial Snapshot
      plant_final_net_kg: plantFinalNetKg,
      plant_final_lr: plantFinalLr,
      plant_final_fat: plantFinalFat,
      plant_final_density: plantFinalDensity,
      plant_final_snf: plantFinalSnf,
      plant_final_ts: plantFinalTs,
      plant_final_gross_liters: plantFinalGrossLiters,
      plant_final_at_13ts_liters: plantFinalAt13TsLiters,
      plant_final_calculation_version: plantFinalCalculationVersion,

      // Stage 6G-F: Source-Neutral Dual Reconciliation
      reconciliation_exists: reconciliationExists,
      sent_gross_liters: sentGrossLiters,
      received_gross_liters: receivedGrossLiters,
      gross_variance_liters: grossVarianceLiters,
      gross_variance_percent: grossVariancePercent,
      sent_at_13ts_liters: sentAt13tsLiters,
      received_at_13ts_liters: receivedAt13tsLiters,
      at_13ts_variance_liters: at13tsVarianceLiters,
      at_13ts_variance_percent: at13tsVariancePercent,
      reconciliation_calculation_version: reconciliationCalculationVersion,

      portion_lab_results: portionLabResults,

      created_at: visit.created_at ? new Date(visit.created_at).toISOString() : new Date().toISOString(),
      updated_at: visit.updated_at ? new Date(visit.updated_at).toISOString() : new Date().toISOString(),
    };

    logs.push(logRow);
  }

  return logs;
}

/**
 * Standard query builder and pagination executor for operational read logs.
 */
export async function getPaginatedOperationalLogs(
  filters?: OperationalLogFilters,
  currentUser?: User | null
): Promise<PaginatedOperationalLogs> {
  const mode: RetrievalMode = filters?.mode || 'recent';
  const conditions: any[] = [];

  // 1. Role-based scoping (Fail closed for source-scoped roles)
  if (currentUser?.role === 'CONTRACTOR_MANAGER' || currentUser?.role === 'CONTRACTOR_OPERATOR') {
    if (currentUser.procurement_source_id) {
      conditions.push({
        procurement_source: {
          id: BigInt(currentUser.procurement_source_id),
          source_type: 'CONTRACTOR',
        },
      });
    } else {
      conditions.push({ procurement_source_id: BigInt(-1) });
    }
  } else if (currentUser?.role === 'ZMCC_MANAGER' || currentUser?.role === 'ZMCC_LAB_ATTENDANT') {
    if (currentUser.procurement_source_id) {
      conditions.push({
        procurement_source: {
          id: BigInt(currentUser.procurement_source_id),
          source_type: 'ZMCC',
        },
      });
    } else {
      conditions.push({ procurement_source_id: BigInt(-1) });
    }
  }

  // 2. Contractor filter for non-scoped roles (e.g. Super Admin)
  if (filters?.contractor && filters.contractor !== 'ALL') {
    const isScoped =
      currentUser?.role === 'CONTRACTOR_MANAGER' ||
      currentUser?.role === 'CONTRACTOR_OPERATOR' ||
      currentUser?.role === 'ZMCC_MANAGER' ||
      currentUser?.role === 'ZMCC_LAB_ATTENDANT';
    if (!isScoped) {
      conditions.push({
        procurement_source: {
          OR: [
            { code: filters.contractor },
            { name: filters.contractor },
          ],
        },
      });
    }
  }

  // 3. Retrieval Mode classification & Date Bounds
  let effectiveFromDate: string | undefined = filters?.fromDate;
  let effectiveToDate: string | undefined = filters?.toDate;

  if (mode === 'live') {
    // Mode LIVE: Active in-flight pipeline only. Gate exit has not occurred.
    conditions.push({ current_status: { notIn: ['COMPLETED', 'CANCELLED'] } });
    conditions.push({
      OR: [
        { gate_log: null },
        { gate_log: { exit_timestamp: null } },
      ],
    });
  } else if (mode === 'recent') {
    // Mode RECENT: Default to last 7 calendar days in PKT if no date specified.
    if (!effectiveFromDate && !effectiveToDate) {
      const recent = getDefaultRecentDateRange();
      effectiveFromDate = recent.fromDate;
      effectiveToDate = recent.toDate;
    }
  }

  // Date validation
  if (effectiveFromDate !== undefined || effectiveToDate !== undefined) {
    if (effectiveFromDate !== undefined && effectiveToDate !== undefined && effectiveFromDate > effectiveToDate) {
      throw new Error('From Date cannot be after To Date.');
    }
    if (effectiveFromDate !== undefined && !isValidDateOnly(effectiveFromDate)) {
      throw new Error('Invalid fromDate parameter');
    }
    if (effectiveToDate !== undefined && !isValidDateOnly(effectiveToDate)) {
      throw new Error('Invalid toDate parameter');
    }

    const startUtc = effectiveFromDate ? new Date(`${effectiveFromDate}T00:00:00.000+05:00`) : undefined;
    const endUtc = effectiveToDate ? new Date(`${effectiveToDate}T23:59:59.999+05:00`) : undefined;

    const timeRangeCond: any = {};
    if (startUtc) timeRangeCond.gte = startUtc;
    if (endUtc) timeRangeCond.lte = endUtc;

    if (filters?.dateBasis === 'reporting') {
      conditions.push({
        OR: [
          // Case A: Completed/finalized visit with authoritative receipt in range
          {
            inventory_transactions: {
              some: {
                transaction_type: 'RECEIPT',
                operational_timestamp: timeRangeCond,
              },
            },
          },
          // Case B: Pending/not-finalized visit (no receipt exists) with dispatch in range
          {
            inventory_transactions: {
              none: {
                transaction_type: 'RECEIPT',
              },
            },
            portions: {
              some: {
                dispatch_info: {
                  dispatch_timestamp: timeRangeCond,
                },
              },
            },
          },
        ],
      });
    } else {
      conditions.push({
        portions: {
          some: {
            dispatch_info: {
              dispatch_timestamp: timeRangeCond,
            },
          },
        },
      });
    }
  }

  // 4. Status Filter
  if (filters?.status && filters.status !== 'ALL') {
    const stUpper = filters.status.toUpperCase();
    if (stUpper === 'ACCEPTED' || stUpper === 'REJECTED') {
      conditions.push({
        portions: {
          some: { plant_decision: stUpper },
        },
      });
    } else {
      conditions.push({
        current_status: { contains: filters.status, mode: 'insensitive' },
      });
    }
  }

  // 5. Search Filter in DB
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim();
    conditions.push({
      OR: [
        { vehicle_number: { contains: q, mode: 'insensitive' } },
        { token_number: { contains: q, mode: 'insensitive' } },
        { visit_number: { contains: q, mode: 'insensitive' } },
        { reception_number: { contains: q, mode: 'insensitive' } },
        { procurement_source: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const whereClause: any = conditions.length > 0 ? { AND: conditions } : {};

  // 6. Pagination Bounds
  const defaultPageSize = mode === 'live' ? 100 : 20;
  const page = Math.max(1, Number(filters?.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize) || defaultPageSize));
  const skip = (page - 1) * pageSize;

  // 7. Parallel fetch: count + master tests + page of visits + summary aggregates
  const [totalRecords, masterLabTests, visits, completedVisits, activeInPlantVisits] = await Promise.all([
    prisma.vehicleVisit.count({ where: whereClause }),
    prisma.labTest.findMany({
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.vehicleVisit.findMany({
      where: whereClause,
      include: {
        procurement_source: true,
        gate_log: true,
        weight_ticket: true,
        portions: {
          orderBy: { portion_number: 'asc' },
          include: {
            dispatch_info: true,
            dispatch_lab_results: {
              include: { lab_test: true },
            },
            plant_lab_results: {
              include: { lab_test: true },
            },
            unloading_log: {
              include: { silo: true },
            },
          },
        },
        inventory_transactions: {
          where: { transaction_type: 'RECEIPT' },
        },
        dual_reconciliation: true,
      },
      orderBy: { id: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.vehicleVisit.count({
      where: {
        AND: [
          ...conditions,
          { inventory_transactions: { some: { transaction_type: 'RECEIPT' } } },
        ],
      },
    }),
    prisma.vehicleVisit.count({
      where: {
        AND: [
          ...conditions,
          { current_status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        ],
      },
    }),
  ]);

  // 8. Map to logs
  const pageLogs: MilkProcessLog[] = [];
  for (const visit of visits) {
    const mapped = mapVisitToLogs(visit, masterLabTests);
    pageLogs.push(...mapped);
  }

  const serverBusinessDate = getOperationalBusinessDate(new Date());
  const serverCalendarDate = getPakistanCalendarDate(new Date());
  const totalPages = totalRecords === 0 ? 1 : Math.ceil(totalRecords / pageSize);
  const hasMore = page < totalPages;

  const meta: PaginationMeta = {
    page,
    pageSize,
    totalRecords,
    totalPages,
    hasMore,
    page_size: pageSize,
    total_count: totalRecords,
    total_pages: totalPages,
    has_more: hasMore,
  };

  return {
    items: pageLogs,
    logs: pageLogs,
    pagination: meta,
    summary: {
      totalVisits: totalRecords,
      completedVisits,
      activeInPlantVisits,
    },
    serverBusinessDate,
    serverCalendarDate,
    metadata: {
      serverBusinessDate,
      serverCalendarDate,
      serverTimestamp: new Date().toISOString(),
      mode,
      fromDate: effectiveFromDate,
      toDate: effectiveToDate,
    },
  };
}

/**
 * Maps normalized Prisma database models to flat, unit-safe MilkProcessLog[]
 * Preserves backwards compatibility for existing callers.
 */
export async function getOperationalLogs(
  filters?: OperationalLogFilters,
  currentUser?: User | null
): Promise<MilkProcessLog[]> {
  const result = await getPaginatedOperationalLogs(filters, currentUser);
  return result.items;
}

/**
 * Fetches a single operational log by visit/log ID directly from DB using findUnique
 * without querying all historical records.
 */
export async function getOperationalLogById(
  id: number | string | bigint,
  currentUser?: User | null
): Promise<MilkProcessLog | null> {
  let visitId: bigint;
  try {
    visitId = BigInt(id);
  } catch {
    return null;
  }

  const visit = await prisma.vehicleVisit.findUnique({
    where: { id: visitId },
    include: {
      procurement_source: true,
      gate_log: true,
      weight_ticket: true,
      portions: {
        orderBy: { portion_number: 'asc' },
        include: {
          dispatch_info: true,
          dispatch_lab_results: {
            include: { lab_test: true },
          },
          plant_lab_results: {
            include: { lab_test: true },
          },
          unloading_log: {
            include: { silo: true },
          },
        },
      },
      inventory_transactions: {
        where: { transaction_type: 'RECEIPT' },
      },
      dual_reconciliation: true,
    },
  });

  if (!visit) return null;

  // Enforce source scoping for source-scoped roles
  if (currentUser?.role === 'CONTRACTOR_MANAGER' || currentUser?.role === 'CONTRACTOR_OPERATOR') {
    if (!currentUser.procurement_source_id || visit.procurement_source_id !== BigInt(currentUser.procurement_source_id)) {
      return null;
    }
  } else if (currentUser?.role === 'ZMCC_MANAGER' || currentUser?.role === 'ZMCC_LAB_ATTENDANT') {
    if (!currentUser.procurement_source_id || visit.procurement_source_id !== BigInt(currentUser.procurement_source_id)) {
      return null;
    }
  }

  const masterLabTests = await prisma.labTest.findMany({
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });

  const logs = mapVisitToLogs(visit, masterLabTests);
  return logs.find((l) => l.id === id) || (logs.length > 0 ? logs[0] : null);
}


