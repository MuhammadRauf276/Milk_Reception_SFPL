import { z } from 'zod';
import {
  QuantityUnit,
  MeasurementBasis,
  ValidatedQuantityMeasurement,
} from './types';
import {
  AllowedMeasurementConfig,
  isCombinationAllowed,
} from '../quantity-policy/types';
import {
  quantityUnitSchema,
  measurementBasisSchema,
} from '../quantity-policy/validation';

export class QuantityMeasurementError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'QuantityMeasurementError';
    this.code = code;
  }
}

const DECIMAL_10_2_REGEX = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;

export function parsePositiveDecimalString(val: unknown, fieldName = 'Quantity'): string {
  if (val === null || val === undefined || val === '') {
    throw new QuantityMeasurementError(`${fieldName} value is required.`, 'QUANTITY_VALUE_REQUIRED');
  }

  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val <= 0) {
      throw new QuantityMeasurementError(
        `${fieldName} must be a valid positive number between 0.01 and 99,999,999.99. Received: "${val}"`,
        'QUANTITY_VALUE_INVALID'
      );
    }
  }

  const strVal = String(val).trim();
  if (!DECIMAL_10_2_REGEX.test(strVal)) {
    throw new QuantityMeasurementError(
      `${fieldName} must be a valid positive number between 0.01 and 99,999,999.99 with at most 2 decimal places. Received: "${strVal}"`,
      'QUANTITY_VALUE_INVALID'
    );
  }

  const numVal = Number(strVal);
  if (isNaN(numVal) || !isFinite(numVal) || numVal < 0.01 || numVal > 99999999.99) {
    throw new QuantityMeasurementError(
      `${fieldName} must be between 0.01 and 99,999,999.99. Received: "${strVal}"`,
      'QUANTITY_VALUE_INVALID'
    );
  }

  return strVal;
}

export const quantityValueSchema = z.union([z.string(), z.number()]).refine(
  (val) => {
    try {
      parsePositiveDecimalString(val);
      return true;
    } catch {
      return false;
    }
  },
  {
    message: 'Quantity must be a positive number between 0.01 and 99,999,999.99 with at most 2 decimal places',
  }
);

export const quantityMeasurementSchema = z.object({
  value: quantityValueSchema,
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
});

export function validateQuantityAgainstPolicy(
  rawMeasurement: unknown,
  allowedMeasurementsOrRules: AllowedMeasurementConfig[] | { allowedMeasurements?: AllowedMeasurementConfig[] },
  context: 'Vehicle' | 'Portion' | string,
  portionNumber?: number
): ValidatedQuantityMeasurement {
  const contextPrefix = portionNumber !== undefined ? `Portion ${portionNumber}` : context;

  if (!rawMeasurement || typeof rawMeasurement !== 'object') {
    throw new QuantityMeasurementError(
      `${contextPrefix} quantity measurement is required.`,
      portionNumber !== undefined ? 'MISSING_PORTION_QUANTITY' : 'MISSING_VEHICLE_QUANTITY'
    );
  }

  const parsed = quantityMeasurementSchema.safeParse(rawMeasurement);
  if (!parsed.success) {
    throw new QuantityMeasurementError(
      `${contextPrefix} quantity contains invalid fields: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      'QUANTITY_MEASUREMENT_INVALID'
    );
  }

  const normalizedValue = parsePositiveDecimalString(parsed.data.value, `${contextPrefix} quantity`);

  const combination = {
    unit: parsed.data.unit as QuantityUnit,
    basis: parsed.data.basis as MeasurementBasis,
  };

  const allowedList = Array.isArray(allowedMeasurementsOrRules)
    ? allowedMeasurementsOrRules
    : (allowedMeasurementsOrRules as any)?.allowedMeasurements || [];

  const allowed = isCombinationAllowed(allowedList, combination);
  if (!allowed) {
    throw new QuantityMeasurementError(
      `${contextPrefix} quantity combination (${combination.unit}, ${combination.basis}) is not allowed by the frozen policy snapshot.`,
      'QUANTITY_COMBINATION_NOT_ALLOWED'
    );
  }

  return {
    value: normalizedValue,
    unit: combination.unit,
    basis: combination.basis,
  };
}

