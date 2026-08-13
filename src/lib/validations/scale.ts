import { z } from 'zod';

export const grossWeightSchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  ticketNumber: z
    .string()
    .min(1, 'Ticket number is required')
    .max(50, 'Ticket number must be 50 characters or less')
    .transform((val) => val.toUpperCase().trim()),
  grossWeightKg: z.number().positive('Gross weight must be greater than zero'),
});

export type GrossWeightInput = z.infer<typeof grossWeightSchema>;
