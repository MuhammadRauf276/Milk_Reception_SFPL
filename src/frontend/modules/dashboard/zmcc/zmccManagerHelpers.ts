import { MilkProcessLog } from '@backend/core/types';
import {
  VehicleVisitGroup,
  ManagerLifecycleSummary,
  LifecycleStageInfo,
  LifecycleStageId,
  PortionQASummary,
  ZMCCAttentionItem,
  ZMCCManagerOverviewMetrics,
  OverviewDateRange,
} from './zmccManagerTypes';
import { formatOperationalDatetime, formatOperationalTime } from '@/lib/datetime-utils';

/**
 * Group flat portion-level MilkProcessLog rows by visit ID
 */
export function groupLogsByVisit(logs: MilkProcessLog[]): Map<number, MilkProcessLog[]> {
  const map = new Map<number, MilkProcessLog[]>();
  for (const log of logs) {
    const visitId = log.id;
    if (!map.has(visitId)) {
      map.set(visitId, []);
    }
    map.get(visitId)!.push(log);
  }
  return map;
}

/**
 * Summarize portion-level QA decisions for a vehicle visit
 */
export function summarizePortionQA(portions: MilkProcessLog[]): PortionQASummary {
  const total = portions.length;
  if (total === 0) {
    return {
      totalPortions: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      holdCount: 0,
      pendingCount: 0,
      summaryText: 'No Portions',
      badgeType: 'EMPTY',
    };
  }

  let accepted = 0;
  let rejected = 0;
  let hold = 0;
  let pending = 0;

  for (const p of portions) {
    const st = String(p.calculated_status || 'PENDING').toUpperCase();
    if (st === 'ACCEPTED') accepted++;
    else if (st === 'REJECTED') rejected++;
    else if (st === 'HOLD') hold++;
    else pending++;
  }

  let summaryText = '';
  let badgeType: PortionQASummary['badgeType'] = 'EMPTY';

  if (accepted === total) {
    summaryText = `${accepted} / ${total} Accepted`;
    badgeType = 'ALL_ACCEPTED';
  } else if (rejected === total) {
    summaryText = `${rejected} / ${total} Rejected`;
    badgeType = 'ALL_REJECTED';
  } else if (pending === total) {
    summaryText = `${total} Pending`;
    badgeType = 'ALL_PENDING';
  } else {
    const parts: string[] = [];
    if (accepted > 0) parts.push(`${accepted} Accepted`);
    if (rejected > 0) parts.push(`${rejected} Rejected`);
    if (hold > 0) parts.push(`${hold} Hold`);
    if (pending > 0) parts.push(`${pending} Pending`);
    summaryText = parts.join(' · ');
    badgeType = hold > 0 ? 'HAS_HOLD' : 'MIXED';
  }

  return {
    totalPortions: total,
    acceptedCount: accepted,
    rejectedCount: rejected,
    holdCount: hold,
    pendingCount: pending,
    summaryText,
    badgeType,
  };
}

/**
 * Pure calculation of in-plant elapsed duration
 */
