import { z } from 'zod';

export interface LabTestResultOption {
  value: string;
  label: string;
  isPassing: boolean | null;
}

export const labTestResultOptionSchema = z.object({
  value: z.string().min(1, 'Option value cannot be empty').max(50).trim(),
  label: z.string().min(1, 'Option label cannot be empty').max(100).trim(),
  isPassing: z.boolean().nullable().optional().default(null),
});

export const resultOptionsArraySchema = z.array(labTestResultOptionSchema)
  .min(2, 'Categorical tests must define at least 2 options')
  .max(20, 'Cannot exceed 20 options')
  .refine((opts) => {
    const values = opts.map((o) => o.value.trim().toLowerCase());
    return new Set(values).size === values.length;
  }, {
    message: 'Option values must be unique (case-insensitive)',
  });

export const createLabTestSchema = z.object({
  testName: z.string().min(1, 'Test name is required').max(150, 'Test name must be 150 characters or less').trim(),
  resultType: z.enum(['NUMERIC', 'TEXT', 'QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE', 'CALCULATED'], {
    message: 'Result type must be NUMERIC, TEXT, QUALITATIVE, BOOLEAN, OK_NOT_OK, POSITIVE_NEGATIVE, or CALCULATED',
  }),
  unit: z.string().max(30).nullable().optional(),
  testScope: z.enum(['DISPATCH', 'PLANT', 'BOTH'], {
    message: 'Test scope must be DISPATCH, PLANT, or BOTH',
  }),
  isRequired: z.boolean().default(true),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0, 'Display order must be a non-negative integer').default(0),
  resultOptions: resultOptionsArraySchema.nullable().optional(),
});

export const updateLabTestSchema = z.object({
  testCode: z.string().trim().optional(),
  testName: z.string().min(1, 'Test name is required').max(150).trim().optional(),
  resultType: z.enum(['NUMERIC', 'TEXT', 'QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE', 'CALCULATED']).optional(),
  unit: z.string().max(30).nullable().optional(),
  testScope: z.enum(['DISPATCH', 'PLANT', 'BOTH']).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  resultOptions: resultOptionsArraySchema.nullable().optional(),
});

export type CreateLabTestInput = z.infer<typeof createLabTestSchema>;
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema>;

/**
 * Validates that required Plant QA categorical tests have viable passing and failing options configured.
 * A required Plant test cannot be all-neutral or without a passing option.
 */
export function validatePlantQAResultOptions(
  testScope: string,
  isRequired: boolean,
  resultType: string,
  resultOptions?: LabTestResultOption[] | null
): { isValid: boolean; error?: string } {
  const isPlant = testScope === 'PLANT' || testScope === 'BOTH';
  const isCategorical = ['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(resultType);

  if (isPlant && isRequired && isCategorical && Array.isArray(resultOptions) && resultOptions.length > 0) {
    const hasPassing = resultOptions.some((o) => o.isPassing === true);
    if (!hasPassing) {
      return {
        isValid: false,
        error: 'Required Plant QA tests must have at least one passing option configured.',
      };
    }
    const hasFailing = resultOptions.some((o) => o.isPassing === false);
    if (!hasFailing) {
      return {
        isValid: false,
        error: 'Required Plant QA tests must have at least one failing option configured.',
      };
    }
  }

  return { isValid: true };
}

