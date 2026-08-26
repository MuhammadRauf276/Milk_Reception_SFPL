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
  CompletedReceiptQuantityComparison,
  PortionQualityReconciliation,
  VehicleReconciliationItem,
  CrossVerificationFilter,
  QualityRejectionFilter,
  QualityRejectionItem,
  QualityRejectionSummary,
} from './zmccManagerTypes';
import { formatOperationalDatetime, formatOperationalTime } from '@/lib/datetime-utils';
import { getOperationalBusinessDate } from '@backend/core/business-day';

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
 * Summarize portion-level QA decisions for a vehicle visit.
 * Plant QA stage is complete ONLY when EVERY portion is definitively ACCEPTED or REJECTED.
 * If any portion is HOLD or PENDING, Plant QA remains incomplete.
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
  } else if (hold === total) {
    summaryText = `${total} Hold`;
    badgeType = 'HAS_HOLD';
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
 * Pure calculation of in-plant elapsed duration.
 * Starts ONLY from authoritative gate entry timestamp (ISO instant).
 * No fallback to dispatch created_at, no timezone-less Date string reconstruction.
 */
export function computeElapsedInPlant(gateEntryTimestamp?: string | null): string | null {
  if (!gateEntryTimestamp) return null;

  const entryDateObj = new Date(gateEntryTimestamp);
  if (isNaN(entryDateObj.getTime())) return null;

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
 * Pure helper to derive the 7-stage manager lifecycle for a vehicle visit.
 * Plant QA complete: Every portion is definitive ACCEPTED or REJECTED (no HOLD, no PENDING).
 * Final Receipt complete: Authoritative SiloInventoryTransaction RECEIPT exists.
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
    Boolean(primary.gate_entry_timestamp || primary.igp_time || primary.igp_date) ||
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
  const hasUnloadingStart = Boolean(primary.unloading_start_timestamp || primary.reception_start_time);
  const hasUnloadingComplete =
    Boolean(primary.unloading_end_timestamp || primary.reception_end_time) ||
    ['UNLOADED', 'READY_FOR_TARE', 'TARE_WEIGHED', 'READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT'].includes(
      overallStatus
    );
  const hasSecondWeight = primary.second_weight_of_vehicle != null;

  // Authoritative Final Receipt: requires SiloInventoryTransaction RECEIPT existence
  const hasFinalReceipt = Boolean(primary.final_receipt_exists);

  // Definitive QA Completion: Every portion is either ACCEPTED or REJECTED
  const isAllQaDefinitive =
    portionQA.totalPortions > 0 &&
    portionQA.acceptedCount + portionQA.rejectedCount === portionQA.totalPortions;

  // Build the 7 stages with locked labels and authoritative timestamps
  const stages: LifecycleStageInfo[] = [
    {
      id: 'DISPATCH',
      label: 'Dispatch',
      shortLabel: 'Dispatch',
      status: 'COMPLETED',
      eventTimestamp: primary.dispatch_timestamp
        ? formatOperationalDatetime(primary.dispatch_timestamp)
        : primary.dispatch_date || null,
    },
    {
      id: 'GATE_ENTRY',
      label: 'Gate Entry',
      shortLabel: 'Gate Entry',
      status: hasGateEntry ? 'COMPLETED' : 'CURRENT',
      eventTimestamp: primary.gate_entry_timestamp
        ? formatOperationalDatetime(primary.gate_entry_timestamp)
        : primary.igp_date && primary.igp_time
        ? `${primary.igp_date} ${primary.igp_time}`
        : null,
    },
    {
      id: 'PLANT_QA',
      label: 'Plant QA',
      shortLabel: 'QA',
      status: !hasGateEntry
        ? 'UPCOMING'
        : isAllQaDefinitive
        ? 'COMPLETED'
        : 'CURRENT',
      detailText: portionQA.summaryText,
    },
    {
      id: 'FIRST_WEIGHT',
      label: 'First Weight (Loaded Vehicle)',
      shortLabel: 'First Weight (Loaded Vehicle)',
      status: !hasGateEntry || !isAllQaDefinitive
        ? 'UPCOMING'
        : hasFirstWeight
        ? 'COMPLETED'
        : 'CURRENT',
      metricText:
        primary.first_weight_of_vehicle != null
          ? `${primary.first_weight_of_vehicle.toLocaleString()} KG`
          : null,
      eventTimestamp: primary.first_weight_timestamp
        ? formatOperationalDatetime(primary.first_weight_timestamp)
        : primary.first_weight_time || null,
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
      eventTimestamp: primary.unloading_start_timestamp
        ? formatOperationalDatetime(primary.unloading_start_timestamp)
        : primary.reception_start_time || null,
      eventTimestampEnd: primary.unloading_end_timestamp
        ? formatOperationalDatetime(primary.unloading_end_timestamp)
        : primary.reception_end_time || null,
    },
    {
      id: 'SECOND_WEIGHT',
      label: 'Second Weight (After Unloading)',
      shortLabel: 'Second Weight (After Unloading)',
      status: !hasUnloadingComplete
        ? 'UPCOMING'
        : hasSecondWeight
        ? 'COMPLETED'
        : 'CURRENT',
      metricText:
        primary.second_weight_of_vehicle != null
          ? `${primary.second_weight_of_vehicle.toLocaleString()} KG`
          : null,
      eventTimestamp: primary.second_weight_timestamp
        ? formatOperationalDatetime(primary.second_weight_timestamp)
        : primary.second_weight_time || null,
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
      metricText:
        primary.authoritative_final_liters != null
          ? `${primary.authoritative_final_liters.toLocaleString()} L`
          : hasFinalReceipt && primary.computed_plant_liters != null
          ? `${primary.computed_plant_liters.toLocaleString()} L`
          : null,
      eventTimestamp: primary.final_receipt_timestamp
        ? formatOperationalDatetime(primary.final_receipt_timestamp)
        : null,
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
  } else if (isAllQaDefinitive) {
    currentStageId = 'FIRST_WEIGHT';
    currentStageLabel = 'First Weight (Loaded Vehicle)';
  } else if (hasGateEntry) {
    currentStageId = 'PLANT_QA';
    currentStageLabel = 'Plant QA Analysis';
  }

  // Derive latest event label and timestamp
  let latestEventLabel = 'Dispatch Recorded';
  let latestEventTimestamp: string | null = primary.dispatch_timestamp
    ? formatOperationalDatetime(primary.dispatch_timestamp)
    : primary.created_at
    ? formatOperationalDatetime(primary.created_at)
    : null;

  if (hasFinalReceipt && primary.final_receipt_timestamp) {
    latestEventLabel = 'Final Receipt Posted';
    latestEventTimestamp = formatOperationalDatetime(primary.final_receipt_timestamp);
  } else if (primary.second_weight_timestamp) {
    latestEventLabel = 'Second Weight (After Unloading)';
    latestEventTimestamp = formatOperationalDatetime(primary.second_weight_timestamp);
  } else if (primary.second_weight_time) {
    latestEventLabel = 'Second Weight (After Unloading)';
    latestEventTimestamp = primary.second_weight_time;
  } else if (primary.unloading_end_timestamp) {
    latestEventLabel = 'Unloading Completed';
    latestEventTimestamp = formatOperationalDatetime(primary.unloading_end_timestamp);
  } else if (primary.unloading_start_timestamp) {
    latestEventLabel = 'Unloading Started';
    latestEventTimestamp = formatOperationalDatetime(primary.unloading_start_timestamp);
  } else if (primary.reception_start_time) {
    latestEventLabel = 'Unloading Started';
    latestEventTimestamp = primary.reception_start_time;
  } else if (primary.first_weight_timestamp) {
    latestEventLabel = 'First Weight (Loaded Vehicle)';
    latestEventTimestamp = formatOperationalDatetime(primary.first_weight_timestamp);
  } else if (primary.first_weight_time) {
    latestEventLabel = 'First Weight (Loaded Vehicle)';
    latestEventTimestamp = primary.first_weight_time;
  } else if (primary.gate_entry_timestamp) {
    latestEventLabel = 'Gate Entry';
    latestEventTimestamp = formatOperationalDatetime(primary.gate_entry_timestamp);
  } else if (primary.igp_time) {
    latestEventLabel = 'Gate Entry';
    latestEventTimestamp = primary.igp_date && primary.igp_time ? `${primary.igp_date} ${primary.igp_time}` : primary.igp_time;
  }

  const isComplete = hasFinalReceipt;
  const isInPlant = hasGateEntry && !isComplete && overallStatus !== 'GATE_OUT';
  const elapsedInPlant = isInPlant ? computeElapsedInPlant(primary.gate_entry_timestamp) : null;

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

    // Sum portion dispatch quantities strictly without fabrication
    let sumGrossLiters = 0;
    let sum13TsLiters = 0;
    let allGrossPresent = portions.length > 0;
    let all13TsPresent = portions.length > 0;

    for (const p of portions) {
      if (p.dispatch_liters_gross != null) {
        sumGrossLiters += p.dispatch_liters_gross;
      } else {
        allGrossPresent = false;
      }
      if (p.computed_dispatch_13ts_liters != null) {
        sum13TsLiters += p.computed_dispatch_13ts_liters;
      } else {
        all13TsPresent = false;
      }
    }

    const vehicleAuthoritativeGrossLiters =
      primary.vehicle_dispatch_gross_liters != null
        ? primary.vehicle_dispatch_gross_liters
        : null;

    const authoritativePhysicalLiters = primary.authoritative_final_liters ?? null;

    let finalReceiptBusinessDate: string | null = null;
    if (primary.final_receipt_exists && primary.final_receipt_timestamp) {
      finalReceiptBusinessDate = getOperationalBusinessDate(new Date(primary.final_receipt_timestamp));
    }

    groups.push({
      visitId,
      vehicleNumber: primary.vehicle_number,
      tokenNumber: primary.token_number || null,
      sourceName: primary.zonal_contractor_name,
      procurementSourceId: null,
      businessDate: primary.dispatch_date || (primary.created_at ? primary.created_at.split('T')[0] : ''),
      finalReceiptBusinessDate,
      overallStatus: primary.status,
      portions,
      primaryLog: primary,

      vehicleDispatchQuantityValue:
        primary.vehicle_dispatch_quantity_value ?? primary.dispatch_liters_gross ?? primary.dispatch_kg_gross ?? null,
      vehicleDispatchQuantityUnit:
        primary.vehicle_dispatch_quantity_unit ??
        (primary.dispatch_liters_gross != null ? 'LITER' : primary.dispatch_kg_gross != null ? 'KG' : null),
      vehicleDispatchQuantityBasis: primary.vehicle_dispatch_quantity_basis ?? 'GROSS',
      totalDispatchGrossLiters: vehicleAuthoritativeGrossLiters,
      totalDispatch13TsLiters: all13TsPresent ? Number(sum13TsLiters.toFixed(2)) : null,

      firstWeightKg: primary.first_weight_of_vehicle ?? null,
      secondWeightKg: primary.second_weight_of_vehicle ?? null,
      netMilkWeightKg: primary.computed_net_milk_weight ?? null,
      physicalReceivedLiters: authoritativePhysicalLiters,
      plant13TsLiters: lifecycle.isComplete ? primary.computed_plant_13ts_liters ?? null : null,

      destinationSilo: primary.silo_storage_id || null,
      lifecycle,
    });
  }

  return groups;
}

/**
 * Check if a target Business Date string belongs to the selected OverviewDateRange
 */
export function isBusinessDateInPeriod(
  targetBusinessDate: string | null | undefined,
  serverBusinessDate: string,
  range: OverviewDateRange
): boolean {
  if (range === 'ALL') return true;
  if (!targetBusinessDate) return false;

  if (range === 'TODAY') {
    return !serverBusinessDate || targetBusinessDate === serverBusinessDate;
  }
  if (range === 'YESTERDAY') {
    if (!serverBusinessDate) return true;
    const refDate = new Date(serverBusinessDate);
    refDate.setDate(refDate.getDate() - 1);
    const yStr = refDate.toISOString().split('T')[0];
    return targetBusinessDate === yStr;
  }
  if (range === 'LAST_7') {
    if (!serverBusinessDate) return true;
    const diffMs = new Date(serverBusinessDate).getTime() - new Date(targetBusinessDate).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
    return diffDays >= 0 && diffDays < 7;
  }
  if (range === 'LAST_15') {
    if (!serverBusinessDate) return true;
    const diffMs = new Date(serverBusinessDate).getTime() - new Date(targetBusinessDate).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
    return diffDays >= 0 && diffDays < 15;
  }
  return true;
}

/**
 * Filter groups by dispatch business date range using the server business date.
 * LAST_7 = exactly 7 Business Dates (today + 6 prior).
 * LAST_15 = exactly 15 Business Dates (today + 14 prior).
 */
export function filterGroupsByDateRange(
  groups: VehicleVisitGroup[],
  serverBusinessDate: string,
  range: OverviewDateRange
): VehicleVisitGroup[] {
  return groups.filter((g) => isBusinessDateInPeriod(g.businessDate, serverBusinessDate, range));
}

/**
 * Compute the paired quantity comparison across EXACTLY the same completed receipt vehicles.
 * Population: receiptPeriodGroups (vehicles whose Final Receipt Business Date falls in period).
 * Complete paired aggregate rule:
 * - If receiptPeriodGroups is empty: all paired aggregates are null (never 0 L).
 * - For all visits: require BOTH Dispatch Gross Liters and Final Physical Received Liters.
 * - If ANY member lacks either side: paired aggregates and difference are null.
 */
export function computeCompletedReceiptQuantityComparison(
  receiptPeriodGroups: VehicleVisitGroup[]
): CompletedReceiptQuantityComparison {
  if (receiptPeriodGroups.length === 0) {
    return {
      comparableVisitCount: 0,
      dispatchGrossLiters: null,
      finalPhysicalReceivedLiters: null,
      differenceLiters: null,
      quantityDifferenceLiters: null,
      dispatch13TsLiters: null,
      plant13TsLiters: null,
      tsDifferenceLiters: null,
    };
  }

  // Check physical liters complete population
  let sumDispatchGross = 0;
  let sumFinalReceived = 0;
  let allPhysicalPresent = true;

  for (const g of receiptPeriodGroups) {
    if (g.totalDispatchGrossLiters == null || g.physicalReceivedLiters == null) {
      allPhysicalPresent = false;
      break;
    }
    sumDispatchGross += g.totalDispatchGrossLiters;
    sumFinalReceived += g.physicalReceivedLiters;
  }

  // Check 13% TS complete population
  let sumDispatch13Ts = 0;
  let sumPlant13Ts = 0;
  let all13TsPresent = true;

  for (const g of receiptPeriodGroups) {
    if (g.totalDispatch13TsLiters == null || g.plant13TsLiters == null) {
      all13TsPresent = false;
      break;
    }
    sumDispatch13Ts += g.totalDispatch13TsLiters;
    sumPlant13Ts += g.plant13TsLiters;
  }

  const dispatchGrossLiters = allPhysicalPresent ? Number(sumDispatchGross.toFixed(2)) : null;
  const finalPhysicalReceivedLiters = allPhysicalPresent ? Number(sumFinalReceived.toFixed(2)) : null;
  const differenceLiters =
    dispatchGrossLiters !== null && finalPhysicalReceivedLiters !== null
      ? Number((finalPhysicalReceivedLiters - dispatchGrossLiters).toFixed(2))
      : null;

  const dispatch13TsLiters = all13TsPresent ? Number(sumDispatch13Ts.toFixed(2)) : null;
  const plant13TsLiters = all13TsPresent ? Number(sumPlant13Ts.toFixed(2)) : null;
  const tsDifferenceLiters =
    dispatch13TsLiters !== null && plant13TsLiters !== null
      ? Number((plant13TsLiters - dispatch13TsLiters).toFixed(2))
      : null;

  return {
    comparableVisitCount: receiptPeriodGroups.length,
    dispatchGrossLiters,
    finalPhysicalReceivedLiters,
    differenceLiters,
    quantityDifferenceLiters: differenceLiters,
    dispatch13TsLiters,
    plant13TsLiters,
    tsDifferenceLiters,
  };
}

/**
 * Compute the 4 primary operational KPI cards and paired volume metrics.
 * 1. Dispatched: Visits whose dispatch Business Date falls in period.
 * 2. Completed: Authoritative final receipts whose Final Receipt Business Date falls in period.
 * 3. Paired Quantity Comparison: Uses receiptPeriodGroups for BOTH dispatch and received sides.
 */
export function computeManagerOverview(
  logs: MilkProcessLog[],
  serverBusinessDate: string,
  dateRange: OverviewDateRange
): ZMCCManagerOverviewMetrics {
  const allGroups = buildVehicleVisitGroups(logs);

  // A. Dispatched in period (distinct visits by dispatch business date)
  const dispatchPeriodGroups = allGroups.filter((g) =>
    isBusinessDateInPeriod(g.businessDate, serverBusinessDate, dateRange)
  );
  const dispatchedCount = dispatchPeriodGroups.length;

  // B. Currently in plant (all active visits currently inside factory)
  const currentlyInPlantCount = allGroups.filter((g) => g.lifecycle.isInPlant).length;

  // C. Completed in period: authoritative Final Receipt whose Final Receipt Business Date falls in period
  const receiptPeriodGroups = allGroups.filter(
    (g) =>
      g.lifecycle.isComplete &&
      isBusinessDateInPeriod(g.finalReceiptBusinessDate, serverBusinessDate, dateRange)
  );
  const completedCount = receiptPeriodGroups.length;

  // D. Plant QA Rejected Portions count for visits dispatched in period
  let rejectedPortionsCount = 0;
  for (const g of dispatchPeriodGroups) {
    for (const p of g.portions) {
      if (String(p.calculated_status).toUpperCase() === 'REJECTED') {
        rejectedPortionsCount++;
      }
    }
  }

  // E. Paired Quantity and 13% TS Comparison (Across EXACT same receiptPeriodGroups)
  const paired = computeCompletedReceiptQuantityComparison(receiptPeriodGroups);

  return {
    dispatchedCount,
    currentlyInPlantCount,
    completedCount,
    rejectedPortionsCount,
    totalDispatchGrossLiters: paired.dispatchGrossLiters,
    totalPhysicalReceivedLiters: paired.finalPhysicalReceivedLiters,
    quantityDifferenceLiters: paired.differenceLiters,
    totalDispatch13TsLiters: paired.dispatch13TsLiters,
    totalPlant13TsLiters: paired.plant13TsLiters,
    tsDifferenceLiters: paired.tsDifferenceLiters,
  };
}

/**
 * Format a non-zero metric difference with sufficient precision so small non-zeros are not displayed as "0".
 */
export function formatMetricDiff(diff: number): string {
  if (diff === 0) return '0';
  // Strip trailing zeros after up to 4 decimals of precision
  const formatted = Number(diff.toFixed(4)).toString();
  return diff > 0 ? `+${formatted}` : formatted;
}

/**
 * Derive manager attention items purely from read-model data.
 * Zero tolerances: Exact non-zero differences are shown; exact zero differences produce no attention item.
 */
export function deriveManagerAttention(logs: MilkProcessLog[]): ZMCCAttentionItem[] {
  const groups = buildVehicleVisitGroups(logs);
  const items: ZMCCAttentionItem[] = [];

  for (const g of groups) {
    // 1. Plant QA Rejection (Portion-level)
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

    // 2. Receipt Pending (Second Weight recorded, but authoritative final receipt absent)
    if (g.secondWeightKg != null && !g.primaryLog.final_receipt_exists) {
      items.push({
        id: `receipt-pending-${g.visitId}`,
        type: 'RECEIPT_PENDING',
        title: 'Receipt Pending',
        description: 'Second Weight (After Unloading) completed. Awaiting authoritative silo receipt transaction.',
        vehicleNumber: g.vehicleNumber,
        visitId: g.visitId,
        eventDate: g.primaryLog.dispatch_date || null,
        log: g.primaryLog,
        metrics: [
          { label: 'First Weight (Loaded Vehicle)', value: g.firstWeightKg != null ? `${g.firstWeightKg.toLocaleString()} KG` : '—' },
          { label: 'Second Weight (After Unloading)', value: `${g.secondWeightKg.toLocaleString()} KG` },
          { label: 'Net Milk Weight', value: g.netMilkWeightKg != null ? `${g.netMilkWeightKg.toLocaleString()} KG` : '—' },
        ],
      });
    }

    // 3. Quantity Difference (Completed visit with comparable dispatch and received liters)
    // Convention: Final Physical Received Liters - Dispatch Gross Liters. NO tolerance, NO epsilon.
    if (g.lifecycle.isComplete && g.totalDispatchGrossLiters != null && g.physicalReceivedLiters != null) {
      const rawDiff = g.physicalReceivedLiters - g.totalDispatchGrossLiters;
      const diff = Number(rawDiff.toFixed(2));
      if (rawDiff !== 0) {
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
            { label: 'Difference', value: `${diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : rawDiff > 0 ? `+${rawDiff}` : rawDiff} L` },
          ],
        });
      }
    }

    // 4. Quality Difference (Portion-level Dispatch vs Plant LR / Fat difference)
    // Convention: Plant LR - Dispatch LR, Plant Fat - Dispatch Fat. EXACT zero check, NO epsilon.
    for (const p of g.portions) {
      if (
        p.dispatch_lr != null &&
        p.sampling_lr != null &&
        p.dispatch_fat != null &&
        p.sampling_fat != null
      ) {
        const rawLrDiff = p.sampling_lr - p.dispatch_lr;
        const rawFatDiff = p.sampling_fat - p.dispatch_fat;

        if (rawLrDiff !== 0 || rawFatDiff !== 0) {
          const lrDiffStr = formatMetricDiff(rawLrDiff);
          const fatDiffStr = formatMetricDiff(rawFatDiff);
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
              { label: 'LR (Disp / Plant)', value: `${p.dispatch_lr} / ${p.sampling_lr} (${lrDiffStr})` },
              { label: 'Fat (Disp / Plant)', value: `${p.dispatch_fat}% / ${p.sampling_fat}% (${fatDiffStr}%)` },
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

/**
 * Derives Cross Verification reconciliation items for each VehicleVisitGroup
 */
export function deriveVehicleReconciliationItems(
  groups: VehicleVisitGroup[]
): VehicleReconciliationItem[] {
  return groups.map((g) => {
    // 1. Portion-level quality reconciliation
    const portions: PortionQualityReconciliation[] = g.portions.map((p) => {
      const pNum = p.portion_number ? `P-${String(p.portion_number).padStart(2, '0')}` : 'P-01';

      const dispatchLr = p.dispatch_lr != null ? p.dispatch_lr : null;
      const plantLr = p.sampling_lr != null ? p.sampling_lr : null;
      let lrDiff: number | null = null;
      let lrDiffText = '—';
      if (plantLr != null && dispatchLr != null) {
        lrDiff = Number((plantLr - dispatchLr).toFixed(4));
        lrDiffText = lrDiff === 0 ? '0' : formatMetricDiff(lrDiff);
      }

      const dispatchFat = p.dispatch_fat != null ? p.dispatch_fat : null;
      const plantFat = p.sampling_fat != null ? p.sampling_fat : null;
      let fatDiff: number | null = null;
      let fatDiffText = '—';
      if (plantFat != null && dispatchFat != null) {
        fatDiff = Number((plantFat - dispatchFat).toFixed(4));
        fatDiffText = fatDiff === 0 ? '0%' : `${formatMetricDiff(fatDiff)}%`;
      }

      const rawCalc = String(p.calculated_status || '').toUpperCase();
      let qaDecision: 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING' = 'PENDING';
      if (rawCalc === 'ACCEPTED') {
        qaDecision = 'ACCEPTED';
      } else if (rawCalc === 'REJECTED') {
        qaDecision = 'REJECTED';
      } else if (rawCalc === 'HOLD') {
        qaDecision = 'HOLD';
      }

      return {
        portionNumber: pNum,
        log: p,
        dispatchLr,
        plantLr,
        lrDiff,
        lrDiffText,
        dispatchFat,
        plantFat,
        fatDiff,
        fatDiffText,
        qaDecision,
        qaDecisionRemarks: p.rejection_reasons || p.remarks || null,
      };
    });

    // 2. Vehicle-level quantity reconciliation
    const dispatchGrossLiters = g.totalDispatchGrossLiters;
    const physicalReceivedLiters = g.physicalReceivedLiters; // strictly authoritative_final_liters
    let quantityDifferenceLiters: number | null = null;
    let quantityDifferenceText = '—';
    let hasQuantityDifference = false;

    if (dispatchGrossLiters != null && physicalReceivedLiters != null) {
      quantityDifferenceLiters = Number((physicalReceivedLiters - dispatchGrossLiters).toFixed(2));
      hasQuantityDifference = quantityDifferenceLiters !== 0;
      if (quantityDifferenceLiters === 0) {
        quantityDifferenceText = '0 L';
      } else if (quantityDifferenceLiters > 0) {
        quantityDifferenceText = `+${quantityDifferenceLiters.toLocaleString()} L`;
      } else {
        quantityDifferenceText = `${quantityDifferenceLiters.toLocaleString()} L`;
      }
    }

    const hasQualityDifference = portions.some(
      (p) => (p.lrDiff != null && p.lrDiff !== 0) || (p.fatDiff != null && p.fatDiff !== 0)
    );
    const hasRejection = portions.some((p) => p.qaDecision === 'REJECTED');
    const hasHold = portions.some((p) => p.qaDecision === 'HOLD');
    const isCompletedReceipt = g.lifecycle.isComplete;
    const isReceiptPending = g.secondWeightKg != null && !g.lifecycle.isComplete;

    return {
      group: g,
      visitId: g.visitId,
      vehicleNumber: g.vehicleNumber,
      tokenNumber: g.tokenNumber,
      businessDate: g.businessDate,
      portionCount: g.portions.length,
      lifecycleStatus: g.lifecycle.currentStageLabel,
      isCompletedReceipt,
      isReceiptPending,

      dispatchGrossLiters,
      dispatch13TsLiters: g.totalDispatch13TsLiters,
      netMilkWeightKg: g.netMilkWeightKg,
      physicalReceivedLiters,
      plant13TsLiters: g.plant13TsLiters,
      quantityDifferenceLiters,
      quantityDifferenceText,
      hasQuantityDifference,

      destinationSilo: g.destinationSilo,
      finalReceiptTimestamp: g.primaryLog.final_receipt_timestamp || null,

      firstWeightTimestamp: g.primaryLog.first_weight_timestamp || null,
      secondWeightTimestamp: g.primaryLog.second_weight_timestamp || null,
      firstWeightKg: g.firstWeightKg,
      secondWeightKg: g.secondWeightKg,

      portions,
      hasQualityDifference,
      hasRejection,
      hasHold,
    };
  });
}

/**
 * Filter Cross Verification reconciliation items by search query and reconciliation state
 */
export function filterVehicleReconciliationItems(
  items: VehicleReconciliationItem[],
  searchQuery: string,
  filterState: CrossVerificationFilter
): VehicleReconciliationItem[] {
  return items.filter((item) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        item.vehicleNumber.toLowerCase().includes(q) ||
        (item.tokenNumber && item.tokenNumber.toLowerCase().includes(q));
      if (!match) return false;
    }

    switch (filterState) {
      case 'COMPLETED':
        return item.isCompletedReceipt;
      case 'RECEIPT_PENDING':
        return item.isReceiptPending;
      case 'HAS_QUANTITY_DIFF':
        return item.hasQuantityDifference;
      case 'HAS_QUALITY_DIFF':
        return item.hasQualityDifference;
      case 'HAS_REJECTION':
        return item.hasRejection;
      case 'ALL':
      default:
        return true;
    }
  });
}

/**
 * Derives flat portion-level Quality & Rejection items from source-scoped MilkProcessLog rows.
 * Preserves strict portion QA decision authority (no fallback to vehicle workflow status).
 */
export function deriveQualityRejectionItems(logs: MilkProcessLog[]): QualityRejectionItem[] {
  return logs.map((p) => {
    const visitId = p.id;
    const vehicleNumber = p.vehicle_number;
    const tokenNumber = p.token_number || null;
    const businessDate = p.dispatch_date || (p.created_at ? p.created_at.split('T')[0] : '');
    const rawPortion = p.portion_number || '1';
    const portionNumber = rawPortion.startsWith('P-') ? rawPortion : `P-${rawPortion.padStart(2, '0')}`;

    // Portion QA Authority: calculated_status derived from VisitPortion.plant_decision
    const rawCalc = String(p.calculated_status || '').toUpperCase();
    let qaDecision: 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING' = 'PENDING';
    if (rawCalc === 'ACCEPTED') {
      qaDecision = 'ACCEPTED';
    } else if (rawCalc === 'REJECTED') {
      qaDecision = 'REJECTED';
    } else if (rawCalc === 'HOLD') {
      qaDecision = 'HOLD';
    }

    const qaDecisionRemarks = p.rejection_reasons || p.remarks || null;
    const rejectionReasons = p.rejection_reasons || null;

    // LR comparison (Plant LR LT-000008)
    const dispatchLr = p.dispatch_lr != null ? p.dispatch_lr : null;
    const plantLr = p.sampling_lr != null ? p.sampling_lr : null;
    let lrDiff: number | null = null;
    let lrDiffText = '—';
    if (plantLr != null && dispatchLr != null) {
      lrDiff = Number((plantLr - dispatchLr).toFixed(2));
      lrDiffText = lrDiff === 0 ? '0' : formatMetricDiff(lrDiff);
    }

    // Fat comparison (Plant Fat LT-000026)
    const dispatchFat = p.dispatch_fat != null ? p.dispatch_fat : null;
    const plantFat = p.sampling_fat != null ? p.sampling_fat : null;
    let fatDiff: number | null = null;
    let fatDiffText = '—';
    if (plantFat != null && dispatchFat != null) {
      fatDiff = Number((plantFat - dispatchFat).toFixed(4));
      fatDiffText = fatDiff === 0 ? '0%' : `${formatMetricDiff(fatDiff)}%`;
    }

    const hasQualityDifference = (lrDiff != null && lrDiff !== 0) || (fatDiff != null && fatDiff !== 0);

    // QA Event Timestamp (Sampling / testing completion)
    let qaEventTimestamp: string | null = null;
    if (p.sampling_date && p.sampling_time_end) {
      qaEventTimestamp = `${p.sampling_date}T${p.sampling_time_end}`;
    } else if (p.sampling_date && p.sampling_time_start) {
      qaEventTimestamp = `${p.sampling_date}T${p.sampling_time_start}`;
    } else if (p.created_at) {
      qaEventTimestamp = p.created_at;
    }

    return {
      visitId,
      vehicleNumber,
      tokenNumber,
      businessDate,
      portionNumber,
      log: p,
      qaDecision,
      qaDecisionRemarks,
      rejectionReasons,
      dispatchLr,
      plantLr,
      lrDiff,
      lrDiffText,
      dispatchFat,
      plantFat,
      fatDiff,
      fatDiffText,
      hasQualityDifference,
      qaEventTimestamp,
    };
  });
}

/**
 * Computes summary KPI metrics across the selected Quality & Rejection items.
 */
export function deriveQualityRejectionSummary(items: QualityRejectionItem[]): QualityRejectionSummary {
  const totalPortions = items.length;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let holdCount = 0;
  let pendingCount = 0;
  let qualityDiffCount = 0;
  const vehiclesWithRejections = new Set<string>();

  for (const item of items) {
    switch (item.qaDecision) {
      case 'ACCEPTED':
        acceptedCount++;
        break;
      case 'REJECTED':
        rejectedCount++;
        vehiclesWithRejections.add(item.vehicleNumber);
        break;
      case 'HOLD':
        holdCount++;
        break;
      case 'PENDING':
      default:
        pendingCount++;
        break;
    }
    if (item.hasQualityDifference) {
      qualityDiffCount++;
    }
  }

  return {
    totalPortions,
    acceptedCount,
    rejectedCount,
    holdCount,
    pendingCount,
    vehiclesWithRejectionsCount: vehiclesWithRejections.size,
    qualityDiffCount,
  };
}

/**
 * Filters Quality & Rejection items based on search query and active tab filter.
 */
export function filterQualityRejectionItems(
  items: QualityRejectionItem[],
  searchQuery: string,
  filterState: QualityRejectionFilter
): QualityRejectionItem[] {
  return items.filter((item) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        item.vehicleNumber.toLowerCase().includes(q) ||
        (item.tokenNumber && item.tokenNumber.toLowerCase().includes(q)) ||
        item.portionNumber.toLowerCase().includes(q);
      if (!match) return false;
    }

    switch (filterState) {
      case 'ACCEPTED':
        return item.qaDecision === 'ACCEPTED';
      case 'REJECTED':
        return item.qaDecision === 'REJECTED';
      case 'HOLD':
        return item.qaDecision === 'HOLD';
      case 'PENDING':
        return item.qaDecision === 'PENDING';
      case 'HAS_QUALITY_DIFF':
        return item.hasQualityDifference;
      case 'ALL':
      default:
        return true;
    }
  });
}
