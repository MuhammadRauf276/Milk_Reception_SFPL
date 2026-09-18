/**
 * Canonical Plant Final Dual Reconciliation Calculation Service (Stage 6G-F)
 * Provides source-neutral physical and commercial reconciliation between frozen source dispatch
 * and authoritative final Plant receipt.
 */

export const RECONCILIATION_CALCULATION_VERSION = '1.0';

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
