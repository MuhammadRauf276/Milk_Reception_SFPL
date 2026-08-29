import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorOverviewMetrics,
  ContractorQualityMetrics,
  ContractorVehicleVisit,
  ContractorJourneyStage,
  ContractorPortionSummary,
} from './contractorManagerTypes';

/**
 * Strict canonical lab test IDs for Plant QA
 */
export const PLANT_LR_TEST_CODE = 'LT-000008';
export const PLANT_FAT_TEST_CODE = 'LT-000026';

/**
 * Summarize portion-level QA decisions for a vehicle visit
 */
export function summarizeContractorPortions(portions: MilkProcessLog[]): ContractorPortionSummary {
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
  let badgeType: ContractorPortionSummary['badgeType'] = 'EMPTY';

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
    if (accepted > 0) parts.push(`${accepted} Acc`);
    if (rejected > 0) parts.push(`${rejected} Rej`);
    if (hold > 0) parts.push(`${hold} Hold`);
    if (pending > 0) parts.push(`${pending} Pend`);
    summaryText = `${parts.join(' · ')} (Mixed QA Outcomes)`;
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
 * Derive authoritative journey milestone for a contractor visit
 */
export function deriveContractorJourneyStage(
  status: string,
  secondWeightTimestamp: string | null | undefined,
  finalReceiptExists: boolean
): { stage: ContractorJourneyStage; label: string } {
  if (status === 'CANCELLED') {
    return { stage: 'CANCELLED', label: 'Cancelled' };
  }

  if (finalReceiptExists || status === 'COMPLETED') {
    return { stage: 'COMPLETED', label: 'Completed' };
  }

  // Receipt Pending rule: Second Weight exists AND authoritative final receipt does NOT exist
  if (secondWeightTimestamp && !finalReceiptExists) {
    return { stage: 'RECEIPT_PENDING', label: 'Receipt Pending' };
  }

  if (status === 'UNLOADING' || status === 'READY_FOR_TARE' || status === 'READY_FOR_UNLOADING') {
    return { stage: 'UNLOADING', label: 'Silo Unloading' };
  }

  if (status === 'GROSS_WEIGHED' || status === 'READY_FOR_GROSS') {
    return { stage: 'WEIGHBRIDGE_GROSS', label: 'Weighbridge' };
  }

  if (status === 'PLANT_QA' || status === 'IN_LAB') {
    return { stage: 'PLANT_QA', label: 'QA Testing' };
  }

  if (status === 'TOKEN_ISSUED' || status === 'GATE_IN' || status === 'GATE_ENTRY') {
    return { stage: 'GATE_ENTRY', label: 'Security Gate' };
  }

  return { stage: 'DISPATCHED', label: 'Dispatched' };
}

/**
 * Group flat portion logs into unified ContractorVehicleVisit records
 */
export function buildContractorVehicleVisits(logs: MilkProcessLog[]): ContractorVehicleVisit[] {
  const visitMap = new Map<number, MilkProcessLog[]>();

  for (const log of logs) {
    const vId = log.id;
    if (!visitMap.has(vId)) {
      visitMap.set(vId, []);
    }
    visitMap.get(vId)!.push(log);
  }

  const visits: ContractorVehicleVisit[] = [];

  visitMap.forEach((portions, vId) => {
    const first = portions[0];
    const qaSummary = summarizeContractorPortions(portions);

    // Whole vehicle Gross Liters authority
    const grossLiters =
      first.vehicle_dispatch_gross_liters != null
        ? Number(first.vehicle_dispatch_gross_liters)
        : first.dispatch_liters_gross != null
        ? Number(first.dispatch_liters_gross)
        : 0;

    const finalReceiptExists = Boolean(first.final_receipt_exists);
    const authoritativeFinalLiters =
      first.authoritative_final_liters != null ? Number(first.authoritative_final_liters) : null;

    const { stage, label } = deriveContractorJourneyStage(
      first.status,
      first.second_weight_timestamp,
      finalReceiptExists
    );

    visits.push({
      visitId: vId,
      visitNumber: first.visit_number || `VISIT-${vId}`,
      receptionNumber: first.reception_number || `REC-${vId}`,
      vehicleNumber: first.vehicle_number || 'UNKNOWN',
      tokenNumber: first.token_number || null,
      procurementSourceName: first.zonal_contractor_name || 'Assigned Contractor',
      operationalDate: first.dispatch_date || '',
      dispatchTimestamp: first.dispatch_timestamp || null,
      gateEntryTimestamp: first.gate_entry_timestamp || null,
      gateExitTimestamp: first.gate_exit_timestamp || null,
      firstWeightTimestamp: first.first_weight_timestamp || null,
      secondWeightTimestamp: first.second_weight_timestamp || null,
      unloadingEndTimestamp: first.unloading_end_timestamp || null,
      grossLiters,
      status: first.status,
      journeyStage: stage,
      journeyStageLabel: label,
      portions,
      qaSummary,
      finalReceiptExists,
      authoritativeFinalLiters,
      finalReceiptTimestamp: first.final_receipt_timestamp || null,
      firstWeightKg: first.first_weight_of_vehicle ?? null,
      secondWeightKg: first.second_weight_of_vehicle ?? null,
      netWeightKg: first.computed_net_milk_weight ?? null,
    });
  });

  // Sort latest first
  visits.sort((a, b) => b.visitId - a.visitId);

  return visits;
}

/**
 * Compute canonical overview summary metrics
 */
export function computeContractorOverview(visits: ContractorVehicleVisit[]): ContractorOverviewMetrics {
  let totalGrossLiters = 0;
  let totalReceivedLiters = 0;
  let activeInPlantCount = 0;
  let completedReceiptsCount = 0;

  for (const v of visits) {
    totalGrossLiters += v.grossLiters || 0;

    if (v.finalReceiptExists && v.authoritativeFinalLiters != null) {
      completedReceiptsCount++;
      totalReceivedLiters += v.authoritativeFinalLiters;
    } else if (v.status !== 'CANCELLED') {
      activeInPlantCount++;
    }
  }

  return {
    totalDispatches: visits.length,
    activeInPlantCount,
    completedReceiptsCount,
    totalReceivedLiters: Math.round(totalReceivedLiters * 100) / 100,
    totalGrossLiters: Math.round(totalGrossLiters * 100) / 100,
  };
}

/**
 * Compute portion-level QA summary metrics across all portions
 */
export function computeContractorQualityMetrics(logs: MilkProcessLog[]): ContractorQualityMetrics {
  let acceptedPortions = 0;
  let rejectedPortions = 0;
  let holdPortions = 0;
  let pendingPortions = 0;

  for (const log of logs) {
    const st = String(log.calculated_status || 'PENDING').toUpperCase();
    if (st === 'ACCEPTED') acceptedPortions++;
    else if (st === 'REJECTED') rejectedPortions++;
    else if (st === 'HOLD') holdPortions++;
    else pendingPortions++;
  }

  return {
    totalPortions: logs.length,
    acceptedPortions,
    rejectedPortions,
    holdPortions,
    pendingPortions,
  };
}
