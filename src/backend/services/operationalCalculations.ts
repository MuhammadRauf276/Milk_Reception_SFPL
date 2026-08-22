import { MilkProcessLog } from '../core/types';
import {
  calculateSNF,
  calculateTS,
  calculateAt13TSLiters,
} from '../utils/milkFormulas';

export interface DynamicTestComparison {
  testId: string;
  testCode: string;
  testName: string;
  category: 'Composition' | 'Physical' | 'Chemical' | 'Adulteration' | 'Microbiological' | 'Other';
  testScope: 'DISPATCH' | 'PLANT' | 'BOTH';
  unit: string;
  resultType: 'NUMERIC' | 'TEXT' | 'BOOLEAN';
  dispatchResult: {
    status: 'AVAILABLE' | 'PENDING' | 'NOT_TESTED' | 'NOT_APPLICABLE';
    value: string | number | null;
  };
  plantResult: {
    status: 'AVAILABLE' | 'PENDING' | 'NOT_TESTED' | 'NOT_APPLICABLE';
    value: string | number | null;
  };
  difference: {
    numericValue: number | null;
    displayText: string;
  };
}

export interface VehicleDecisionSummary {
  statusLabel: string;
  badgeClass: string;
  isAllAccepted: boolean;
  isAllRejected: boolean;
  isMixed: boolean;
  isPending: boolean;
  acceptedCount: number;
  rejectedCount: number;
  pendingCount: number;
  totalPortions: number;
}

export interface AuthoritativeZonalAnalytics {
  zoneName: string;
  totalVisits: number;
  totalPortions: number;
  totalZonalDispatchedLiters: number;
  plantReceivedFromThisZone: number;
  volumeVarianceLiters: number;
  volumeVariancePercent: number;
  shortageLiters: number;
  shortagePercent: number;
  surplusLiters: number;
  totalDispatch13TSLiters: number;
  totalPlant13TSLiters: number;
  tsVariance: number;
  tsVariancePercent: number;
  acceptedCount: number;
  rejectedCount: number;
}

/**
 * Pure helper function to compute canonical metrics for a given log row
 * Zero fake defaults (3.8, 28, 12000, 1.03, 'Accepted' are strictly eliminated).
 */
export function computeRuntimeMetrics(log: MilkProcessLog): MilkProcessLog {
  const dFat = log.dispatch_fat;
  const dLr = log.dispatch_lr;
  const grossLiters = log.dispatch_liters_gross;

  let computed_dispatch_snf: number | null = null;
  let computed_dispatch_ts: number | null = null;
  let computed_dispatch_13ts_liters: number | null = null;

  if (dFat != null && dLr != null) {
    computed_dispatch_snf = Number(calculateSNF(dLr, dFat).toFixed(3));
    computed_dispatch_ts = Number(calculateTS(dFat, computed_dispatch_snf).toFixed(3));
    if (grossLiters != null) {
      computed_dispatch_13ts_liters = Number(calculateAt13TSLiters(grossLiters, computed_dispatch_ts).toFixed(2));
    }
  }

  const pFat = log.sampling_fat;
  const pLr = log.sampling_lr;

  let computed_sampling_snf: number | null = null;
  let computed_sampling_ts: number | null = null;

  if (pFat != null && pLr != null) {
    computed_sampling_snf = Number(calculateSNF(pLr, pFat).toFixed(3));
    computed_sampling_ts = Number(calculateTS(pFat, computed_sampling_snf).toFixed(3));
  }

  const computed_net_milk_weight = log.computed_net_milk_weight ?? null;

  const activeSnf = computed_sampling_snf ?? computed_dispatch_snf;
  const borderline_warning = activeSnf != null && activeSnf >= 8.5 && activeSnf <= 8.6;

  return {
    ...log,
    computed_dispatch_snf: computed_dispatch_snf ?? log.computed_dispatch_snf,
    computed_dispatch_ts: computed_dispatch_ts ?? log.computed_dispatch_ts,
    computed_dispatch_13ts_liters: computed_dispatch_13ts_liters ?? log.computed_dispatch_13ts_liters,
    computed_sampling_snf: computed_sampling_snf ?? log.computed_sampling_snf,
    computed_sampling_ts: computed_sampling_ts ?? log.computed_sampling_ts,
    computed_net_milk_weight,
    borderline_warning,
  };
}

/**
 * Pure helper function to summarize multi-portion decision statuses
 */
