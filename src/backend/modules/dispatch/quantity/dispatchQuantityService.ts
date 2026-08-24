import {
  DispatchQuantityPolicySnapshotDTO,
  DispatchQuantityPolicyConfig,
  QuantityUnit,
  MeasurementBasis,
  MeasurementMethod,
  AllowedMeasurementConfig,
  getAllowedBases,
  getAllowedMethods,
} from '../quantity-policy/types';
import {
  ValidatedQuantityMeasurement,
} from './types';
import {
  validateQuantityAgainstPolicy,
  QuantityMeasurementError,
} from './validation';
import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateAt13TSLiters,
  calculateGrossLiters,
} from '@/backend/utils/milkFormulas';

export { QuantityMeasurementError };

export interface DispatchQuantitiesValidationResult {
  vehicleQuantity: ValidatedQuantityMeasurement;
  portionQuantities: Array<ValidatedQuantityMeasurement & { portionNumber: number }>;
  portions?: Array<ValidatedQuantityMeasurement & { portionNumber: number }>;
}

export interface ValidateDispatchQuantitiesInput {
  vehicleQuantity: unknown;
  portions: Array<{ portionNumber: number; quantity: unknown }>;
  policy?: DispatchQuantityPolicySnapshotDTO | DispatchQuantityPolicyConfig | null;
  frozenPolicy?: DispatchQuantityPolicySnapshotDTO | DispatchQuantityPolicyConfig | null;
}

/**
 * Authoritatively validates submitted Vehicle and Portion quantity facts against the visit's
 * FROZEN policy snapshot.
 */
export function validateDispatchQuantities(
  frozenPolicyOrArgs: DispatchQuantityPolicySnapshotDTO | DispatchQuantityPolicyConfig | ValidateDispatchQuantitiesInput,
  vehicleQuantityInput?: unknown,
  portionsInput?: Array<{ portionNumber: number; quantity: unknown }>
): DispatchQuantitiesValidationResult {
  let policy: DispatchQuantityPolicyConfig;
  let vehicleQtyRaw: unknown;
  let portionsRaw: Array<{ portionNumber: number; quantity: unknown }> | undefined;

  if (
    frozenPolicyOrArgs &&
    typeof frozenPolicyOrArgs === 'object' &&
    'vehicleQuantity' in frozenPolicyOrArgs &&
    'portions' in frozenPolicyOrArgs
  ) {
    const args = frozenPolicyOrArgs as ValidateDispatchQuantitiesInput;
    const policyInput = args.policy || args.frozenPolicy;
    if (!policyInput) {
      throw new QuantityMeasurementError('Frozen quantity policy is required for validation.', 'POLICY_REQUIRED');
    }
    policy = 'policy' in policyInput ? (policyInput as DispatchQuantityPolicySnapshotDTO).policy : (policyInput as DispatchQuantityPolicyConfig);
    vehicleQtyRaw = args.vehicleQuantity;
    portionsRaw = args.portions;
  } else {
    const rawPolicy = frozenPolicyOrArgs as (DispatchQuantityPolicySnapshotDTO | DispatchQuantityPolicyConfig);
    if (!rawPolicy) {
      throw new QuantityMeasurementError('Frozen quantity policy is required for validation.', 'POLICY_REQUIRED');
    }
    policy = 'policy' in rawPolicy ? (rawPolicy as DispatchQuantityPolicySnapshotDTO).policy : (rawPolicy as DispatchQuantityPolicyConfig);
    vehicleQtyRaw = vehicleQuantityInput;
    portionsRaw = portionsInput;
  }

  if (!portionsRaw || portionsRaw.length === 0) {
    throw new QuantityMeasurementError(
      'At least one active portion is required for dispatch creation.',
      'ZERO_PORTIONS_PROHIBITED'
    );
  }

  // 1. Validate Vehicle Dispatch Quantity against frozen policy
  const vehicleQuantity = validateQuantityAgainstPolicy(
    vehicleQtyRaw,
    policy.vehicleRules.allowedMeasurements,
    'Vehicle'
  );

  // 2. Validate Each Portion Dispatch Quantity independently against frozen policy
  const validatedPortions = portionsRaw.map((portion) => {
    const validatedPortionQty = validateQuantityAgainstPolicy(
      portion.quantity,
      policy.portionRules.allowedMeasurements,
      'Portion',
      portion.portionNumber
    );

    return {
      ...validatedPortionQty,
      portionNumber: portion.portionNumber,
    };
  });

  // 3. Enforce shared portion Unit and Basis across all portions (matching Portion 1)
  if (validatedPortions.length > 1) {
    const p1 = validatedPortions[0];
    for (let i = 1; i < validatedPortions.length; i++) {
      const p = validatedPortions[i];
      if (p.unit !== p1.unit) {
        throw new QuantityMeasurementError(
          `Portion ${p.portionNumber} quantity unit (${p.unit}) must match Portion 1 unit (${p1.unit}).`,
          'PORTION_UNIT_MISMATCH'
        );
      }
      if (p.basis !== p1.basis) {
        throw new QuantityMeasurementError(
          `Portion ${p.portionNumber} measurement basis (${p.basis}) must match Portion 1 basis (${p1.basis}).`,
          'PORTION_BASIS_MISMATCH'
        );
      }
    }
  }

  return {
    vehicleQuantity,
    portionQuantities: validatedPortions,
    portions: validatedPortions,
  };
}

