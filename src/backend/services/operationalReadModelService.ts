import { prisma } from '../core/db';
import { MilkProcessLog, User, ProcessStatus } from '../core/types';
import { PLANT_TIMEZONE } from '@/lib/datetime-utils';
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
  } else if (
    currentUser?.role === 'ZMCC_MANAGER' ||
    currentUser?.role === 'CONTRACTOR_MANAGER' ||
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

  // Contractor filter
  if (filters?.contractor && filters.contractor !== 'ALL') {
    whereClause.procurement_source = {
      OR: [
        { code: filters.contractor },
        { name: filters.contractor },
      ],
    };
  }

  // Date filters
  if (filters?.fromDate || filters?.toDate) {
    whereClause.operational_date = {};
    if (filters.fromDate) {
      const fromDateObj = new Date(filters.fromDate);
      if (isNaN(fromDateObj.getTime())) {
        throw new Error('Invalid fromDate parameter');
      }
      whereClause.operational_date.gte = fromDateObj;
    }
    if (filters.toDate) {
      const toDateObj = new Date(filters.toDate);
      if (isNaN(toDateObj.getTime())) {
        throw new Error('Invalid toDate parameter');
      }
      toDateObj.setHours(23, 59, 59, 999);
      whereClause.operational_date.lte = toDateObj;
    }
  }

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
    const opDate = visit.operational_date ? new Date(visit.operational_date) : new Date(visit.created_at);
    const dateStr = opDate.toISOString().split('T')[0];
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

        dispatch_date: dateStr,
        dispatch_day: daysOfWeek[opDate.getDay()],
        dispatch_week: Math.ceil(opDate.getDate() / 7) + 28,
        dispatch_month: monthsOfYear[opDate.getMonth()],
        dispatch_year: opDate.getFullYear(),
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
        final_receipt_timestamp: finalizedReceipt
          ? finalizedReceipt.operational_timestamp
            ? new Date(finalizedReceipt.operational_timestamp).toISOString()
            : new Date(finalizedReceipt.created_at).toISOString()
          : null,
        authoritative_final_liters: finalizedReceipt?.quantity_liters
          ? Number(finalizedReceipt.quantity_liters)
          : null,

        created_at: visit.created_at ? new Date(visit.created_at).toISOString() : new Date().toISOString(),
        updated_at: visit.updated_at ? new Date(visit.updated_at).toISOString() : new Date().toISOString(),
      };

      logs.push(logRow);
    }
  }

  // Apply in-memory search and status filters
  let filtered = logs;

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

