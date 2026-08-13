import { MilkProcessLog } from '@core/types';
import { calculateStageDurations, getLiveWaitStatus } from '@core/durations';

/**
 * Dynamic Runtime Dairy Calculations Service
 * Computes calculations dynamically at runtime.
 */
export function computeRuntimeMetrics(log: MilkProcessLog): MilkProcessLog {
  const fat = log.sampling_fat ?? log.dispatch_fat ?? null;
  const lr = log.sampling_lr ?? log.dispatch_lr ?? null;
  const grossLiters = log.dispatch_liters_gross ?? null;
  const grossKg = log.first_weight_of_vehicle ?? log.dispatch_kg_gross ?? null;
  const tareKg = log.second_weight_of_vehicle ?? null;

  // 1. Dispatch SNF % & TS %
  let computed_dispatch_snf: number | null = null;
  let computed_dispatch_ts: number | null = null;
  let computed_dispatch_13ts_liters: number | null = null;

  if (log.dispatch_fat != null && log.dispatch_lr != null) {
    computed_dispatch_snf = Number(((log.dispatch_lr / 4) + (0.2 * log.dispatch_fat) + 0.36).toFixed(2));
    computed_dispatch_ts = Number((log.dispatch_fat + computed_dispatch_snf).toFixed(2));
    if (log.dispatch_liters_gross != null) {
      computed_dispatch_13ts_liters = Number(((log.dispatch_liters_gross * computed_dispatch_ts) / 13.0).toFixed(2));
    }
  }

  // 2. Sampling SNF % & TS %
  let computed_sampling_snf: number | null = null;
  let computed_sampling_ts: number | null = null;

  if (log.sampling_fat != null && log.sampling_lr != null) {
    computed_sampling_snf = Number(((log.sampling_lr / 4) + (0.2 * log.sampling_fat) + 0.36).toFixed(2));
    computed_sampling_ts = Number((log.sampling_fat + computed_sampling_snf).toFixed(2));
  }

  // 3. Plant Liters Formula = Gross Weight KG / (1 + (LR / 1000))
  let computed_plant_liters: number | null = null;
  if (grossKg != null && lr != null && lr > 0) {
    computed_plant_liters = Number((grossKg / (1 + (lr / 1000))).toFixed(2));
  }

  // 4. Net Milk Weight = 1st Weight (Gross) - 2nd Weight (Tare)
  let computed_net_milk_weight: number | null = null;
  if (log.first_weight_of_vehicle != null && log.second_weight_of_vehicle != null) {
    computed_net_milk_weight = log.first_weight_of_vehicle - log.second_weight_of_vehicle;
  }

  // 5. Plant 13% TS Liters
  let computed_plant_13ts_liters: number | null = null;
  const activeTS = computed_sampling_ts ?? computed_dispatch_ts;
  const activeLiters = computed_plant_liters ?? grossLiters;
  if (activeLiters != null && activeTS != null) {
    computed_plant_13ts_liters = Number(((activeLiters * activeTS) / 13.0).toFixed(2));
  }

  // Check Borderline Warning (e.g. SNF between 8.50% and 8.60%)
  const activeSNF = computed_sampling_snf ?? computed_dispatch_snf;
  const borderline_warning = activeSNF != null && activeSNF >= 8.50 && activeSNF <= 8.60;

  return {
    ...log,
    computed_dispatch_snf,
    computed_dispatch_ts,
    computed_dispatch_13ts_liters,
    computed_sampling_snf,
    computed_sampling_ts,
    computed_plant_liters,
    computed_net_milk_weight,
    computed_plant_13ts_liters,
    borderline_warning
  };
}

/**
 * ZMCC Minor Manager Cross-Verification Service
 * Compares dispatch inputs vs final plant outputs for a given zone.
 */
