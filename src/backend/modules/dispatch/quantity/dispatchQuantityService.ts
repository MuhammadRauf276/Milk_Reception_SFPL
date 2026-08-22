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

/**
 * Formats quantity display safely. If quantity is missing or null, returns em-dash (—).
 */
export function formatQuantityDisplay(
  value: string | number | null | undefined,
  unit?: string | null
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const num = Number(value);
  if (isNaN(num)) {
    return String(value);
  }
  const formattedNum = num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return unit ? `${formattedNum} ${unit}` : formattedNum;
}
