import { z } from 'zod';

export const qaTestResultInputSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  performanceStatus: z.enum(['PERFORMED', 'NOT_PERFORMED']).default('PERFORMED'),
  notPerformedReason: z.string().nullable().optional(),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
});

export const completeQATestSchema = z.object({
  results: z.array(qaTestResultInputSchema).default([]),
  decision: z.enum(['ACCEPTED', 'REJECTED']).optional(),
  action: z.string().nullable().optional(),
  decisionReason: z.string().nullable().optional(),
  sealNumber: z.string().nullable().optional(),
  seal_number: z.string().nullable().optional(),
  plantSealNumberEntered: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  rejectionRemarks: z.string().nullable().optional(),
  exceptionReason: z.string().nullable().optional(),
  exception_reason: z.string().nullable().optional(),
  completionClientEventId: z.string().trim().min(1).max(255).optional(),
  operationalTimestamp: z.string().nullable().optional(),
});

export type CompleteQATestInput = z.infer<typeof completeQATestSchema>;
