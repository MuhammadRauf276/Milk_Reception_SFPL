import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { createCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { z } from 'zod';

const requestSchema = z.object({
  module: z.string().min(2, 'Module name is required.'),
  recordId: z.string().min(1, 'Record ID is required.'),
  sourceId: z.union([z.string(), z.number()]).optional().nullable(),
  reason: z.string().trim().min(5, 'Substantive correction reason of at least 5 characters is required.'),
  requestedChanges: z.record(z.string(), z.unknown()),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validated = requestSchema.parse(body);

    const sourceId = validated.sourceId
      ? BigInt(String(validated.sourceId))
      : user.procurement_source_id
      ? BigInt(user.procurement_source_id)
      : null;

    const request = await createCorrectionRequest({
      userId: BigInt(user.id),
      actorRole: user.role,
      module: validated.module,
      recordId: validated.recordId,
      sourceId,
      reason: validated.reason,
      requestedChanges: validated.requestedChanges,
      impact: validated.impact,
    });

    return NextResponse.json({
      success: true,
      message: 'Correction request submitted successfully. It has been routed to the Data Executive for review.',
      requestId: request.id.toString(),
      correlationId: request.correlation_id,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message || 'Validation error' }, { status: 400 });
    }
    console.error('POST /api/corrections/request error:', err);
    return NextResponse.json({ error: 'Failed to submit correction request.' }, { status: 500 });
  }
}
