import { z } from 'zod';

export const qaTestResultInputSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
});

export const saveQADraftSchema = z.object({
  results: z.array(qaTestResultInputSchema).min(1, 'At least one lab result entry is required'),
});

export const completeQATestSchema = z.object({
  results: z.array(qaTestResultInputSchema).default([]),
  decision: z.enum(['ACCEPTED', 'REJECTED']).optional(),
  rejectionReason: z.string().nullable().optional(),
  rejectionRemarks: z.string().nullable().optional(),
  operationalTimestamp: z.string().nullable().optional(),
});

export type SaveQADraftInput = z.infer<typeof saveQADraftSchema>;
export type CompleteQATestInput = z.infer<typeof completeQATestSchema>;
