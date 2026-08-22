import { z } from 'zod';
import { DispatchQuantityPolicyConfig, QuantityUnit, MeasurementBasis, MeasurementMethod } from './types';

export const quantityUnitSchema = z.enum(['KG', 'LITER']);
export const measurementBasisSchema = z.enum(['ESTIMATED', 'MEASURED']);
export const measurementMethodSchema = z.enum(['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER']);

export const vehicleQuantityRuleSchema = z.object({
  allowedUnits: z.array(quantityUnitSchema).min(1, 'At least one allowed unit must be configured.'),
  allowedBases: z.array(measurementBasisSchema).min(1, 'At least one allowed basis must be configured.'),
  allowedMethods: z.array(measurementMethodSchema).min(1, 'At least one allowed method must be configured.'),
  defaultUnit: quantityUnitSchema,
  defaultBasis: measurementBasisSchema,
  defaultMethod: measurementMethodSchema,
}).superRefine((data, ctx) => {
  if (!data.allowedUnits.includes(data.defaultUnit)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default vehicle unit "${data.defaultUnit}" must be one of allowedUnits [${data.allowedUnits.join(', ')}].`,
      path: ['defaultUnit'],
    });
  }
  if (!data.allowedBases.includes(data.defaultBasis)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default vehicle basis "${data.defaultBasis}" must be one of allowedBases [${data.allowedBases.join(', ')}].`,
      path: ['defaultBasis'],
    });
  }
  if (!data.allowedMethods.includes(data.defaultMethod)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default vehicle method "${data.defaultMethod}" must be one of allowedMethods [${data.allowedMethods.join(', ')}].`,
      path: ['defaultMethod'],
    });
  }
});

export const portionQuantityRuleSchema = z.object({
  allowedUnits: z.array(quantityUnitSchema).min(1, 'At least one allowed unit must be configured.'),
  allowedBases: z.array(measurementBasisSchema).min(1, 'At least one allowed basis must be configured.'),
  allowedMethods: z.array(measurementMethodSchema).min(1, 'At least one allowed method must be configured.'),
  defaultUnit: quantityUnitSchema,
  defaultBasis: measurementBasisSchema,
  defaultMethod: measurementMethodSchema,
}).superRefine((data, ctx) => {
  if (!data.allowedUnits.includes(data.defaultUnit)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default portion unit "${data.defaultUnit}" must be one of allowedUnits [${data.allowedUnits.join(', ')}].`,
      path: ['defaultUnit'],
    });
  }
  if (!data.allowedBases.includes(data.defaultBasis)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default portion basis "${data.defaultBasis}" must be one of allowedBases [${data.allowedBases.join(', ')}].`,
      path: ['defaultBasis'],
    });
  }
  if (!data.allowedMethods.includes(data.defaultMethod)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Default portion method "${data.defaultMethod}" must be one of allowedMethods [${data.allowedMethods.join(', ')}].`,
      path: ['defaultMethod'],
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

