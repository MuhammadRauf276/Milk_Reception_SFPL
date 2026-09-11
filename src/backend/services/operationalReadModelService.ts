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

export interface OperationalLogFilters {
  fromDate?: string;
  toDate?: string;
  contractor?: string;
  status?: string;
  search?: string;
  dateBasis?: 'dispatch' | 'reporting';
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
 * Maps normalized Prisma database models to flat, unit-safe MilkProcessLog[]
 * Zero fake defaults (3.8, 28, 12000, 1.03, 'Accepted' fallback are strictly eliminated).
 */
export async function getOperationalLogs(
  filters?: OperationalLogFilters,
  currentUser?: User | null
): Promise<MilkProcessLog[]> {
  const whereClause: any = {};

  // Server-side ZMCC Zone Manager lock
  if (currentUser?.role === 'MPD_Zone_Manager') {
    const rawZone = currentUser.zone || 'Hasilpur';
    const cleanZone = rawZone.replace(/^ZMCC\s+/i, '').trim();
    whereClause.procurement_source = {
      name: { contains: cleanZone, mode: 'insensitive' },
    };
  } else if (currentUser?.role === 'CONTRACTOR_MANAGER') {
    if (currentUser.procurement_source_id) {
      whereClause.procurement_source = {
        id: BigInt(currentUser.procurement_source_id),
        source_type: 'CONTRACTOR',
      };
    } else {
      // Fail closed: Unbound source-scoped role receives zero records
      whereClause.procurement_source_id = BigInt(-1);
    }
  } else if (currentUser?.role === 'ZMCC_MANAGER') {
    if (currentUser.procurement_source_id) {
      whereClause.procurement_source = {
        id: BigInt(currentUser.procurement_source_id),
        source_type: 'ZMCC',
      };
    } else {
      // Fail closed: Unbound source-scoped role receives zero records
      whereClause.procurement_source_id = BigInt(-1);
    }
  } else if (
    currentUser?.role === 'MPD_Operator' ||
    currentUser?.role === 'MPD'
  ) {
    if (currentUser.procurement_source_id) {
      whereClause.procurement_source_id = BigInt(currentUser.procurement_source_id);
    } else {
      // Fail closed: Unbound source-scoped role receives zero records
      whereClause.procurement_source_id = BigInt(-1);
    }
  }

  // Contractor filter for non-scoped roles (e.g. Super Admin)
  if (filters?.contractor && filters.contractor !== 'ALL') {
    if (!whereClause.procurement_source && !whereClause.procurement_source_id) {
      whereClause.procurement_source = {
        OR: [
          { code: filters.contractor },
          { name: filters.contractor },
        ],
      };
    }
  }

  // Date filters
  if (filters?.fromDate !== undefined || filters?.toDate !== undefined) {
    if (filters.fromDate !== undefined && filters.toDate !== undefined && filters.fromDate > filters.toDate) {
      throw new Error('From Date cannot be after To Date.');
    }
    if (filters.fromDate !== undefined && !isValidDateOnly(filters.fromDate)) {
      throw new Error('Invalid fromDate parameter');
    }
    if (filters.toDate !== undefined && !isValidDateOnly(filters.toDate)) {
      throw new Error('Invalid toDate parameter');
    }

    // Validate strict YYYY-MM-DD boundaries and chronological order.
    // Note: Do NOT filter whereClause.operational_date in SQL when dateBasis is default / 'dispatch'.
    // operational_date is strictly the Plant-Exit completion attribute and remains null prior to gate exit.
    // Dispatch date filtering is applied below in-memory across normalized log records in PKT calendar boundaries.
  }

  // Fetch master lab tests to dynamically resolve configured tests
  const masterLabTests = await prisma.labTest.findMany({
    orderBy: [
      { displayOrder: 'asc' },
      { id: 'asc' },
    ],
  });

  // Fetch normalized visits
  const visits = await prisma.vehicleVisit.findMany({
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
    },
    orderBy: { id: 'desc' },
  });

