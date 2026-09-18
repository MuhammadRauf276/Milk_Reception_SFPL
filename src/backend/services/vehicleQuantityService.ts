import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
  PLANT_CALCULATION_VERSION,
} from '../utils/milkFormulas';

export type VehicleCalculationFailureReason =
  | 'NO_ACCEPTED_PORTIONS'
  | 'MISSING_GROSS_WEIGHT'
  | 'MISSING_SECOND_WEIGHT'
  | 'INVALID_WEIGHT_ORDER'
  | 'NON_POSITIVE_NET_WEIGHT'
  | 'MISSING_PLANT_LR'
  | 'MISSING_PLANT_FAT'
  | 'AMBIGUOUS_PLANT_LR'
  | 'AMBIGUOUS_PLANT_FAT'
  | 'INVALID_PLANT_LR'
  | 'INVALID_PLANT_FAT'
  | 'SWAPPED_PLANT_LR_FAT'
  | 'INVALID_DENSITY'
  | 'INVALID_SNF'
  | 'INVALID_TS'
  | 'INVALID_FINAL_LITERS'
  | 'INVALID_AT13_TS_LITERS';

export interface VehicleCalculationPortionLabResult {
  testCode?: string | null;
  testName?: string | null;
  numericValue?: number | null;
  performanceStatus?: string | null;
}

export interface VehicleCalculationPortion {
  portionId?: string | bigint;
  portionNumber?: number;
  plantDecision?: string | null;
  plantLabResults: VehicleCalculationPortionLabResult[];
}

export interface VehicleCalculationInput {
  grossWeightKg: number;
  secondWeightKg: number;
  portions: VehicleCalculationPortion[];
}

export interface VehicleCalculationSuccessResult {
  isCalculable: true;
  acceptedPortionCount: number;
  grossWeightKg: number;
  secondWeightKg: number;
  netWeightKg: number;
  internalCalculationBasis: {
    averagePlantLr: number;
    averagePlantFat: number;
  };
  plantCompositeLR: number;
  plantCompositeFat: number;
  plantDensity: number;
  plantSNF: number;
  plantTS: number;
  vehicleDensity: number;
  vehicleSnf: number;
  vehicleTs: number;
  vehicleRatio: number;
  finalPhysicalLiters: number;
  finalAt13TSLiters: number;
  plantCalculationVersion: string;
}

export interface VehicleCalculationFailureResult {
  isCalculable: false;
  reason: VehicleCalculationFailureReason;
  message: string;
  portionId?: string | bigint;
  portionNumber?: number;
}

export type VehicleCalculationResult = VehicleCalculationSuccessResult | VehicleCalculationFailureResult;

/**
 * Checks whether a lab test represents the authoritative Plant Lactometer Reading (LR).
 * Authoritative Plant LR test code: LT-000008 ("LR at 20 Celsius").
 * LT-000027 ("Lactometer Reading") is distinct and not used as the final received quantity LR authority.
 */
export function isPlantLrTest(testCode?: string | null, _testName?: string | null): boolean {
  if (testCode) {
    const codeUpper = testCode.trim().toUpperCase();
    if (codeUpper === 'LT-000008') return true;
  }
  return false;
}

/**
 * Checks whether a lab test represents the authoritative Plant Fat Percentage (Fat %).
 * Authoritative Plant Fat test code: LT-000026 ("Fat").
 * LT-000001 / LT-000027 must NEVER be recognized as authoritative Plant Fat.
 */
export function isPlantFatTest(testCode?: string | null, _testName?: string | null): boolean {
  if (testCode) {
    const codeUpper = testCode.trim().toUpperCase();
    if (codeUpper === 'LT-000026') return true;
  }
  return false;
}

/**
 * Authoritative Server-Side Vehicle Received Milk Quantity Calculation Engine.
 *
 * Rules:
 * 1. Plant QA is portion-wise; final received milk is vehicle-wise.
 * 2. Net KG = Gross Weight KG - Second Weight KG.
 * 3. Only ACCEPTED portions participate. Rejected, HOLD, or undecided portions contribute nothing.
 * 4. Internal calculation basis uses simple arithmetic mean of genuinely PERFORMED Plant LR and Plant Fat.
 * 5. No portion-weight allocation or supplier declared quantity weighting is allowed.
 * 6. Derived fields (Density, SNF, TS, Ratio, Physical Liters, @13TS) are recalculated strictly
 *    from the average LR/Fat using canonical helpers from milkFormulas.ts.
 * 7. Pure function: performs zero database mutations, zero UI side-effects, and accepts zero fake defaults.
 */
