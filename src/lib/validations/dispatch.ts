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

export const dispatchPolicyTestResultSchema = z.object({
  lab_test_id: z.string().regex(/^\d{1,18}$/, 'Test ID is not valid'),
  value: z.number().finite().nullable().optional(),
  text_value: z.string().max(255).nullable().optional(),
});

export const dispatchPhotoRefSchema = z.object({
  lab_test_id: z.string().regex(/^\d{1,18}$/, 'Test ID is not valid'),
  capture_id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Photo ID is not valid'),
});

export const quantityUnitSchema = z.enum(['KG', 'LITER']);
export const measurementBasisSchema = z.enum(['ESTIMATED', 'MEASURED']);

export const quantityMeasurementInputSchema = z.object({
  value: quantityValueSchema,
  unit: quantityUnitSchema,
  basis: measurementBasisSchema,
  lr: z.number().positive().nullable().optional(),
  fat: z.number().nonnegative().nullable().optional(),
});

export const dispatchPortionSchema = z.object({
  portionNumber: z.number().int().min(1, 'Portion number must be 1 or greater'),
  quantity: quantityMeasurementInputSchema,
  dispatchTimestamp: z.string().optional(),
  results: z.array(dispatchTestResultSchema).optional().default([]),
  // Phase 4c: seal per portion (required by the route, unique within the dispatch) + policy tests and photo capture ids.
  seal_number: z.string().trim().max(50, 'Seal number is too long').nullable().optional(),
  test_results: z.array(dispatchPolicyTestResultSchema).optional(),
  photos: z.array(dispatchPhotoRefSchema).optional().default([]),
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
    // Optional since Phase 4c: totals come from the portions on the server.
    vehicleQuantity: quantityMeasurementInputSchema.optional(),
    vehicleLr: z.number().positive().nullable().optional(),
    vehicleFat: z.number().nonnegative().nullable().optional(),
    rawMilkDispatchNoteNumber: z.string().nullable().optional(),
    raw_milk_dispatch_note_number: z.string().nullable().optional(),
    portions: z.array(dispatchPortionSchema).min(1, 'At least one portion is required'),
    // Phase 4c (Stage 3): explicit test mode, Submit vs Send request, person decision, lab report photo.
    testMode: z.enum(['COMPOSITE', 'PORTION_WISE']).optional(),
    action: z.enum(['SUBMIT', 'SEND_REQUEST']).optional().default('SUBMIT'),
    personDecision: z.enum(['ACCEPT', 'REJECT']).optional().default('ACCEPT'),
    decisionRemarks: z.string().max(2000).nullable().optional(),
    labReportCaptureId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Photo ID is not valid').nullable().optional(),
  })
  .refine((data) => data.testMode !== 'COMPOSITE' || data.portions.length === 1, {
    message: 'Composite test mode requires all tests recorded under exactly one portion',
    path: ['portions'],
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

