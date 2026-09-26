/**
 * Canonical Plant Final Dual Reconciliation Calculation Service (Stage 6G-F)
 * Provides source-neutral physical and commercial reconciliation between frozen source dispatch
 * and authoritative final Plant receipt.
 */

export const RECONCILIATION_CALCULATION_VERSION = '1.0';

export interface MotJourneyOriginSnapshot {
  journeyId: string;
  shopCount: number;
  grossLiters: number;
  at13tsLiters: number;
}

export interface ZmccMeasuredDestinationSnapshot {
  labSessionId: string;
  finalDecision: string | null;
  grossLiters: number | null;
  at13tsLiters: number | null;
}

/** Destination minus origin: negative is loss, positive is gain. */
export function calculateLossGain(origin: number | null, destination: number | null) {
  if (origin == null || destination == null || origin <= 0) return { signedVariance: null, loss: null, gain: null, lossPercent: null };
  const signedVariance = Number((destination - origin).toFixed(2));
  return {
    signedVariance,
    loss: signedVariance < 0 ? Number(Math.abs(signedVariance).toFixed(2)) : 0,
    gain: signedVariance > 0 ? signedVariance : 0,
    lossPercent: Number((((origin - destination) / origin) * 100).toFixed(4)),
  };
}

export function calculateAreaDualVariance(origin: MotJourneyOriginSnapshot, destination: ZmccMeasuredDestinationSnapshot) {
  return {
    grossLiters: calculateLossGain(origin.grossLiters, destination.grossLiters),
    at13tsLiters: calculateLossGain(origin.at13tsLiters, destination.at13tsLiters),
  };
}

export function wholeArrivalDisposition(finalDecision: string | null, measuredQuantity: number | null) {
  if (finalDecision === 'ACCEPTED') return { acceptedQuantity: measuredQuantity, rejectedQuantity: 0, allocationEvidence: 'WHOLE_ARRIVAL_DECISION' as const };
  if (finalDecision === 'REJECTED') return { acceptedQuantity: 0, rejectedQuantity: measuredQuantity, allocationEvidence: 'WHOLE_ARRIVAL_DECISION' as const };
  return { acceptedQuantity: null, rejectedQuantity: null, allocationEvidence: 'UNRESOLVED' as const };
}

/** Route reconciliation always joins a frozen dispatch identity to its final plant receipt. */
export function calculateRouteDualVariance(
  dispatchGrossLiters: number | null, dispatchAt13tsLiters: number | null,
  plantGrossLiters: number | null, plantAt13tsLiters: number | null
) {
  return {
    grossLiters: calculateLossGain(dispatchGrossLiters, plantGrossLiters),
    at13tsLiters: calculateLossGain(dispatchAt13tsLiters, plantAt13tsLiters),
  };
}

export interface MtdStockBridgeInput {
  openingStock: number; originQuantity: number; plantReceipts: number; closingStock: number;
  approvedDisposition: number; unresolvedQuantity: number;
}
export function calculateMtdStockBridge(input: MtdStockBridgeInput) {
  const expectedClosing = input.openingStock + input.originQuantity - input.plantReceipts - input.approvedDisposition;
  return { ...input, expectedClosing: Number(expectedClosing.toFixed(2)), stockHandlingVariance: Number((input.closingStock - expectedClosing).toFixed(2)) };
}

export function summarizeLossGain(rows: Array<{ gross: ReturnType<typeof calculateLossGain>; at13ts: ReturnType<typeof calculateLossGain> }>) {
  return rows.reduce((total, row) => ({
    grossLoss: total.grossLoss + (row.gross.loss || 0), grossGain: total.grossGain + (row.gross.gain || 0),
    at13tsLoss: total.at13tsLoss + (row.at13ts.loss || 0), at13tsGain: total.at13tsGain + (row.at13ts.gain || 0),
  }), { grossLoss: 0, grossGain: 0, at13tsLoss: 0, at13tsGain: 0 });
}

export interface MtdReconciliationBuckets {
  areaVariance: number; routeVariance: number; approvedDisposition: number;
  stockHandlingVariance: number; unresolvedQuantity: number;
}
/** Unresolved quantity is reported separately and is never silently included in loss. */
export function summarizeMtdReconciliation(buckets: MtdReconciliationBuckets) {
  const finalizedNetVariance = buckets.areaVariance + buckets.routeVariance + buckets.approvedDisposition + buckets.stockHandlingVariance;
  return { ...buckets, finalizedNetVariance: Number(finalizedNetVariance.toFixed(2)), unresolvedExposure: buckets.unresolvedQuantity };
}

export function splitFinalizedAndUnresolved<T extends { isResolved: boolean }>(movements: T[]) {
  return { finalized: movements.filter((m) => m.isResolved), unresolved: movements.filter((m) => !m.isResolved) };
}

/** Final ZMCC measurement is the destination truth for area reconciliation. */
export function serializeZmccMeasuredDestination(session: {
  id: bigint; final_decision?: string | null; decision: string | null; gross_liters: unknown; at_13ts_liters: unknown;
}): ZmccMeasuredDestinationSnapshot {
  return {
    labSessionId: session.id.toString(), finalDecision: session.final_decision ?? session.decision,
    grossLiters: session.gross_liters == null ? null : Number(session.gross_liters),
    at13tsLiters: session.at_13ts_liters == null ? null : Number(session.at_13ts_liters),
  };
}

