/**
 * Canonical Milk Reception Quality & Volume Calculation Formulas
 * Based on Plant Operational Standards
 */

/**
 * Calculates SNF % (Solids-Not-Fat) from Lactometer Reading (LR) and Fat %
 * Formula: SNF = (LR / 4) + (0.22 * Fat) + 0.72
 */
export function calculateSNF(lr: number, fat: number): number {
  if (isNaN(lr) || isNaN(fat)) return 0;
  return lr / 4 + 0.22 * fat + 0.72;
}

/**
 * Calculates Total Solids (TS %) from Fat % and SNF %
 * Formula: TS = Fat + SNF
 */
export function calculateTS(fat: number, snf: number): number {
  if (isNaN(fat) || isNaN(snf)) return 0;
  return fat + snf;
}

/**
 * Calculates SNF to Fat Ratio
 * Formula: Ratio = SNF / Fat
 */
export function calculateRatio(snf: number, fat: number): number {
  if (isNaN(snf) || isNaN(fat) || fat === 0) return 0;
  return snf / fat;
}

/**
 * Calculates Milk Density (g/mL or kg/L) from Lactometer Reading (LR)
 * Formula: Density = 1 + (LR / 1000)
 */
export function calculateDensity(lr: number): number {
  if (isNaN(lr)) return 1.0;
  return 1 + lr / 1000;
}

/**
 * Calculates Physical Milk Volume in Liters from Mass in Kg and LR
 * Formula: Liters = Kg / (1 + LR / 1000)
 */
export function calculatePhysicalLiters(kg: number, lr: number): number {
  if (isNaN(kg) || kg <= 0) return 0;
  const density = calculateDensity(lr);
  return kg / density;
}

/**
 * Calculates Commercial Standardized Volume in @13 TS Liters
 * Formula: @13 TS Liters = Physical Liters * TS / 13
 * NOTE: Commercial/payment metric ONLY. Must NEVER be used for physical silo stock/capacity.
 */
export function calculateAt13TSLiters(physicalLiters: number, tsPercent: number): number {
  if (isNaN(physicalLiters) || isNaN(tsPercent) || physicalLiters <= 0) return 0;
  return (physicalLiters * tsPercent) / 13;
}

/**
 * Calculates Informational Equivalent Mass in Kg from Volume in Liters and Density
 * Formula: Kg = Liters * Density
 * NOTE: Informational/derived metric ONLY for contractor liter declarations. Original liters remain authoritative.
 */
export function calculateEquivalentKgFromLiters(liters: number, density: number): number {
  if (isNaN(liters) || isNaN(density) || liters <= 0) return 0;
  return Number((liters * density).toFixed(2));
}

/**
 * Calculates Dispatch Gross Liters from declared quantity, unit, and optional LR.
 * - For LITER: Returns declared liters directly (no density conversion required).
 * - For KG: Returns declared KG / Density (where Density = 1 + LR / 1000). If LR is missing/invalid, returns null.
 */
export function calculateGrossLiters(
  quantity: number | null | undefined,
  unit: 'KG' | 'LITER' | string | null | undefined,
  lr?: number | null | undefined
): number | null {
  if (quantity === null || quantity === undefined || isNaN(quantity) || quantity <= 0) {
    return null;
  }
  const normalizedUnit = (unit || '').trim().toUpperCase();
  if (normalizedUnit === 'LITER') {
    return quantity;
  }
  if (normalizedUnit === 'KG') {
    if (lr === null || lr === undefined || isNaN(lr) || lr <= 0) {
      return null;
    }
    const density = calculateDensity(lr);
    if (density <= 0) return null;
    return quantity / density;
  }
  return null;
}

export const MOT_CALCULATION_VERSION = '1.0';
export const PLANT_CALCULATION_VERSION = '1.0';

export interface CanonicalMilkMetrics {
  density: number;
  grossLiters: number;
  snf: number;
  ts: number;
  totalSolids: number;
  at13tsLiters: number;
  at13TsLiters: number;
  at_13ts_liters: number;
  calculationVersion: string;
}

/**
 * Computes canonical milk metrics for MOT shop collections and previews.
 * Uses centralized rounding policy so frontend and backend calculations never diverge.
 */