  const logs: MilkProcessLog[] = [];
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthsOfYear = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  for (const visit of visits) {
    const opDate = visit.operational_date ? new Date(visit.operational_date) : null;
    let dateStr: string | null = null;
    if (opDate && !isNaN(opDate.getTime())) {
      const y = opDate.getUTCFullYear().toString().padStart(4, '0');
      const m = (opDate.getUTCMonth() + 1).toString().padStart(2, '0');
      const d = opDate.getUTCDate().toString().padStart(2, '0');
      dateStr = `${y}-${m}-${d}`;
    }

    // Authoritative Plant-Exit Business Date
    // Canonical rules:
    // 1. Dispatch date/time records when the vehicle leaves its procurement source.
    // 2. Business date applies only after the complete plant route finishes and the vehicle exits the plant.
    // 3. A vehicle currently inside the plant or not yet exited must have no finalized business date.
    // 4. On plant exit, calculate business date from the authoritative plant-exit timestamp in Asia/Karachi.
    let finalizedBusinessDate: string | null = null;
    const hasPlantExit = Boolean(visit.gate_log?.exit_timestamp);

    if (hasPlantExit && visit.gate_log?.exit_timestamp) {
      finalizedBusinessDate = getOperationalBusinessDate(visit.gate_log.exit_timestamp);
    } else if (hasPlantExit && dateStr) {
      finalizedBusinessDate = dateStr;
    }

    // Dispatch Calendar Date (when the vehicle leaves its procurement source)
    let dispatchDateStr: string | null = null;
    const firstDispatchTs = visit.portions.find((p) => p.dispatch_info?.dispatch_timestamp)?.dispatch_info?.dispatch_timestamp;
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
    } else if (visit.created_at) {
      const dt = new Date(visit.created_at);
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
      const calcPortions: VehicleCalculationPortion[] = visit.portions.map((p) => ({
        portionId: p.id,
        portionNumber: p.portion_number,
        plantDecision: p.plant_decision,
        plantLabResults: p.plant_lab_results.map((r) => ({
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
    const finalizedReceipt = visit.inventory_transactions?.find((tx) => tx.transaction_type === 'RECEIPT');
    const finalPhysicalLiters = finalizedReceipt?.quantity_liters
      ? Number(finalizedReceipt.quantity_liters)
      : vehicleCalcResult?.isCalculable
      ? vehicleCalcResult.finalPhysicalLiters
      : null;

    const finalAt13TsLiters = vehicleCalcResult?.isCalculable
      ? vehicleCalcResult.finalAt13TSLiters
      : null;

    // Authoritative Whole-Vehicle Dispatch Quantity
    const vDeclaredVal = visit.vehicle_dispatch_quantity_value != null ? Number(visit.vehicle_dispatch_quantity_value) : null;
    const vDeclaredUnit = visit.vehicle_dispatch_quantity_unit ? visit.vehicle_dispatch_quantity_unit.toUpperCase() : null;
    const vDeclaredBasis = visit.vehicle_dispatch_quantity_basis || null;

    let vehicleDispatchGrossLiters: number | null = null;
    if (vDeclaredVal != null) {
      if (vDeclaredUnit === 'LITER') {
        vehicleDispatchGrossLiters = vDeclaredVal;
      } else if (vDeclaredUnit === 'KG') {
        const firstPortionWithLr = visit.portions.find((p) =>
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

      // Authoritative Final Receipt (Silo Transaction Evidence - No created_at fallback)
      // Final Receipt retains its real operational timestamp and ordinary Pakistan calendar date
      // where legitimately required. It does NOT own a separate 08:00 Business Date.
      const finalReceiptTs = finalizedReceipt?.operational_timestamp
        ? new Date(finalizedReceipt.operational_timestamp).toISOString()
        : null;

      const finalReceiptDate = (Boolean(finalizedReceipt) && finalReceiptTs)
        ? getPakistanCalendarDate(finalReceiptTs)
        : null;

      // Generic reporting date: ordinary PKT calendar date of Final Receipt if finalized,
      // otherwise ordinary dispatch calendar date.
      // This is an event/calendar date concept, NOT a Plant Business Date.
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
            : (opDate ? daysOfWeek[opDate.getDay()] : null),
          dispatch_week: dispatchDateStr
            ? Math.ceil(new Date(`${dispatchDateStr}T12:00:00Z`).getUTCDate() / 7) + 28
            : (opDate ? Math.ceil(opDate.getDate() / 7) + 28 : null),
          dispatch_month: dispatchDateStr
            ? monthsOfYear[new Date(`${dispatchDateStr}T12:00:00Z`).getUTCMonth()]
            : (opDate ? monthsOfYear[opDate.getMonth()] : null),
          dispatch_year: dispatchDateStr
            ? new Date(`${dispatchDateStr}T12:00:00Z`).getUTCFullYear()
            : (opDate ? opDate.getFullYear() : null),
          zonal_contractor_dispatch_time: formatTimeOnly(portion.dispatch_info?.dispatch_timestamp),
          dispatch_kg_gross: declaredUnit === 'KG' ? declaredVal : null,
          dispatch_liters_gross: dispatchGrossLiters,
          vehicle_dispatch_quantity_value: vDeclaredVal,
          vehicle_dispatch_quantity_unit: vDeclaredUnit,
          vehicle_dispatch_quantity_basis: vDeclaredBasis,
          vehicle_dispatch_gross_liters: vehicleDispatchGrossLiters,
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
            : visit.created_at
            ? new Date(visit.created_at).toISOString()
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

          portion_lab_results: portionLabResults,

          created_at: visit.created_at ? new Date(visit.created_at).toISOString() : new Date().toISOString(),
          updated_at: visit.updated_at ? new Date(visit.updated_at).toISOString() : new Date().toISOString(),
        };

        logs.push(logRow);
      }
    }

    // Apply in-memory search and status filters
    let filtered = logs;

    if (filters?.dateBasis === 'reporting') {
      if (filters.fromDate) {
        filtered = filtered.filter((l) => l.reporting_date && l.reporting_date >= filters.fromDate!);
      }
      if (filters.toDate) {
        filtered = filtered.filter((l) => l.reporting_date && l.reporting_date <= filters.toDate!);
      }
    } else {
      if (filters?.fromDate) {
        filtered = filtered.filter((l) => l.dispatch_date && l.dispatch_date >= filters.fromDate!);
      }
      if (filters?.toDate) {
        filtered = filtered.filter((l) => l.dispatch_date && l.dispatch_date <= filters.toDate!);
      }
    }

  if (filters?.status && filters.status !== 'ALL') {
    const filterStatusUpper = filters.status.toUpperCase();
    filtered = filtered.filter((l) => {
      const stUpper = String(l.status).toUpperCase();
      const calcUpper = String(l.calculated_status || '').toUpperCase();
      if (filterStatusUpper === 'ACCEPTED') return calcUpper === 'ACCEPTED';
      if (filterStatusUpper === 'REJECTED') return calcUpper === 'REJECTED';
      if (filterStatusUpper === 'PENDING') return calcUpper === 'PENDING' || (!l.calculated_status && stUpper !== 'COMPLETED');
      return l.status === filters.status || stUpper === filterStatusUpper;
    });
  }

  if (filters?.search && filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    filtered = filtered.filter((l) => {
      return (
        l.vehicle_number.toLowerCase().includes(q) ||
        (l.token_number && l.token_number.toLowerCase().includes(q)) ||
        l.zonal_contractor_name.toLowerCase().includes(q)
      );
    });
  }

  return filtered;
}

export async function getOperationalLogById(id: number, currentUser?: User | null): Promise<MilkProcessLog | null> {
  const logs = await getOperationalLogs(undefined, currentUser);
  return logs.find((l) => l.id === id) || null;
}