/** Uses the finalized journey summary; reporting never rebuilds origin totals from mutable shop rows. */
export function serializeMotJourneyOrigin(summary: {
  journey_id: bigint; collected_shop_count: number; total_gross_liters: unknown; total_at_13ts_liters: unknown;
}): MotJourneyOriginSnapshot {
  return {
    journeyId: summary.journey_id.toString(), shopCount: summary.collected_shop_count,
    grossLiters: Number(summary.total_gross_liters), at13tsLiters: Number(summary.total_at_13ts_liters),
  };
}

export interface DualReconciliationInput {
  sentGrossLiters?: number | null;
  receivedGrossLiters: number;
  sentAt13tsLiters?: number | null;
  receivedAt13tsLiters: number;
}

export interface DualReconciliationCalculationResult {
  sentGrossLiters: number | null;
  receivedGrossLiters: number;
  grossVarianceLiters: number | null;
  grossVariancePercent: number | null;

  sentAt13tsLiters: number | null;
  receivedAt13tsLiters: number;
  at13tsVarianceLiters: number | null;
  at13tsVariancePercent: number | null;

  reconciliationCalculationVersion: string;
}

/**
 * Calculates signed Gross & @13TS volumetric dual reconciliation.
 *
 * Signed meaning:
 *   negative = loss (received < sent)
 *   positive = gain (received > sent)
 *   zero     = balanced (received == sent)
 *
 * Rules:
 * 1. Physical Truth: Gross Liters = Net KG / Plant Density.
 * 2. Commercial Truth: @13TS Liters = Gross Liters * TS / 13.
 * 3. Authoritative Received Quantities: receivedGrossLiters and receivedAt13tsLiters are strictly
 *    positive finite numbers representing the audited Plant Final receipt.
 * 4. gross_variance_liters = received_gross_liters - sent_gross_liters
 * 5. gross_variance_percent = (gross_variance_liters / sent_gross_liters) * 100
 * 6. at_13ts_variance_liters = received_at_13ts_liters - sent_at_13ts_liters
 * 7. at_13ts_variance_percent = (at_13ts_variance_liters / sent_at_13ts_liters) * 100
 * 8. If sent value is null, undefined, or non-positive (<= 0), the related percentage is NULL.
 *    0 is NEVER a substitute for missing truth.
 * 9. Intermediate precision: computed using IEEE-754 double precision without premature truncation.
 */
export function calculateDualReconciliation(input: DualReconciliationInput): DualReconciliationCalculationResult {
  const { sentGrossLiters, receivedGrossLiters, sentAt13tsLiters, receivedAt13tsLiters } = input;

  if (
    typeof receivedGrossLiters !== 'number' ||
    isNaN(receivedGrossLiters) ||
    !isFinite(receivedGrossLiters) ||
    receivedGrossLiters <= 0
  ) {
    throw new Error(
      `Authoritative received Gross Liters must be a positive finite number (received: ${receivedGrossLiters}).`
    );
  }

  if (
    typeof receivedAt13tsLiters !== 'number' ||
    isNaN(receivedAt13tsLiters) ||
    !isFinite(receivedAt13tsLiters) ||
    receivedAt13tsLiters <= 0
  ) {
    throw new Error(
      `Authoritative received @13TS Liters must be a positive finite number (received: ${receivedAt13tsLiters}).`
    );
  }

  // 1. Physical Variance
  let grossVarianceLiters: number | null = null;
  let grossVariancePercent: number | null = null;

  const validSentGross =
    sentGrossLiters !== null && sentGrossLiters !== undefined && !isNaN(sentGrossLiters)
      ? Number(sentGrossLiters)
      : null;

  if (validSentGross !== null) {
    const rawGrossVariance = receivedGrossLiters - validSentGross;
    grossVarianceLiters = Number(rawGrossVariance.toFixed(2));
    if (validSentGross > 0) {
      grossVariancePercent = Number(((rawGrossVariance / validSentGross) * 100).toFixed(4));
    }
  }

  // 2. Commercial Variance
  let at13tsVarianceLiters: number | null = null;
  let at13tsVariancePercent: number | null = null;

  const validSentAt13ts =
    sentAt13tsLiters !== null && sentAt13tsLiters !== undefined && !isNaN(sentAt13tsLiters)
      ? Number(sentAt13tsLiters)
      : null;

  if (validSentAt13ts !== null) {
    const rawAt13tsVariance = receivedAt13tsLiters - validSentAt13ts;
    at13tsVarianceLiters = Number(rawAt13tsVariance.toFixed(2));
    if (validSentAt13ts > 0) {
      at13tsVariancePercent = Number(((rawAt13tsVariance / validSentAt13ts) * 100).toFixed(4));
    }
  }

  return {
    sentGrossLiters: validSentGross,
    receivedGrossLiters: Number(receivedGrossLiters.toFixed(2)),
    grossVarianceLiters,
    grossVariancePercent,

    sentAt13tsLiters: validSentAt13ts,
    receivedAt13tsLiters: Number(receivedAt13tsLiters.toFixed(2)),
    at13tsVarianceLiters,
    at13tsVariancePercent,

    reconciliationCalculationVersion: RECONCILIATION_CALCULATION_VERSION,
  };
}
