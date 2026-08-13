import { z } from 'zod';

export const dispatchTestResultSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
});

export const dispatchPortionSchema = z.object({
  portionNumber: z.number().int().min(1, 'Portion number must be 1 or greater'),
  declaredQuantityKg: z.number().positive('Declared quantity must be greater than 0'),
  dispatchTimestamp: z.string().optional(),
  results: z.array(dispatchTestResultSchema).min(1, 'Dispatch lab results are required for each portion'),
});

export const createDispatchSchema = z
  .object({
    vehicleNumber: z
      .string()
      .min(1, 'Vehicle number is required')
      .max(50)
      .transform((val) => val.toUpperCase().trim()),
    operationalDate: z.string().min(1, 'Operational date is required'),
    zonalContractorName: z.string().optional(),
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
