import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

const resumeSessionSchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  operationalTimestamp: z.string().optional(),
});

class RouteError extends Error {
  statusCode: number;
  constructor(message?: string, statusCode: number = 400) {
    super(message || 'Operation failed');
    this.statusCode = statusCode;
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  const allowedRoles = ['QA_Operator', 'QA', 'QA_Manager', 'Admin', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. QA Chemist role required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = resumeSessionSchema.parse(body);
    const visitId = BigInt(validated.visitId);
    const userIdBigInt = dbUser.id;
    const now = new Date();
    const targetOpTs = validated.operationalTimestamp ? new Date(validated.operationalTimestamp) : now;

    const result = await prisma.$transaction(async (tx) => {
      // 0. Acquire PostgreSQL Row-Level Lock (FOR UPDATE) for the exact VehicleVisit to serialize QA mutations
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      const session = await tx.qATestingSession.findUnique({
        where: { visit_id: visitId },
      });

      if (!session) {
        throw new RouteError('QA testing session not found.', 404);
      }

      // Never resume a COMPLETED session
      if (session.status === 'COMPLETED') {
        throw new RouteError('Cannot resume QA testing session: Session is already COMPLETED.', 409);
      }

      // If the session is already IN_PROGRESS, check if the immediately preceding event was a RESUME
      if (session.status === 'IN_PROGRESS') {
        const latestEvent = await tx.qATestingSessionEvent.findFirst({
          where: { session_id: session.id },
          orderBy: { timestamp: 'desc' },
        });

        if (latestEvent && latestEvent.event_type === 'RESUME') {
          // Idempotent replay of same resume operation without appending duplicate event
          return session;
        }

        throw new RouteError('QA testing session is already IN_PROGRESS.', 409);
      }

      // Require ON_HOLD before performing a new RESUME
      if (session.status !== 'ON_HOLD') {
        throw new RouteError(`Cannot resume QA testing session in status "${session.status}". Session must be ON_HOLD.`, 409);
      }

      // Fetch latest HOLD event for predecessor chronology validation
      const latestHoldEvent = await tx.qATestingSessionEvent.findFirst({
        where: { session_id: session.id, event_type: 'HOLD' },
        orderBy: { timestamp: 'desc' },
      });

      const predTs = latestHoldEvent?.timestamp ? new Date(latestHoldEvent.timestamp) : (session.started_at ? new Date(session.started_at) : null);
      const predLabel = latestHoldEvent ? 'QA Hold' : 'QA Start';

      const chronoVal = validateOperationalTimestamp(targetOpTs.toISOString(), predTs, 'QA Resume', predLabel);
      if (!chronoVal.isValid) {
        throw new RouteError(chronoVal.error, 400);
      }

      // Update session status back to IN_PROGRESS
      const updatedSession = await tx.qATestingSession.update({
        where: { id: session.id },
        data: { status: 'IN_PROGRESS' },
      });

      // Record RESUME event with validated operational timestamp
      await tx.qATestingSessionEvent.create({
        data: {
          session_id: session.id,
          event_type: 'RESUME',
          timestamp: targetOpTs,
          user_id: userIdBigInt,
          note: `QA session resumed by ${dbUser.full_name || dbUser.username}`,
        },
      });

      return updatedSession;
    });

    return NextResponse.json({
      success: true,
      sessionId: result.id.toString(),
      message: 'QA testing session resumed successfully.',
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Unexpected error in QA resume route:', error);
    return NextResponse.json({ error: 'Failed to resume QA session' }, { status: 500 });
  }
}