/**
 * Pure helper: Applies a new shared Unit to all portions.
 * Requirement: Changing shared Unit must clear existing numeric values across all portions
 * to prevent silent numeric reinterpretation (e.g. 9,800 LITER becoming 9,800 KG).
 */
export function applySharedPortionUnit<
  T extends {
    quantity: {
      value: string | number | null | undefined;
      unit: QuantityUnit;
      basis: MeasurementBasis;
      method: MeasurementMethod;
    };
  }
>(
  portions: T[],
  newUnit: QuantityUnit,
  allowedMeasurements?: AllowedMeasurementConfig[]
): T[] {
  const bases: MeasurementBasis[] = allowedMeasurements ? getAllowedBases(allowedMeasurements, newUnit) : ['ESTIMATED', 'MEASURED'];
  const p1CurrentBasis = portions[0]?.quantity.basis;
  const newBasis = bases.includes(p1CurrentBasis) ? p1CurrentBasis : (bases[0] || 'ESTIMATED');
  const methods: MeasurementMethod[] = allowedMeasurements ? getAllowedMethods(allowedMeasurements, newUnit, newBasis) : ['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER'];

  return portions.map((portion) => {
    const newMethod = methods.includes(portion.quantity.method) ? portion.quantity.method : (methods[0] || 'MANUAL_ESTIMATE');
    return {
      ...portion,
      quantity: {
        ...portion.quantity,
        value: '', // Strictly clear entered quantity value on Unit change
        unit: newUnit,
        basis: newBasis,
        method: newMethod,
      },
    };
  });
}

/**
 * Pure helper: Propagates a new shared Basis to all portions.
 * Requirement: Changing Basis preserves existing numeric quantity values.
 */
export function applySharedPortionBasis<
  T extends {
    quantity: {
      value: string | number | null | undefined;
      unit: QuantityUnit;
      basis: MeasurementBasis;
      method: MeasurementMethod;
    };
  }
>(
  portions: T[],
  newBasis: MeasurementBasis,
  allowedMeasurements?: AllowedMeasurementConfig[]
): T[] {
  const sharedUnit = portions[0]?.quantity.unit || 'LITER';
  const methods: MeasurementMethod[] = allowedMeasurements ? getAllowedMethods(allowedMeasurements, sharedUnit, newBasis) : ['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER'];

  return portions.map((portion) => {
    const newMethod = methods.includes(portion.quantity.method) ? portion.quantity.method : (methods[0] || 'MANUAL_ESTIMATE');
    return {
      ...portion,
      quantity: {
        ...portion.quantity,
        basis: newBasis,
        method: newMethod,
      },
    };
  });
}