export function computeCanonicalMilkMetrics(
  quantity: number,
  unit: 'LITER' | 'KG' | string,
  lr: number,
  fat: number
): CanonicalMilkMetrics {
  if (quantity === null || quantity === undefined || isNaN(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive number.');
  }
  if (lr === null || lr === undefined || isNaN(lr) || lr <= 0) {
    throw new Error('LR must be a positive number.');
  }
  if (fat === null || fat === undefined || isNaN(fat) || fat < 0) {
    throw new Error('Fat cannot be negative.');
  }

  const normalizedUnit = (unit || '').trim().toUpperCase();
  if (normalizedUnit !== 'LITER' && normalizedUnit !== 'KG') {
    throw new Error('Quantity unit must be either LITER or KG.');
  }

  const rawDensity = calculateDensity(lr);
  const rawGrossLiters = calculateGrossLiters(quantity, normalizedUnit, lr);
  if (rawGrossLiters === null || rawGrossLiters <= 0) {
    throw new Error('Failed to compute positive Gross Liters.');
  }
  const rawSnf = calculateSNF(lr, fat);
  const rawTs = calculateTS(fat, rawSnf);
  const rawAt13tsLiters = calculateAt13TSLiters(rawGrossLiters, rawTs);

  return {
    density: Number(rawDensity.toFixed(4)),
    grossLiters: Number(rawGrossLiters.toFixed(2)),
    snf: Number(rawSnf.toFixed(2)),
    ts: Number(rawTs.toFixed(2)),
    totalSolids: Number(rawTs.toFixed(2)),
    at13tsLiters: Number(rawAt13tsLiters.toFixed(2)),
    at13TsLiters: Number(rawAt13tsLiters.toFixed(2)),
    at_13ts_liters: Number(rawAt13tsLiters.toFixed(2)),
    calculationVersion: MOT_CALCULATION_VERSION,
  };
}

export interface WeightedMilkBatch {
  grossLiters: number;
  lr?: number | null;
  fat?: number | null;
  snf?: number | null;
  ts?: number | null;
  at13tsLiters?: number | null;
}

export interface WeightedCompositeMetrics {
  totalGrossLiters: number;
  weightedLr: number | null;
  weightedFat: number | null;
  weightedSnf: number | null;
  weightedTs: number | null;
  weightedDensity: number | null;
  totalAt13tsLiters: number;
}

/**
 * Computes authoritative weighted averages and @13 TS Liters across multiple portions/batches
 * for a tanker or storage tank using the volume-weighted formula.
 */
export function computeWeightedMilkMetrics(batches: WeightedMilkBatch[]): WeightedCompositeMetrics {
  let totalGross = 0;
  let lrSum = 0;
  let lrQty = 0;
  let fatSum = 0;
  let fatQty = 0;

  for (const b of batches) {
    if (b.grossLiters <= 0 || isNaN(b.grossLiters)) continue;
    totalGross += b.grossLiters;
    if (b.lr !== null && b.lr !== undefined && !isNaN(b.lr) && b.lr > 0) {
      lrSum += b.lr * b.grossLiters;
      lrQty += b.grossLiters;
    }
    if (b.fat !== null && b.fat !== undefined && !isNaN(b.fat) && b.fat >= 0) {
      fatSum += b.fat * b.grossLiters;
      fatQty += b.grossLiters;
    }
  }

  const weightedLr = lrQty > 0 ? Number((lrSum / lrQty).toFixed(2)) : null;
  const weightedFat = fatQty > 0 ? Number((fatSum / fatQty).toFixed(2)) : null;
  const weightedDensity = weightedLr !== null ? Number(calculateDensity(weightedLr).toFixed(4)) : null;
  const weightedSnf = weightedLr !== null && weightedFat !== null ? Number(calculateSNF(weightedLr, weightedFat).toFixed(2)) : null;
  const weightedTs = weightedFat !== null && weightedSnf !== null ? Number(calculateTS(weightedFat, weightedSnf).toFixed(2)) : null;
  const totalAt13tsLiters = weightedTs !== null && totalGross > 0
    ? Number(calculateAt13TSLiters(totalGross, weightedTs).toFixed(2))
    : 0;

  return {
    totalGrossLiters: Number(totalGross.toFixed(2)),
    weightedLr,
    weightedFat,
    weightedSnf,
    weightedTs,
    weightedDensity,
    totalAt13tsLiters,
  };
}

/**
 * Formats a shop collection SMS notification body.
 * Summarizes shop, references, vehicle, MOT, and milk quality metrics.
 * Explicitly excludes CNIC and raw GPS coordinates for privacy.
 */
export function formatCollectionSmsMessage(params: {
  shopName: string;
  collectionNumber?: string;
  shopRmrNumber?: string | null;
  journeyNumber: string;
  vehicleNumber: string;
  motName: string;
  grossLiters: number;
  lr: number;
  fat: number;
  snf: number;
  ts: number;
  at13tsLiters: number;
  collectedAt: Date;
}): string {
  // Format PKT (UTC+5) timestamp
  const pktTimeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(params.collectedAt);

  return [
    `*Shakarganj Milk Reception Receipt*`,
    `*Shop:* ${params.shopName}`,
    `*RMR No:* ${params.shopRmrNumber || 'N/A'} | *Journey:* #${params.journeyNumber}`,
    `*Vehicle:* ${params.vehicleNumber} | *MOT:* ${params.motName}`,
    `*Gross Qty:* ${params.grossLiters.toFixed(2)} L`,
    `*LR:* ${params.lr.toFixed(1)} | *Fat:* ${params.fat.toFixed(1)}%`,
    `*SNF:* ${params.snf.toFixed(2)}% | *Total Solids:* ${params.ts.toFixed(2)}%`,
    `*@13% TS:* ${params.at13tsLiters.toFixed(2)} L`,
    `*Date/Time:* ${pktTimeStr} PKT`,
    `_Shakarganj Food Products Ltd, Field Reception_`,
  ].join('\n');
}
