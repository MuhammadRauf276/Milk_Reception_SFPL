import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
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
  | 'INVALID_DENSITY'
  | 'INVALID_FINAL_LITERS';

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
  vehicleDensity: number;
  vehicleSnf: number;
  vehicleTs: number;
  vehicleRatio: number;
  finalPhysicalLiters: number;
  finalAt13TSLiters: number;
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
 */
export function isPlantLrTest(testCode?: string | null, testName?: string | null): boolean {
  if (testCode) {
    const codeUpper = testCode.trim().toUpperCase();
    if (codeUpper === 'LT-000008' || codeUpper === 'LT-000027') return true;
  }
  if (testName) {
    const nameUpper = testName.trim().toUpperCase();
    if (nameUpper.includes('LACTOMETER') || nameUpper.includes('LR')) return true;
  }
  return false;
}

/**
 * Checks whether a lab test represents the authoritative Plant Fat Percentage (Fat %).
 */
export function isPlantFatTest(testCode?: string | null, testName?: string | null): boolean {
  if (testCode) {
    const codeUpper = testCode.trim().toUpperCase();
    if (codeUpper === 'LT-000026' || codeUpper === 'LT-000001') return true;
  }
  if (testName) {
    const nameUpper = testName.trim().toUpperCase();
    if (nameUpper.includes('FAT') && !nameUpper.includes('RATIO') && !nameUpper.includes('SNF')) return true;
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

  // 8. Canonical Formula Execution Chain
  const vehicleDensity = calculateDensity(averagePlantLr);
  if (isNaN(vehicleDensity) || !isFinite(vehicleDensity) || vehicleDensity <= 0) {
    return {
      isCalculable: false,
      reason: 'INVALID_DENSITY',
      message: `Failed to calculate valid milk density from average Plant LR (${averagePlantLr}).`,
    };
  }

  const vehicleSnf = calculateSNF(averagePlantLr, averagePlantFat);
  const vehicleTs = calculateTS(averagePlantFat, vehicleSnf);
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
    vehicleDensity,
    vehicleSnf,
    vehicleTs,
    vehicleRatio,
    finalPhysicalLiters,
    finalAt13TSLiters,
  };
}
