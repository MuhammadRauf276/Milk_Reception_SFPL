import { z } from 'zod';

export const qaTestResultInputSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  performanceStatus: z.enum(['PERFORMED', 'NOT_PERFORMED']).default('PERFORMED'),
  notPerformedReason: z.string().nullable().optional(),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
});

export const completeQATestSchema = z.object({
  results: z.array(qaTestResultInputSchema).default([]),
  decision: z.enum(['ACCEPTED', 'REJECTED']).optional(),
  rejectionReason: z.string().nullable().optional(),
  rejectionRemarks: z.string().nullable().optional(),
  operationalTimestamp: z.string().nullable().optional(),
});

export type CompleteQATestInput = z.infer<typeof completeQATestSchema>;
