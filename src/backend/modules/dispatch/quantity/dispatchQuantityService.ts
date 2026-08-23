import {
  DispatchQuantityPolicySnapshotDTO,
  DispatchQuantityPolicyConfig,
} from '../quantity-policy/types';
import {
  ValidatedQuantityMeasurement,
} from './types';
import {
  validateQuantityAgainstPolicy,
  QuantityMeasurementError,
} from './validation';

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

  return {
    vehicleQuantity,
    portionQuantities: validatedPortions,
    portions: validatedPortions,
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
    const unit = (p.dispatchQuantityUnit !== undefined ? p.dispatchQuantityUnit : p.dispatch_quantity_unit || '').trim().toUpperCase();

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