export function computeZonalCrossVerification(logs: MilkProcessLog[], zoneName: string) {
  const zonalLogs = logs.filter(l => l.zonal_contractor_name === zoneName);
  
  // Group by visit_id
  const visitsMap = new Map<number, {
    visitId: number;
    vehicle_number: string;
    dispatch_date: string;
    dispatchLiters: number;
    plantReceivedLiters: number | null;
    portions: MilkProcessLog[];
  }>();

  zonalLogs.forEach(l => {
    const computed = computeRuntimeMetrics(l);
    if (!visitsMap.has(computed.id)) {
      let visitPlantRecv: number | null = null;
      if (computed.second_weight_of_vehicle != null && computed.first_weight_of_vehicle != null) {
        const netKg = computed.first_weight_of_vehicle - computed.second_weight_of_vehicle;
        const activeLr = computed.sampling_lr || computed.dispatch_lr || 28.0;
        visitPlantRecv = Number((netKg / (1 + (activeLr / 1000))).toFixed(2));
      } else if (computed.computed_plant_liters != null) {
        // Single plant liters estimate for the visit
        visitPlantRecv = computed.computed_plant_liters;
      }

      visitsMap.set(computed.id, {
        visitId: computed.id,
        vehicle_number: computed.vehicle_number,
        dispatch_date: computed.dispatch_date || (computed.created_at ? computed.created_at.split('T')[0] : ''),
        dispatchLiters: 0,
        plantReceivedLiters: visitPlantRecv,
        portions: [],
      });
    }

    const visitObj = visitsMap.get(computed.id)!;
    visitObj.portions.push(computed);
    visitObj.dispatchLiters += computed.dispatch_liters_gross || 0;
  });

  let totalZonalDispatchedLiters = 0;
  let plantReceivedFromThisZone = 0;
  let totalDispatch13TSLiters = 0;
  let totalPlant13TSLiters = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;

  zonalLogs.forEach(l => {
    const computed = computeRuntimeMetrics(l);
    totalDispatch13TSLiters += computed.computed_dispatch_13ts_liters || 0;
    if (computed.calculated_status === 'Accepted') acceptedCount++;
    if (computed.calculated_status === 'Rejected') rejectedCount++;
  });

  visitsMap.forEach(v => {
    totalZonalDispatchedLiters += v.dispatchLiters;
    const recv = v.plantReceivedLiters != null ? v.plantReceivedLiters : v.dispatchLiters;
    plantReceivedFromThisZone += recv;

    // Estimate plant 13% TS for visit
    const avgFat = v.portions.reduce((s, p) => s + (p.sampling_fat || p.dispatch_fat || 3.8), 0) / v.portions.length;
    const avgLr = v.portions.reduce((s, p) => s + (p.sampling_lr || p.dispatch_lr || 28.0), 0) / v.portions.length;
    const avgSnf = Number(((avgLr / 4) + (0.2 * avgFat) + 0.36).toFixed(2));
    const avgTs = avgFat + avgSnf;
    const plant13ts = Number(((recv * avgTs) / 13.0).toFixed(2));
    totalPlant13TSLiters += plant13ts;
  });

  const volumeVarianceLiters = Number((plantReceivedFromThisZone - totalZonalDispatchedLiters).toFixed(2));
  const volumeVariancePercent = totalZonalDispatchedLiters > 0
    ? Number(((volumeVarianceLiters / totalZonalDispatchedLiters) * 100).toFixed(2))
    : 0;

  const shortageLiters = Math.max(Number((totalZonalDispatchedLiters - plantReceivedFromThisZone).toFixed(2)), 0);
  const shortagePercent = totalZonalDispatchedLiters > 0
    ? Number(((shortageLiters / totalZonalDispatchedLiters) * 100).toFixed(2))
    : 0;

  const surplusLiters = Math.max(Number((plantReceivedFromThisZone - totalZonalDispatchedLiters).toFixed(2)), 0);

  const tsVariance = Number((totalPlant13TSLiters - totalDispatch13TSLiters).toFixed(2));
  const tsVariancePercent = totalDispatch13TSLiters > 0
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

export function analyzeVehicleDurations(log: MilkProcessLog) {
  const durations = calculateStageDurations(log);
  const liveWait = getLiveWaitStatus(log);

  return {
    durations,
    liveWait,
    isBottleneck: liveWait.isBottleneck
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

export function computeVehicleDecisionSummary(portions: MilkProcessLog[], currentVisitStatus: string): VehicleDecisionSummary {
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
