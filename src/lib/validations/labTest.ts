import { z } from 'zod';

export const createLabTestSchema = z.object({
  testName: z.string().min(1, 'Test name is required').max(150, 'Test name must be 150 characters or less').trim(),
  resultType: z.enum(['NUMERIC', 'TEXT', 'QUALITATIVE', 'BOOLEAN'], {
    message: 'Result type must be NUMERIC, TEXT, QUALITATIVE, or BOOLEAN',
  }),
  unit: z.string().max(30).nullable().optional(),
  testScope: z.enum(['DISPATCH', 'PLANT', 'BOTH'], {
    message: 'Test scope must be DISPATCH, PLANT, or BOTH',
  }),
  isRequired: z.boolean().default(true),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0, 'Display order must be a non-negative integer').default(0),
});

export const updateLabTestSchema = z.object({
  testCode: z.string().trim().optional(),
  testName: z.string().min(1, 'Test name is required').max(150).trim().optional(),
  resultType: z.enum(['NUMERIC', 'TEXT', 'QUALITATIVE', 'BOOLEAN']).optional(),
  unit: z.string().max(30).nullable().optional(),
  testScope: z.enum(['DISPATCH', 'PLANT', 'BOTH']).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export type CreateLabTestInput = z.infer<typeof createLabTestSchema>;
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema>;
