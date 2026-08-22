import { z } from 'zod';
import {
  QuantityUnit,
  MeasurementBasis,
  MeasurementMethod,
  ValidatedQuantityMeasurement,
} from './types';
import {
  AllowedMeasurementConfig,
  isCombinationAllowed,
} from '../quantity-policy/types';
import {
  quantityUnitSchema,
  measurementBasisSchema,
  measurementMethodSchema,
} from '../quantity-policy/validation';

export class QuantityMeasurementError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'QuantityMeasurementError';
    this.code = code;
  }
}

const positiveDecimalRegex = /^(0*[1-9]\d*(\.\d+)?|0+\.\d*[1-9]\d*)$/;

export function parsePositiveDecimalString(val: unknown, fieldName = 'Quantity'): string {
  if (val === null || val === undefined || val === '') {
    throw new QuantityMeasurementError(`${fieldName} value is required.`, 'QUANTITY_VALUE_REQUIRED');
  }

  const strVal = String(val).trim();
  if (!positiveDecimalRegex.test(strVal)) {
    throw new QuantityMeasurementError(
      `${fieldName} must be a valid positive number greater than 0. Received: "${strVal}"`,
      'QUANTITY_VALUE_INVALID'
    );
  }

  const numVal = Number(strVal);
  if (isNaN(numVal) || !isFinite(numVal) || numVal <= 0) {
    throw new QuantityMeasurementError(
      `${fieldName} must be greater than 0.`,
      'QUANTITY_VALUE_INVALID'
    );
  }

  return strVal;
}

export const quantityMeasurementSchema = z.object({
  value: z.union([z.string(), z.number()]),
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
  method: measurementMethodSchema,
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
    method: parsed.data.method as MeasurementMethod,
  };

  const allowedList = Array.isArray(allowedMeasurementsOrRules)
    ? allowedMeasurementsOrRules
    : (allowedMeasurementsOrRules as any)?.allowedMeasurements || [];

  const allowed = isCombinationAllowed(allowedList, combination);
  if (!allowed) {
    throw new QuantityMeasurementError(
      `${contextPrefix} quantity combination (${combination.unit}, ${combination.basis}, ${combination.method}) is not allowed by the frozen policy snapshot.`,
      'QUANTITY_COMBINATION_NOT_ALLOWED'
    );
  }

  return {
    value: normalizedValue,
    unit: combination.unit,
    basis: combination.basis,
    method: combination.method,
  };
}

