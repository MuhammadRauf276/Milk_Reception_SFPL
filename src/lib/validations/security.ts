import { z } from 'zod';

export const gateEntrySchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  tokenNumber: z
    .string()
    .min(1, 'Token number is required')
    .max(30, 'Token number must be 30 characters or less')
    .transform((val) => val.toUpperCase().trim()),
  entryTimestamp: z.string().optional(),
});

export type GateEntryInput = z.infer<typeof gateEntrySchema>;
