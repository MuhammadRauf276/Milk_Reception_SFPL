import { z } from 'zod';

export const dispatchTestResultSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
  performanceStatus: z.enum(['PERFORMED', 'NOT_PERFORMED']).optional().default('PERFORMED'),
  notPerformedReason: z.string().nullable().optional(),
});

export const dispatchPortionSchema = z.object({
  portionNumber: z.number().int().min(1, 'Portion number must be 1 or greater'),
  declaredQuantityKg: z.number().positive('Enter a quantity greater than 0.'),
  declaredQuantityUnit: z.enum(['KG', 'LITER']).optional().default('KG'),
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
  );

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

/**
 * Scoped sessionStorage draft key for MPD Dispatch draft isolation
 */
export function getScopedDraftKey(userId?: string | null, sourceId?: string | number | null): string | null {
  if (!userId || !sourceId) return null;
  return `mpd_active_draft_visit_id:${userId}:${sourceId}`;
}