export function calculateVehicleReceivedQuantity(input: VehicleCalculationInput): VehicleCalculationResult {
  // 1. Validate Gross Weight
  const gross = input.grossWeightKg;
  if (gross === null || gross === undefined || typeof gross !== 'number' || isNaN(gross) || !isFinite(gross) || gross <= 0) {
    return {
      isCalculable: false,
      reason: 'MISSING_GROSS_WEIGHT',
      message: 'Valid positive Gross Weight (First Weight) is required.',
    };
  }

  // 2. Validate Second Weight (Tare)
  const tare = input.secondWeightKg;
  if (tare === null || tare === undefined || typeof tare !== 'number' || isNaN(tare) || !isFinite(tare) || tare <= 0) {
    return {
      isCalculable: false,
      reason: 'MISSING_SECOND_WEIGHT',
      message: 'Valid positive Second Weight (Tare Weight) is required.',
    };
  }

  // 3. Validate Weight Order
  if (tare >= gross) {
    return {
      isCalculable: false,
      reason: 'INVALID_WEIGHT_ORDER',
      message: `Second Weight (${tare} kg) must be strictly less than Gross Weight (${gross} kg).`,
    };
  }

  // 4. Calculate Net KG
  const netWeightKg = gross - tare;
  if (netWeightKg <= 0 || isNaN(netWeightKg) || !isFinite(netWeightKg)) {
    return {
      isCalculable: false,
      reason: 'NON_POSITIVE_NET_WEIGHT',
      message: `Calculated Net Milk Weight (${netWeightKg} kg) must be strictly greater than 0 kg.`,
    };
  }

  // 5. Filter to Authoritative ACCEPTED Portions
  const rawPortions = Array.isArray(input.portions) ? input.portions : [];
  const acceptedPortions = rawPortions.filter((p) => String(p.plantDecision || '').toUpperCase() === 'ACCEPTED');

  if (acceptedPortions.length === 0) {
    return {
      isCalculable: false,
      reason: 'NO_ACCEPTED_PORTIONS',
      message: 'No QA-accepted portions exist for this vehicle.',
    };
  }

  // 6. Extract and Validate Plant LR and Plant Fat for EVERY Accepted Portion
  const validLrValues: number[] = [];
  const validFatValues: number[] = [];

  for (let i = 0; i < acceptedPortions.length; i++) {
    const portion = acceptedPortions[i];
    const pNumber = portion.portionNumber ?? i + 1;
    const pId = portion.portionId;

    const results = Array.isArray(portion.plantLabResults) ? portion.plantLabResults : [];

    // Find and Validate Unique Performed Plant LR
    const matchingLrResults = results.filter((r) => isPlantLrTest(r.testCode, r.testName));
    const performedLrResults = matchingLrResults.filter(
      (r) => String(r.performanceStatus || '').toUpperCase() === 'PERFORMED'
    );

    if (performedLrResults.length === 0) {
      return {
        isCalculable: false,
        reason: 'MISSING_PLANT_LR',
        message: `Accepted Portion #${pNumber} is missing performed Plant LR measurement.`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    if (performedLrResults.length > 1) {
      return {
        isCalculable: false,
        reason: 'AMBIGUOUS_PLANT_LR',
        message: `Accepted Portion #${pNumber} contains multiple (${performedLrResults.length}) performed Plant LR results; authoritative vehicle calculation cannot determine a unique value.`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    const uniqueLrResult = performedLrResults[0];
    const lrVal = Number(uniqueLrResult.numericValue);
    if (isNaN(lrVal) || !isFinite(lrVal) || lrVal <= 0) {
      return {
        isCalculable: false,
        reason: 'INVALID_PLANT_LR',
        message: `Accepted Portion #${pNumber} has an invalid Plant LR value (${uniqueLrResult.numericValue}).`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    // Find and Validate Unique Performed Plant Fat
    const matchingFatResults = results.filter((r) => isPlantFatTest(r.testCode, r.testName));
    const performedFatResults = matchingFatResults.filter(
      (r) => String(r.performanceStatus || '').toUpperCase() === 'PERFORMED'
    );

    if (performedFatResults.length === 0) {
      return {
        isCalculable: false,
        reason: 'MISSING_PLANT_FAT',
        message: `Accepted Portion #${pNumber} is missing performed Plant Fat % measurement.`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    if (performedFatResults.length > 1) {
      return {
        isCalculable: false,
        reason: 'AMBIGUOUS_PLANT_FAT',
        message: `Accepted Portion #${pNumber} contains multiple (${performedFatResults.length}) performed Plant Fat % results; authoritative vehicle calculation cannot determine a unique value.`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    const uniqueFatResult = performedFatResults[0];
    const fatVal = Number(uniqueFatResult.numericValue);
    if (isNaN(fatVal) || !isFinite(fatVal) || fatVal < 0) {
      return {
        isCalculable: false,
        reason: 'INVALID_PLANT_FAT',
        message: `Accepted Portion #${pNumber} has an invalid Plant Fat % value (${uniqueFatResult.numericValue}).`,
        portionId: pId,
        portionNumber: pNumber,
      };
    }

    validLrValues.push(lrVal);
    validFatValues.push(fatVal);
  }

  // 7. Calculate Simple Arithmetic Means Across Accepted Portions
  const acceptedCount = acceptedPortions.length;
  const sumLr = validLrValues.reduce((acc, val) => acc + val, 0);
  const sumFat = validFatValues.reduce((acc, val) => acc + val, 0);

  const averagePlantLr = sumLr / acceptedCount;
  const averagePlantFat = sumFat / acceptedCount;

  if (isNaN(averagePlantLr) || !isFinite(averagePlantLr) || averagePlantLr <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_PLANT_LR',
      message: `Calculated average Plant LR (${averagePlantLr}) is invalid.`,
    };
  }

  if (isNaN(averagePlantFat) || !isFinite(averagePlantFat) || averagePlantFat < 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_PLANT_FAT',
      message: `Calculated average Plant Fat % (${averagePlantFat}) is invalid.`,
    };
  }

  // Plausibility & Swap Guard: In raw milk, LR is normally >= 15 and Fat % is normally <= 15
  if (averagePlantLr <= averagePlantFat || averagePlantLr < 15 || averagePlantFat > 15 || averagePlantFat < 0.5) {
    return {
      isCalculable: false,
      reason: 'SWAPPED_PLANT_LR_FAT',
      message: `Average Plant LR (${averagePlantLr}) and Fat % (${averagePlantFat}) appear swapped or out of biological range.`,
    };
  }

  // 8. Canonical Formula Execution Chain (Full precision in double precision, no intermediate rounding)
  const vehicleDensity = calculateDensity(averagePlantLr);
  if (isNaN(vehicleDensity) || !isFinite(vehicleDensity) || vehicleDensity <= 1.0) {
    return {
      isCalculable: false,
      reason: 'INVALID_DENSITY',
      message: `Failed to calculate valid milk density from average Plant LR (${averagePlantLr}); density must be strictly greater than 1.0.`,
    };
  }

  const vehicleSnf = calculateSNF(averagePlantLr, averagePlantFat);
  if (isNaN(vehicleSnf) || !isFinite(vehicleSnf) || vehicleSnf <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_SNF',
      message: `Calculated SNF % (${vehicleSnf}) must be finite and strictly positive.`,
    };
  }

  const vehicleTs = calculateTS(averagePlantFat, vehicleSnf);
  if (isNaN(vehicleTs) || !isFinite(vehicleTs) || vehicleTs <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_TS',
      message: `Calculated TS % (${vehicleTs}) must be finite and strictly positive.`,
    };
  }

  const vehicleRatio = calculateRatio(vehicleSnf, averagePlantFat);
  const finalPhysicalLiters = calculatePhysicalLiters(netWeightKg, averagePlantLr);

  if (isNaN(finalPhysicalLiters) || !isFinite(finalPhysicalLiters) || finalPhysicalLiters <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_FINAL_LITERS',
      message: `Failed to calculate valid final physical liters for Net Weight ${netWeightKg} kg.`,
    };
  }

  const finalAt13TSLiters = calculateAt13TSLiters(finalPhysicalLiters, vehicleTs);
  if (isNaN(finalAt13TSLiters) || !isFinite(finalAt13TSLiters) || finalAt13TSLiters <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_AT13_TS_LITERS',
      message: `Failed to calculate valid final @13TS liters (${finalAt13TSLiters}) from Physical Liters ${finalPhysicalLiters} L.`,
    };
  }

  return {
    isCalculable: true,
    acceptedPortionCount: acceptedCount,
    grossWeightKg: gross,
    secondWeightKg: tare,
    netWeightKg,
    internalCalculationBasis: {
      averagePlantLr,
      averagePlantFat,
    },
    plantCompositeLR: averagePlantLr,
    plantCompositeFat: averagePlantFat,
    plantDensity: vehicleDensity,
    plantSNF: vehicleSnf,
    plantTS: vehicleTs,
    vehicleDensity,
    vehicleSnf,
    vehicleTs,
    vehicleRatio,
    finalPhysicalLiters,
    finalAt13TSLiters,
    plantCalculationVersion: PLANT_CALCULATION_VERSION,
  };
}
