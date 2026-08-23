import { z } from 'zod';
import {
  parsePositiveDecimalString,
  quantityValueSchema,
} from '@/backend/modules/dispatch/quantity/validation';

export { parsePositiveDecimalString, quantityValueSchema };

export const dispatchTestResultSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
  performanceStatus: z.enum(['PERFORMED', 'NOT_PERFORMED']).optional().default('PERFORMED'),
  notPerformedReason: z.string().nullable().optional(),
});

export const quantityUnitSchema = z.enum(['KG', 'LITER']);
export const measurementBasisSchema = z.enum(['ESTIMATED', 'MEASURED']);
export const measurementMethodSchema = z.enum(['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER']);

export const quantityMeasurementInputSchema = z.object({
  value: quantityValueSchema,
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
  method: measurementMethodSchema,
});

export const dispatchPortionSchema = z.object({
  portionNumber: z.number().int().min(1, 'Portion number must be 1 or greater'),
  quantity: quantityMeasurementInputSchema,
  dispatchTimestamp: z.string().optional(),
  results: z.array(dispatchTestResultSchema).optional().default([]),
});

export const createDispatchSchema = z
  .object({
    visitId: z.string().optional(),
    vehicleNumber: z
      .string()
      .min(1, 'Vehicle number is required')
      .max(50)
      .transform((val) => val.toUpperCase().trim()),
    operationalDate: z.string().min(1, 'Operational date is required'),
    procurementSourceId: z.string().optional(),
    zonalContractorName: z.string().optional(),
    dispatchTestingMode: z.enum(['FULL', 'PARTIAL', 'NOT_PERFORMED']).optional().default('FULL'),
    dispatchTestingReason: z.string().nullable().optional(),
    dispatchTestingRemarks: z.string().nullable().optional(),
    vehicleQuantity: quantityMeasurementInputSchema,
    portions: z.array(dispatchPortionSchema).min(1, 'At least one portion is required'),
  })
  .refine(
    (data) => {
      const numbers = data.portions.map((p) => p.portionNumber);
      return new Set(numbers).size === numbers.length;
    },
    {
      message: 'Portion numbers must be unique within one vehicle',
      path: ['portions'],
    }
  )
  .refine(
    (data) => {
      if (data.portions.length <= 1) return true;
      const p1Unit = data.portions[0].quantity.unit;
      return data.portions.every((p) => p.quantity.unit === p1Unit);
    },
    {
      message: 'All portions must share the same quantity unit (matching Portion 1)',
      path: ['portions'],
    }
  )
  .refine(
    (data) => {
      if (data.portions.length <= 1) return true;
      const p1Basis = data.portions[0].quantity.basis;
      return data.portions.every((p) => p.quantity.basis === p1Basis);
    },
    {
      message: 'All portions must share the same measurement basis (matching Portion 1)',
      path: ['portions'],
    }
  );

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;


/**
 * Scoped sessionStorage draft key for MPD Dispatch draft isolation
 */
export function getScopedDraftKey(userId?: string | null, sourceId?: string | number | null): string | null {
  if (!userId || !sourceId) return null;
  return `mpd_active_draft_visit_id:${userId}:${sourceId}`;
}