/**
 * Pure helper: Creates the initial quantity configuration for a newly added portion,
 * inheriting the shared Unit and Basis from Portion 1 (if Portion 1 exists),
 * while keeping Measurement Method independent (using defaultRules.method if compatible with inherited Unit/Basis,
 * otherwise falling back to the first compatible method from allowed measurements).
 */
export function createPortionQuantityFromSharedProfile(
  p1Quantity: { unit: QuantityUnit; basis: MeasurementBasis; method?: MeasurementMethod } | undefined | null,
  defaultRules: { unit: QuantityUnit; basis: MeasurementBasis; method: MeasurementMethod },
  allowedMeasurements?: AllowedMeasurementConfig[]
): { value: string; unit: QuantityUnit; basis: MeasurementBasis; method: MeasurementMethod } {
  const unit = p1Quantity ? p1Quantity.unit : defaultRules.unit;
  const basis = p1Quantity ? p1Quantity.basis : defaultRules.basis;
  const methods: MeasurementMethod[] = allowedMeasurements ? getAllowedMethods(allowedMeasurements, unit, basis) : ['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER'];
  const method = methods.includes(defaultRules.method)
    ? defaultRules.method
    : (methods[0] || defaultRules.method);

  return {
    value: '',
    unit,
    basis,
    method,
  };
}

export interface DispatchPortionCalculatedValues {
  declaredVal: number | null;
  unit: string | null;
  density: number | null;
  grossLiters: number | null;
  physicalLiters: number | null;
  snf: number | null;
  ts: number | null;
  totalSolids: number | null;
  ratio: number | null;
  at13TsLiters: number | null;
  litersAt13TS: number | null;
}

/**
 * Pure production helper: Orchestrates live calculated milk metrics for a single Dispatch portion.
 * Operates strictly on declared quantity, unit, and authoritative/performed LR and Fat values.
 * Uses canonical milk formulas; never fabricates fake quality metrics when inputs are missing.
 */
export function computeDispatchPortionCalculatedValues(
  quantity: number | string | null | undefined,
  unit: QuantityUnit | string | null | undefined,
  lr?: number | string | null | undefined,
  fat?: number | string | null | undefined
): DispatchPortionCalculatedValues {
  const qtyNum =
    quantity !== null && quantity !== undefined && quantity !== '' && !isNaN(Number(quantity)) && Number(quantity) > 0
      ? Number(quantity)
      : null;
  const normalizedUnit = (unit || '').trim().toUpperCase();
  const lrNum =
    lr !== null && lr !== undefined && lr !== '' && !isNaN(Number(lr)) && Number(lr) > 0
      ? Number(lr)
      : null;
  const fatNum =
    fat !== null && fat !== undefined && fat !== '' && !isNaN(Number(fat)) && Number(fat) >= 0
      ? Number(fat)
      : null;

  let densityVal: number | null = null;
  let snfVal: number | null = null;
  let tsVal: number | null = null;
  let ratioVal: number | null = null;
  let grossLitersVal: number | null = null;
  let at13TsLitersVal: number | null = null;

  if (lrNum !== null) {
    densityVal = calculateDensity(lrNum);
  }

  if (lrNum !== null && fatNum !== null) {
    snfVal = calculateSNF(lrNum, fatNum);
    tsVal = calculateTS(fatNum, snfVal);
    ratioVal = calculateRatio(snfVal, fatNum);
  }

  if (qtyNum !== null && (normalizedUnit === 'KG' || normalizedUnit === 'LITER')) {
    grossLitersVal = calculateGrossLiters(qtyNum, normalizedUnit, lrNum);

    if (grossLitersVal !== null && tsVal !== null) {
      at13TsLitersVal = calculateAt13TSLiters(grossLitersVal, tsVal);
    }
  }

  return {
    declaredVal: qtyNum,
    unit: normalizedUnit || null,
    density: densityVal,
    grossLiters: grossLitersVal,
    physicalLiters: grossLitersVal,
    snf: snfVal,
    ts: tsVal,
    totalSolids: tsVal,
    ratio: ratioVal,
    at13TsLiters: at13TsLitersVal,
    litersAt13TS: at13TsLitersVal,
  };
}

