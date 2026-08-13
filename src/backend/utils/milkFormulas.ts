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
