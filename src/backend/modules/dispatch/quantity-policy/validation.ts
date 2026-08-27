import { z } from 'zod';
import {
  DispatchQuantityPolicyConfig,
  isCombinationAllowed,
} from './types';

export const quantityUnitSchema = z.enum(['KG', 'LITER']);
export const measurementBasisSchema = z.enum(['ESTIMATED', 'MEASURED']);

export const measurementCombinationSchema = z.object({
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
});

export const allowedMeasurementSchema = z.object({
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
});

export const vehicleQuantityRuleSchema = z.object({
  allowedMeasurements: z.array(allowedMeasurementSchema).min(1, 'At least one allowed measurement combination must be configured.'),
  default: measurementCombinationSchema,
}).superRefine((data, ctx) => {
  if (!isCombinationAllowed(data.allowedMeasurements, data.default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default vehicle measurement (${data.default.unit}, ${data.default.basis}) is not in allowed combinations.`,
      path: ['default'],
    });
  }
});

export const portionQuantityRuleSchema = z.object({
  allowedMeasurements: z.array(allowedMeasurementSchema).min(1, 'At least one allowed measurement combination must be configured.'),
  default: measurementCombinationSchema,
}).superRefine((data, ctx) => {
  if (!isCombinationAllowed(data.allowedMeasurements, data.default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default portion measurement (${data.default.unit}, ${data.default.basis}) is not in allowed combinations.`,
      path: ['default'],
    });
  }
});

export const dispatchQuantityPolicySchema = z.object({
  version: z.number().int().min(1, 'Policy version must be a positive integer.'),
  vehicleRules: vehicleQuantityRuleSchema,
  portionRules: portionQuantityRuleSchema,
  allowSameUnitPortionPrefill: z.boolean(),
});

export function validateQuantityPolicy(policy: unknown): DispatchQuantityPolicyConfig {
  return dispatchQuantityPolicySchema.parse(policy);
}

