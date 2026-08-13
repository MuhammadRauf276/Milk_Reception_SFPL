import { z } from 'zod';

export const startUnloadingSchema = z.object({
  siloNumber: z
    .string()
    .min(1, 'Silo number / storage tank ID is required')
    .max(255, 'Silo number cannot exceed 255 characters')
    .transform((val) => val.trim()),
});

export const completeUnloadingSchema = z.object({
  notes: z.string().optional(),
});

export type StartUnloadingInput = z.infer<typeof startUnloadingSchema>;
export type CompleteUnloadingInput = z.infer<typeof completeUnloadingSchema>;