export function computeElapsedInPlant(
  igpDate?: string | null,
  igpTime?: string | null,
  createdAt?: string | null
): string | null {
  let entryDateObj: Date | null = null;

  if (igpDate && igpTime) {
    // Attempt parse
    const isoString = `${igpDate}T${igpTime.length === 5 ? `${igpTime}:00` : igpTime}`;
    const parsed = new Date(isoString);
    if (!isNaN(parsed.getTime())) {
      entryDateObj = parsed;
    }
  }

  if (!entryDateObj && createdAt) {
    const parsed = new Date(createdAt);
    if (!isNaN(parsed.getTime())) {
      entryDateObj = parsed;
    }
  }

  if (!entryDateObj) return null;

  const nowMs = Date.now();
  const entryMs = entryDateObj.getTime();
  const diffMs = nowMs - entryMs;
  if (diffMs < 0) return 'Just entered';

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Pure helper to derive the 7-stage manager lifecycle for a vehicle visit
 */
export function deriveManagerLifecycle(portions: MilkProcessLog[]): ManagerLifecycleSummary {
  const primary = portions[0] || ({} as MilkProcessLog);
  const visitId = primary.id || 0;
  const vehicleNumber = primary.vehicle_number || 'N/A';
  const tokenNumber = primary.token_number || null;
  const sourceName = primary.zonal_contractor_name || 'ZMCC Source';
  const overallStatus = String(primary.status || 'DISPATCHED').toUpperCase();

  const portionQA = summarizePortionQA(portions);

  // Raw milestones
  const hasGateEntry =
    Boolean(primary.igp_time || primary.igp_date) ||
    [
      'GATE_IN',
      'IN_QA',
      'QA_ACCEPTED',
      'WEIGHED_IN',
      'UNLOADING',
      'UNLOADED',
      'READY_FOR_TARE',
      'TARE_WEIGHED',
      'READY_FOR_GATE_EXIT',
      'COMPLETED',
      'GATE_OUT',
    ].includes(overallStatus);

  const hasFirstWeight = primary.first_weight_of_vehicle != null;
  const hasUnloadingStart = Boolean(primary.reception_start_time);
  const hasUnloadingComplete =
    Boolean(primary.reception_end_time) ||
    ['UNLOADED', 'READY_FOR_TARE', 'TARE_WEIGHED', 'READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT'].includes(
      overallStatus
    );
  const hasSecondWeight = primary.second_weight_of_vehicle != null;
  const hasFinalReceipt =
    primary.computed_plant_liters != null &&
    ['READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT'].includes(overallStatus);

  const isAllQaEvaluated = portionQA.totalPortions > 0 && portionQA.pendingCount === 0;

  // Build the 7 stages
  const stages: LifecycleStageInfo[] = [
    {
      id: 'DISPATCH',
      label: 'Dispatch',
      shortLabel: 'Dispatch',
      status: 'COMPLETED',
      eventTimestamp: primary.dispatch_date || (primary.created_at ? formatOperationalDatetime(primary.created_at) : null),
    },
    {
      id: 'GATE_ENTRY',
      label: 'Gate Entry',
      shortLabel: 'Gate Entry',
      status: hasGateEntry ? 'COMPLETED' : 'CURRENT',
      eventTimestamp: primary.igp_date && primary.igp_time ? `${primary.igp_date} ${primary.igp_time}` : null,
    },
    {
      id: 'PLANT_QA',
      label: 'Plant QA',
      shortLabel: 'QA',
      status: !hasGateEntry
        ? 'UPCOMING'
        : isAllQaEvaluated
        ? 'COMPLETED'
        : 'CURRENT',
      detailText: portionQA.summaryText,
    },
    {
      id: 'FIRST_WEIGHT',
      label: 'First Weight (Loaded Vehicle)',
      shortLabel: 'First Weight',
      status: !hasGateEntry || !isAllQaEvaluated
        ? 'UPCOMING'
        : hasFirstWeight
        ? 'COMPLETED'
        : 'CURRENT',
      metricText: primary.first_weight_of_vehicle != null ? `${primary.first_weight_of_vehicle.toLocaleString()} KG` : null,
      eventTimestamp: primary.first_weight_time || null,
    },
    {
      id: 'UNLOADING',
      label: 'Unloading',
      shortLabel: 'Unload',
      status: !hasFirstWeight
        ? 'UPCOMING'
        : hasUnloadingComplete
        ? 'COMPLETED'
        : hasUnloadingStart || overallStatus === 'UNLOADING'
        ? 'CURRENT'
        : 'UPCOMING',
      detailText: primary.silo_storage_id ? `Silo ${primary.silo_storage_id}` : null,
      eventTimestamp: primary.reception_start_time || null,
    },
    {
      id: 'SECOND_WEIGHT',
      label: 'Second Weight (After Unloading)',
      shortLabel: 'Second Weight',
      status: !hasUnloadingComplete
        ? 'UPCOMING'
        : hasSecondWeight
        ? 'COMPLETED'
        : 'CURRENT',
      metricText: primary.second_weight_of_vehicle != null ? `${primary.second_weight_of_vehicle.toLocaleString()} KG` : null,
      eventTimestamp: primary.second_weight_time || null,
    },
    {
      id: 'FINAL_RECEIPT',
      label: 'Final Receipt',
      shortLabel: 'Receipt',
      status: !hasSecondWeight
        ? 'UPCOMING'
        : hasFinalReceipt
        ? 'COMPLETED'
        : 'CURRENT',
      metricText: primary.computed_plant_liters != null ? `${primary.computed_plant_liters.toLocaleString()} L` : null,
    },
  ];

  // Determine current active stage
  let currentStageId: LifecycleStageId = 'DISPATCH';
  let currentStageLabel = 'Dispatch';

  if (hasFinalReceipt) {
    currentStageId = 'FINAL_RECEIPT';
    currentStageLabel = 'Final Receipt Completed';
  } else if (hasSecondWeight) {
    currentStageId = 'FINAL_RECEIPT';
    currentStageLabel = 'Awaiting Final Silo Receipt';
  } else if (hasUnloadingComplete) {
    currentStageId = 'SECOND_WEIGHT';
    currentStageLabel = 'Second Weight (After Unloading)';
  } else if (hasUnloadingStart || overallStatus === 'UNLOADING') {
    currentStageId = 'UNLOADING';
    currentStageLabel = 'Silo Milk Offloading';
  } else if (hasFirstWeight) {
    currentStageId = 'UNLOADING';
    currentStageLabel = 'Awaiting Unloading';
  } else if (isAllQaEvaluated) {
    currentStageId = 'FIRST_WEIGHT';
    currentStageLabel = 'First Weight (Loaded Vehicle)';
  } else if (hasGateEntry) {
    currentStageId = 'PLANT_QA';
    currentStageLabel = 'Plant QA Analysis';
  }

  // Derive latest event label and timestamp
  let latestEventLabel = 'Dispatch Recorded';
  let latestEventTimestamp: string | null = primary.created_at ? formatOperationalDatetime(primary.created_at) : null;

  if (primary.second_weight_time) {
    latestEventLabel = 'Second Weight (After Unloading)';
    latestEventTimestamp = primary.second_weight_time;
  } else if (primary.reception_start_time) {
    latestEventLabel = 'Unloading Started';
    latestEventTimestamp = primary.reception_start_time;
  } else if (primary.first_weight_time) {
    latestEventLabel = 'First Weight (Loaded Vehicle)';
    latestEventTimestamp = primary.first_weight_time;
  } else if (primary.igp_time) {
    latestEventLabel = 'Gate Entry';
    latestEventTimestamp = primary.igp_date && primary.igp_time ? `${primary.igp_date} ${primary.igp_time}` : primary.igp_time;
  }

  const isComplete = hasFinalReceipt || ['COMPLETED', 'GATE_OUT'].includes(overallStatus);
  const isInPlant = hasGateEntry && !isComplete;
  const elapsedInPlant = isInPlant ? computeElapsedInPlant(primary.igp_date, primary.igp_time, primary.created_at) : null;

  return {
    visitId,
    vehicleNumber,
    tokenNumber,
    sourceName,
    overallStatus,
    currentStageId,
    currentStageLabel,
    stages,
    portionQA,
    latestEventLabel,
    latestEventTimestamp,
    elapsedInPlant,
    isComplete,
    isInPlant,
  };
}

/**
 * Transform flat logs into grouped VehicleVisitGroup records
 */
export function buildVehicleVisitGroups(logs: MilkProcessLog[]): VehicleVisitGroup[] {
  const visitMap = groupLogsByVisit(logs);
  const groups: VehicleVisitGroup[] = [];

  for (const [visitId, portions] of Array.from(visitMap.entries())) {
    const primary = portions[0];
    if (!primary) continue;

    const lifecycle = deriveManagerLifecycle(portions);

    // Sum portion dispatch quantities
    let sumGrossLiters = 0;
    let sum13TsLiters = 0;
    let hasGross = false;
    let has13Ts = false;

    for (const p of portions) {
      if (p.dispatch_liters_gross != null) {
        sumGrossLiters += p.dispatch_liters_gross;
        hasGross = true;
      }
      if (p.computed_dispatch_13ts_liters != null) {
        sum13TsLiters += p.computed_dispatch_13ts_liters;
        has13Ts = true;
      }
    }

    groups.push({
      visitId,
      vehicleNumber: primary.vehicle_number,
      tokenNumber: primary.token_number || null,
      sourceName: primary.zonal_contractor_name,
      procurementSourceId: null,
      businessDate: primary.dispatch_date || (primary.created_at ? primary.created_at.split('T')[0] : ''),
      overallStatus: primary.status,
      portions,
      primaryLog: primary,

      vehicleDispatchQuantityValue: primary.dispatch_liters_gross ?? primary.dispatch_kg_gross ?? null,
      vehicleDispatchQuantityUnit: primary.dispatch_liters_gross != null ? 'LITER' : primary.dispatch_kg_gross != null ? 'KG' : null,
      vehicleDispatchQuantityBasis: 'GROSS',
      totalDispatchGrossLiters: hasGross ? Number(sumGrossLiters.toFixed(2)) : null,
      totalDispatch13TsLiters: has13Ts ? Number(sum13TsLiters.toFixed(2)) : null,

      firstWeightKg: primary.first_weight_of_vehicle ?? null,
      secondWeightKg: primary.second_weight_of_vehicle ?? null,
      netMilkWeightKg: primary.computed_net_milk_weight ?? null,
      physicalReceivedLiters: primary.computed_plant_liters ?? null,
      plant13TsLiters: primary.computed_plant_13ts_liters ?? null,

      destinationSilo: primary.silo_storage_id || null,
      lifecycle,
    });
  }

  return groups;
}

/**
 * Filter groups by date range using the server business date
 */
export function filterGroupsByDateRange(
  groups: VehicleVisitGroup[],
  serverBusinessDate: string,
  range: OverviewDateRange
): VehicleVisitGroup[] {
  if (range === 'ALL') return groups;

  return groups.filter((g) => {
    const logDate = g.businessDate;
    if (!logDate) return false;

    if (range === 'TODAY') {
      return !serverBusinessDate || logDate === serverBusinessDate;
    }
    if (range === 'YESTERDAY') {
      if (!serverBusinessDate) return true;
      const refDate = new Date(serverBusinessDate);
      refDate.setDate(refDate.getDate() - 1);
      const yStr = refDate.toISOString().split('T')[0];
      return logDate === yStr;
    }
    if (range === 'LAST_7') {
      if (!serverBusinessDate) return true;
      const diffMs = new Date(serverBusinessDate).getTime() - new Date(logDate).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
      return diffDays >= 0 && diffDays <= 7;
    }
    if (range === 'LAST_15') {
      if (!serverBusinessDate) return true;
      const diffMs = new Date(serverBusinessDate).getTime() - new Date(logDate).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
      return diffDays >= 0 && diffDays <= 15;
    }
    return true;
  });
}

/**
 * Compute the 4 primary operational KPI cards and secondary volume metrics
 */
export function computeManagerOverview(
  logs: MilkProcessLog[],
  serverBusinessDate: string,
  dateRange: OverviewDateRange
): ZMCCManagerOverviewMetrics {
  const allGroups = buildVehicleVisitGroups(logs);
  const periodGroups = filterGroupsByDateRange(allGroups, serverBusinessDate, dateRange);

  // A. Dispatched in period (distinct visits)
  const dispatchedCount = periodGroups.length;

  // B. Currently in plant (all active visits that entered and have not exited, irrespective of date boundary)
  const currentlyInPlantCount = allGroups.filter((g) => g.lifecycle.isInPlant).length;

  // C. Completed in period (reached final receipt)
  const completedCount = periodGroups.filter((g) => g.lifecycle.isComplete).length;

  // D. Plant QA Rejected Portions count in period
  let rejectedPortionsCount = 0;
  for (const g of periodGroups) {
    for (const p of g.portions) {
      if (String(p.calculated_status).toUpperCase() === 'REJECTED') {
        rejectedPortionsCount++;
      }
    }
  }

  // Secondary Volume & 13% TS
  let totalDispatchGrossLiters = 0;
  let totalPhysicalReceivedLiters = 0;
  let totalDispatch13TsLiters = 0;
  let totalPlant13TsLiters = 0;

  for (const g of periodGroups) {
    if (g.totalDispatchGrossLiters != null) {
      totalDispatchGrossLiters += g.totalDispatchGrossLiters;
    }
    if (g.physicalReceivedLiters != null) {
      totalPhysicalReceivedLiters += g.physicalReceivedLiters;
    }
    if (g.totalDispatch13TsLiters != null) {
      totalDispatch13TsLiters += g.totalDispatch13TsLiters;
    }
    if (g.plant13TsLiters != null) {
      totalPlant13TsLiters += g.plant13TsLiters;
    }
  }

  const quantityDifferenceLiters = Number((totalPhysicalReceivedLiters - totalDispatchGrossLiters).toFixed(2));
  const tsDifferenceLiters = Number((totalPlant13TsLiters - totalDispatch13TsLiters).toFixed(2));

  return {
    dispatchedCount,
    currentlyInPlantCount,
    completedCount,
    rejectedPortionsCount,
    totalDispatchGrossLiters: Number(totalDispatchGrossLiters.toFixed(2)),
    totalPhysicalReceivedLiters: Number(totalPhysicalReceivedLiters.toFixed(2)),
    quantityDifferenceLiters,
    totalDispatch13TsLiters: Number(totalDispatch13TsLiters.toFixed(2)),
    totalPlant13TsLiters: Number(totalPlant13TsLiters.toFixed(2)),
    tsDifferenceLiters,
  };
}

/**
 * Derive manager attention items purely from read-model data
 */
export function deriveManagerAttention(logs: MilkProcessLog[]): ZMCCAttentionItem[] {
  const groups = buildVehicleVisitGroups(logs);
  const items: ZMCCAttentionItem[] = [];

  for (const g of groups) {
    // 1. Plant QA Rejection
    for (const p of g.portions) {
      if (String(p.calculated_status).toUpperCase() === 'REJECTED') {
        items.push({
          id: `qa-rej-${g.visitId}-${p.portion_id || p.portion_number}`,
          type: 'PLANT_QA_REJECTION',
          title: `Plant QA Rejection (Portion P-0${p.portion_number})`,
          description: p.rejection_reasons
            ? `Rejection reason: ${p.rejection_reasons}`
            : 'Portion was rejected during Plant QA laboratory testing.',
          vehicleNumber: g.vehicleNumber,
          visitId: g.visitId,
          portionNumber: p.portion_number,
          eventDate: p.dispatch_date || null,
          log: p,
          metrics: [
            { label: 'Plant LR', value: p.sampling_lr != null ? `${p.sampling_lr}` : '—' },
            { label: 'Plant Fat', value: p.sampling_fat != null ? `${p.sampling_fat}%` : '—' },
          ],
        });
      }
    }

    // 2. Receipt Pending (Second Weight recorded, but final receipt absent)
    if (g.secondWeightKg != null && g.physicalReceivedLiters == null) {
      items.push({
        id: `receipt-pending-${g.visitId}`,
        type: 'RECEIPT_PENDING',
        title: 'Receipt Pending',
        description: 'Second Weight (After Unloading) completed. Awaiting final silo receipt recording.',
        vehicleNumber: g.vehicleNumber,
        visitId: g.visitId,
        eventDate: g.primaryLog.dispatch_date || null,
        log: g.primaryLog,
        metrics: [
          { label: 'First Weight', value: g.firstWeightKg != null ? `${g.firstWeightKg.toLocaleString()} KG` : '—' },
          { label: 'Second Weight', value: `${g.secondWeightKg.toLocaleString()} KG` },
          { label: 'Net Milk Weight', value: g.netMilkWeightKg != null ? `${g.netMilkWeightKg.toLocaleString()} KG` : '—' },
        ],
      });
    }

    // 3. Quantity Difference (Completed visit with comparable dispatch and received liters)
    if (g.lifecycle.isComplete && g.totalDispatchGrossLiters != null && g.physicalReceivedLiters != null) {
      const diff = Number((g.physicalReceivedLiters - g.totalDispatchGrossLiters).toFixed(2));
      if (Math.abs(diff) > 0.01) {
        items.push({
          id: `qty-diff-${g.visitId}`,
          type: 'QUANTITY_DIFFERENCE',
          title: 'Quantity Difference',
          description: `Dispatch Gross vs Physical Received variance of ${diff > 0 ? `+${diff}` : diff} L.`,
          vehicleNumber: g.vehicleNumber,
          visitId: g.visitId,
          eventDate: g.primaryLog.dispatch_date || null,
          log: g.primaryLog,
          metrics: [
            { label: 'Dispatch Gross', value: `${g.totalDispatchGrossLiters.toLocaleString()} L` },
            { label: 'Physical Received', value: `${g.physicalReceivedLiters.toLocaleString()} L` },
            { label: 'Difference', value: `${diff > 0 ? `+${diff}` : diff} L` },
          ],
        });
      }
    }

    // 4. Quality Difference (Portion-level Dispatch vs Plant LR / Fat difference)
    for (const p of g.portions) {
      if (
        p.dispatch_lr != null &&
        p.sampling_lr != null &&
        p.dispatch_fat != null &&
        p.sampling_fat != null
      ) {
        const lrDiff = Number((p.sampling_lr - p.dispatch_lr).toFixed(1));
        const fatDiff = Number((p.sampling_fat - p.dispatch_fat).toFixed(2));

        if (Math.abs(lrDiff) >= 0.5 || Math.abs(fatDiff) >= 0.2) {
          items.push({
            id: `qual-diff-${g.visitId}-${p.portion_id || p.portion_number}`,
            type: 'QUALITY_DIFFERENCE',
            title: `Quality Difference (Portion P-0${p.portion_number})`,
            description: `Quality variance between ZMCC dispatch and factory QA laboratory results.`,
            vehicleNumber: g.vehicleNumber,
            visitId: g.visitId,
            portionNumber: p.portion_number,
            eventDate: p.dispatch_date || null,
            log: p,
            metrics: [
              { label: 'LR (Disp / Plant)', value: `${p.dispatch_lr} / ${p.sampling_lr} (${lrDiff > 0 ? `+${lrDiff}` : lrDiff})` },
              { label: 'Fat (Disp / Plant)', value: `${p.dispatch_fat}% / ${p.sampling_fat}% (${fatDiff > 0 ? `+${fatDiff}` : fatDiff}%)` },
            ],
          });
        }
      }
    }

    // 5. In-Plant Duration (active vehicles currently inside plant)
    if (g.lifecycle.isInPlant && g.lifecycle.elapsedInPlant) {
      items.push({
        id: `in-plant-${g.visitId}`,
        type: 'IN_PLANT_DURATION',
        title: `In Plant for ${g.lifecycle.elapsedInPlant}`,
        description: `Vehicle is currently at ${g.lifecycle.currentStageLabel} stage.`,
        vehicleNumber: g.vehicleNumber,
        visitId: g.visitId,
        eventDate: g.primaryLog.dispatch_date || null,
        log: g.primaryLog,
        metrics: [
          { label: 'Current Stage', value: g.lifecycle.currentStageLabel },
          { label: 'Token Issued', value: g.tokenNumber || '—' },
          { label: 'Time in Factory', value: g.lifecycle.elapsedInPlant },
        ],
      });
    }
  }

  return items;
}