export interface PortionQuantitySummary {
  complete: boolean;
  totalValue: number | null;
  formattedTotal: string | null;
  unit: QuantityUnit | null;
  basis: MeasurementBasis | null;
  totalKind: 'MEASURED' | 'ESTIMATED' | null;
  label: string | null;
  isAboveLimit: boolean;
}

export interface VehiclePortionComparison {
  eligibleForDifference: boolean;
  difference: number | null;
  formattedDifference: string | null;
  isDifferentUnits: boolean;
  message: string | null;
}

/**
 * Parses exact numeric string or number to integer hundredths (cents).
 * Accepts up to 2 decimal places. Returns null if invalid, empty, NaN, or non-positive.
 */
function parseExactHundredths(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val).trim();
  if (!str) return null;
  // Strict decimal(10, 2) check: digits with optional up to 2 decimals
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return null;
  }
  const num = Number(str);
  if (isNaN(num) || !isFinite(num) || num <= 0) return null;

  const parts = str.split('.');
  const whole = parseInt(parts[0], 10);
  const frac = parts[1] ? parseInt(parts[1].padEnd(2, '0'), 10) : 0;
  return whole * 100 + frac;
}

export function formatDecimalQuantity(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Pure production helper: Computes the exact Portion Quantity Total across all portions.
 * - All portions share Unit and Basis (established by Portion 1).
 * - Complete ONLY when every portion has a valid, non-empty, positive numeric value.
 * - Uses exact integer hundredths arithmetic to prevent binary floating-point artifacts.
 */
export function computePortionQuantitySummary(
  portions: Array<{
    quantity?: {
      value?: string | number | null;
      unit?: QuantityUnit | string | null;
      basis?: MeasurementBasis | string | null;
    } | null;
  }> | undefined | null
): PortionQuantitySummary {
  const portionList = portions || [];
  if (portionList.length === 0) {
    return {
      complete: false,
      totalValue: null,
      formattedTotal: null,
      unit: null,
      basis: null,
      totalKind: null,
      label: null,
      isAboveLimit: false,
    };
  }

  const p1 = portionList[0]?.quantity;
  const rawUnit = p1?.unit ? String(p1.unit).trim().toUpperCase() : null;
  const unit: QuantityUnit | null = rawUnit === 'KG' || rawUnit === 'LITER' ? (rawUnit as QuantityUnit) : null;
  const rawBasis = p1?.basis ? String(p1.basis).trim().toUpperCase() : null;
  const basis: MeasurementBasis | null =
    rawBasis === 'MEASURED' || rawBasis === 'ESTIMATED' ? (rawBasis as MeasurementBasis) : null;

  const totalKind: 'MEASURED' | 'ESTIMATED' | null =
    basis === 'MEASURED' ? 'MEASURED' : basis === 'ESTIMATED' ? 'ESTIMATED' : null;
  const label =
    totalKind === 'MEASURED'
      ? 'Measured Portion Total'
      : totalKind === 'ESTIMATED'
      ? 'Estimated Portion Total'
      : 'Portion Quantity Total';

  let allComplete = true;
  let totalHundredths = 0;

  for (const p of portionList) {
    const val = p?.quantity?.value;
    const hundredths = parseExactHundredths(val);
    if (hundredths === null) {
      allComplete = false;
      break;
    }
    totalHundredths += hundredths;
  }

  if (!allComplete) {
    return {
      complete: false,
      totalValue: null,
      formattedTotal: null,
      unit,
      basis,
      totalKind,
      label,
      isAboveLimit: false,
    };
  }

  const totalValue = totalHundredths / 100;
  const isAboveLimit = totalHundredths > 9999999999; // 99,999,999.99
  const formattedTotal = unit ? `${formatDecimalQuantity(totalValue)} ${unit}` : `${formatDecimalQuantity(totalValue)}`;

  return {
    complete: true,
    totalValue,
    formattedTotal,
    unit,
    basis,
    totalKind,
    label,
    isAboveLimit,
  };
}

/**
 * Pure production helper: Determines if the user can use the Measured Portion Total to prefill an empty Vehicle Quantity.
 * Requires:
 * 1. Portion Total is complete
 * 2. Portion Basis is MEASURED
 * 3. Vehicle Quantity Value is empty/blank
 * 4. Vehicle Unit == Portion Unit
 * 5. Vehicle Basis == MEASURED
 * 6. Portion Total is within allowable positive decimal range (<= 99,999,999.99)
 */
export function canUseMeasuredPortionTotalForVehicle(
  vehicleQuantity: {
    value?: string | number | null;
    unit?: QuantityUnit | string | null;
    basis?: MeasurementBasis | string | null;
  } | undefined | null,
  portionSummary: PortionQuantitySummary
): boolean {
  if (!portionSummary.complete || portionSummary.totalValue === null || portionSummary.isAboveLimit) {
    return false;
  }
  if (portionSummary.basis !== 'MEASURED' || portionSummary.totalKind !== 'MEASURED') {
    return false;
  }
  if (portionSummary.totalValue <= 0 || portionSummary.totalValue > 99999999.99) {
    return false;
  }

  if (!vehicleQuantity) return false;
  const vehVal = vehicleQuantity.value !== undefined && vehicleQuantity.value !== null ? String(vehicleQuantity.value).trim() : '';
  if (vehVal !== '') {
    return false;
  }

  const vehUnit = (vehicleQuantity.unit || '').trim().toUpperCase();
  const portionUnit = (portionSummary.unit || '').trim().toUpperCase();
  if (!vehUnit || !portionUnit || vehUnit !== portionUnit) {
    return false;
  }

  const vehBasis = (vehicleQuantity.basis || '').trim().toUpperCase();
  if (vehBasis !== 'MEASURED') {
    return false;
  }

  return true;
}

/**
 * Pure production helper: Computes the same-unit Difference between Vehicle Dispatch Quantity and Portion Quantity Total.
 * - If units differ, returns comparison message "Different units — no direct comparison" and null difference.
 * - If units match and both vehicle & portion total are valid, returns exact arithmetic difference (Vehicle - Portions).
 */
export function computeVehiclePortionDifference(
  vehicleQuantity: {
    value?: string | number | null;
    unit?: QuantityUnit | string | null;
    basis?: MeasurementBasis | string | null;
  } | undefined | null,
  portionSummary: PortionQuantitySummary
): VehiclePortionComparison {
  if (!portionSummary.complete || portionSummary.totalValue === null) {
    return {
      eligibleForDifference: false,
      difference: null,
      formattedDifference: null,
      isDifferentUnits: false,
      message: null,
    };
  }

  if (!vehicleQuantity) {
    return {
      eligibleForDifference: false,
      difference: null,
      formattedDifference: null,
      isDifferentUnits: false,
      message: null,
    };
  }

  const vehHundredths = parseExactHundredths(vehicleQuantity.value);
  if (vehHundredths === null) {
    return {
      eligibleForDifference: false,
      difference: null,
      formattedDifference: null,
      isDifferentUnits: false,
      message: null,
    };
  }

  const vehUnit = (vehicleQuantity.unit || '').trim().toUpperCase();
  const portionUnit = (portionSummary.unit || '').trim().toUpperCase();

  if (vehUnit !== portionUnit) {
    return {
      eligibleForDifference: false,
      difference: null,
      formattedDifference: null,
      isDifferentUnits: true,
      message: 'Different units — no direct comparison',
    };
  }

  const portionHundredths = Math.round(portionSummary.totalValue * 100);
  const diffHundredths = vehHundredths - portionHundredths;
  const difference = diffHundredths / 100;

  let formattedDifference: string;
  if (diffHundredths > 0) {
    formattedDifference = `+${formatDecimalQuantity(difference)} ${vehUnit}`;
  } else if (diffHundredths < 0) {
    formattedDifference = `-${formatDecimalQuantity(Math.abs(difference))} ${vehUnit}`;
  } else {
    formattedDifference = `0 ${vehUnit}`;
  }

  return {
    eligibleForDifference: true,
    difference,
    formattedDifference,
    isDifferentUnits: false,
    message: null,
  };
}

export interface DispatchSafeSummaryTotals {
  hasPortions: boolean;
  totalGrossLiters: number | null;
  formattedTotalGrossLiters: string | null;
  totalLitersAt13TS: number | null;
  formattedTotalLitersAt13TS: string | null;
}

/**
 * Pure production helper: Computes safe aggregate totals across all portions.
 * - Total Gross Liters: Sum of portion gross liters ONLY when every portion has a valid numeric Gross Liters.
 * - Total Liters @ 13% TS: Sum of portion liters @ 13% TS ONLY when every portion has a valid numeric Liters @ 13% TS.
 * - If any portion is unavailable, the respective total is strictly unavailable (null).
 * - Never computes averages (no average LR, Fat, Density, SNF, TS, Ratio).
 */
export function computeDispatchSafeSummaryTotals(
  portionCalculatedValues: Array<{
    grossLiters?: number | null;
    litersAt13TS?: number | null;
    at13TsLiters?: number | null;
  }> | undefined | null
): DispatchSafeSummaryTotals {
  const list = portionCalculatedValues || [];
  if (list.length === 0) {
    return {
      hasPortions: false,
      totalGrossLiters: null,
      formattedTotalGrossLiters: null,
      totalLitersAt13TS: null,
      formattedTotalLitersAt13TS: null,
    };
  }

  let allGrossLitersAvailable = true;
  let totalGrossLiters = 0;

  let allAt13Available = true;
  let totalAt13 = 0;

  for (const p of list) {
    const gl = p?.grossLiters;
    if (gl === null || gl === undefined || isNaN(gl) || gl <= 0) {
      allGrossLitersAvailable = false;
    } else {
      totalGrossLiters += gl;
    }

    const at13 = p?.litersAt13TS !== undefined ? p.litersAt13TS : p?.at13TsLiters;
    if (at13 === null || at13 === undefined || isNaN(at13) || at13 <= 0) {
      allAt13Available = false;
    } else {
      totalAt13 += at13;
    }
  }

  const finalGrossLiters = allGrossLitersAvailable ? totalGrossLiters : null;
  const finalAt13 = allAt13Available ? totalAt13 : null;

  return {
    hasPortions: true,
    totalGrossLiters: finalGrossLiters,
    formattedTotalGrossLiters:
      finalGrossLiters !== null ? `${Math.round(finalGrossLiters).toLocaleString()} L` : null,
    totalLitersAt13TS: finalAt13,
    formattedTotalLitersAt13TS: finalAt13 !== null ? `${Math.round(finalAt13).toLocaleString()} L` : null,
  };
}

export interface PortionQuantityFact {
  portionNumber?: number;
  dispatchQuantityValue?: number | string | null;
  dispatchQuantityUnit?: string | null;
  dispatch_quantity_value?: number | string | null;
  dispatch_quantity_unit?: string | null;
  plantDecision?: string | null;
  plant_decision?: string | null;
}

/**
 * Formats a single dispatch quantity fact.
 * Returns formatted string WITH unit (e.g. "19,500 KG" or "10,000 LITER")
 * ONLY when BOTH value is a finite valid number and unit is a valid 'KG' or 'LITER'.
 * Otherwise returns "—" (em-dash).
 */
export function formatDispatchQuantity(
  value: number | string | null | undefined,
  unit: string | null | undefined
): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num) || !isFinite(num)) return '—';

  const normalizedUnit = (unit || '').trim().toUpperCase();
  if (normalizedUnit !== 'KG' && normalizedUnit !== 'LITER') {
    return '—';
  }

  return `${num.toLocaleString('en-US')} ${normalizedUnit}`;
}

