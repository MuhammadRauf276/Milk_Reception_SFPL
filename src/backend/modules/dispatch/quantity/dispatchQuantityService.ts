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