export function computeVehicleDecisionSummary(
  portions: MilkProcessLog[],
  currentVisitStatus: string
): VehicleDecisionSummary {
  let acceptedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;

  portions.forEach((p) => {
    const dec = String(p.calculated_status || '').toUpperCase();
    if (dec === 'ACCEPTED') {
      acceptedCount++;
    } else if (dec === 'REJECTED') {
      rejectedCount++;
    } else {
      pendingCount++;
    }
  });

  const totalPortions = portions.length;
  const isAllAccepted = acceptedCount === totalPortions && totalPortions > 0;
  const isAllRejected = rejectedCount === totalPortions && totalPortions > 0;
  const isMixed = acceptedCount > 0 && rejectedCount > 0 && pendingCount === 0;
  const isPending = pendingCount > 0;

  let statusLabel = currentVisitStatus;
  let badgeClass = 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]';

  if (isAllAccepted) {
    statusLabel = 'ACCEPTED';
    badgeClass = 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]';
  } else if (isAllRejected) {
    statusLabel = 'REJECTED';
    badgeClass = 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]';
  } else if (isMixed) {
    statusLabel = `${acceptedCount} Accepted / ${rejectedCount} Rejected`;
    badgeClass = 'bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]';
  } else if (isPending) {
    const summary = `${acceptedCount > 0 ? `${acceptedCount} Accepted / ` : ''}${pendingCount} Pending`;
    statusLabel = `${currentVisitStatus} (${summary})`;
    badgeClass = 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]';
  }

  return {
    statusLabel,
    badgeClass,
    isAllAccepted,
    isAllRejected,
    isMixed,
    isPending,
    acceptedCount,
    rejectedCount,
    pendingCount,
    totalPortions,
  };
}

/**
 * Authoritative ZMCC Cross-Verification and Zonal Summary Analytics
 * Uses canonical math and actual final physical received quantities.
 */
export function computeAuthoritativeZonalAnalytics(
  logs: MilkProcessLog[],
  zoneName: string
): AuthoritativeZonalAnalytics {
  const zonalLogs = logs.filter((l) => l.zonal_contractor_name === zoneName);

  // Group by visit_id
  const visitsMap = new Map<
    number,
    {
      visitId: number;
      vehicle_number: string;
      dispatchLiters: number;
      plantReceivedLiters: number | null;
      plant13TsLiters: number | null;
      portions: MilkProcessLog[];
    }
  >();

  zonalLogs.forEach((l) => {
    if (!visitsMap.has(l.id)) {
      visitsMap.set(l.id, {
        visitId: l.id,
        vehicle_number: l.vehicle_number,
        dispatchLiters: 0,
        plantReceivedLiters: l.computed_plant_liters ?? null,
        plant13TsLiters: l.computed_plant_13ts_liters ?? null,
        portions: [],
      });
    }

    const visitObj = visitsMap.get(l.id)!;
    visitObj.portions.push(l);
    if (l.dispatch_liters_gross != null) {
      visitObj.dispatchLiters += l.dispatch_liters_gross;
    }
  });

  let totalZonalDispatchedLiters = 0;
  let plantReceivedFromThisZone = 0;
  let totalDispatch13TSLiters = 0;
  let totalPlant13TSLiters = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;

  zonalLogs.forEach((l) => {
    if (l.computed_dispatch_13ts_liters != null) {
      totalDispatch13TSLiters += l.computed_dispatch_13ts_liters;
    }
    const dec = String(l.calculated_status || '').toUpperCase();
    if (dec === 'ACCEPTED') acceptedCount++;
    if (dec === 'REJECTED') rejectedCount++;
  });

  visitsMap.forEach((v) => {
    totalZonalDispatchedLiters += v.dispatchLiters;
    if (v.plantReceivedLiters != null) {
      plantReceivedFromThisZone += v.plantReceivedLiters;
    }
    if (v.plant13TsLiters != null) {
      totalPlant13TSLiters += v.plant13TsLiters;
    }
  });

  const volumeVarianceLiters = Number((plantReceivedFromThisZone - totalZonalDispatchedLiters).toFixed(2));
  const volumeVariancePercent =
    totalZonalDispatchedLiters > 0
      ? Number(((volumeVarianceLiters / totalZonalDispatchedLiters) * 100).toFixed(2))
      : 0;

  const shortageLiters = Math.max(Number((totalZonalDispatchedLiters - plantReceivedFromThisZone).toFixed(2)), 0);
  const shortagePercent =
    totalZonalDispatchedLiters > 0
      ? Number(((shortageLiters / totalZonalDispatchedLiters) * 100).toFixed(2))
      : 0;

  const surplusLiters = Math.max(Number((plantReceivedFromThisZone - totalZonalDispatchedLiters).toFixed(2)), 0);

  const tsVariance = Number((totalPlant13TSLiters - totalDispatch13TSLiters).toFixed(2));
  const tsVariancePercent =
    totalDispatch13TSLiters > 0
      ? Number(((tsVariance / totalDispatch13TSLiters) * 100).toFixed(2))
      : 0;

  return {
    zoneName,
    totalVisits: visitsMap.size,
    totalPortions: zonalLogs.length,
    totalZonalDispatchedLiters: Number(totalZonalDispatchedLiters.toFixed(2)),
    plantReceivedFromThisZone: Number(plantReceivedFromThisZone.toFixed(2)),
    volumeVarianceLiters,
    volumeVariancePercent,
    shortageLiters,
    shortagePercent,
    surplusLiters,
    totalDispatch13TSLiters: Number(totalDispatch13TSLiters.toFixed(2)),
    totalPlant13TSLiters: Number(totalPlant13TSLiters.toFixed(2)),
    tsVariance,
    tsVariancePercent,
    acceptedCount,
    rejectedCount,
  };
}