/**
 * Formats quantity display safely using canonical rules.
 */
export function formatQuantityDisplay(
  value: string | number | null | undefined,
  unit?: string | null
): string {
  return formatDispatchQuantity(value, unit);
}

/**
 * Formats accepted portions total or breakdown safely:
 * - A single summed total is produced ONLY when every accepted portion has a valid finite numeric value
 *   and every accepted portion has the SAME valid unit ('KG' or 'LITER').
 * - If units are mixed, missing, or any quantity is missing, produces a per-portion breakdown without fabricating a total.
 */
export function formatAcceptedQuantitySummary(
  portions: PortionQuantityFact[] | undefined | null,
  fallbackVehicleValue?: number | string | null,
  fallbackVehicleUnit?: string | null
): string {
  const portionList = portions || [];
  const accepted = portionList.filter((p) => {
    const dec = (p.plantDecision || p.plant_decision || '').toUpperCase();
    return dec === 'ACCEPTED';
  });

  if (accepted.length === 0) {
    if (fallbackVehicleValue !== null && fallbackVehicleValue !== undefined) {
      return formatDispatchQuantity(fallbackVehicleValue, fallbackVehicleUnit);
    }
    return '—';
  }

  // Check every accepted portion
  let allHaveValidQuantity = true;
  let allUnitsIdentical = true;
  let firstUnit: string | null = null;
  let runningSum = 0;

  for (const p of accepted) {
    const val = p.dispatchQuantityValue !== undefined ? p.dispatchQuantityValue : p.dispatch_quantity_value;
    const rawUnit = p.dispatchQuantityUnit !== undefined ? p.dispatchQuantityUnit : p.dispatch_quantity_unit;
    const unit = typeof rawUnit === 'string' ? rawUnit.trim().toUpperCase() : '';

    if (val === null || val === undefined || val === '') {
      allHaveValidQuantity = false;
      break;
    }
    const num = typeof val === 'number' ? val : Number(val);
    if (isNaN(num) || !isFinite(num)) {
      allHaveValidQuantity = false;
      break;
    }

    if (unit !== 'KG' && unit !== 'LITER') {
      allHaveValidQuantity = false;
      break;
    }

    if (firstUnit === null) {
      firstUnit = unit;
    } else if (firstUnit !== unit) {
      allUnitsIdentical = false;
    }

    runningSum += num;
  }

  if (allHaveValidQuantity && allUnitsIdentical && firstUnit !== null) {
    return `${runningSum.toLocaleString('en-US')} ${firstUnit}`;
  }

  // If not summable, return per-portion breakdown
  return accepted
    .map((p, idx) => {
      const pNum = p.portionNumber ?? (idx + 1);
      const val = p.dispatchQuantityValue !== undefined ? p.dispatchQuantityValue : p.dispatch_quantity_value;
      const unit = p.dispatchQuantityUnit !== undefined ? p.dispatchQuantityUnit : p.dispatch_quantity_unit;
      const formatted = formatDispatchQuantity(val, unit);
      return `P${pNum}: ${formatted}`;
    })
    .join(', ');
}
