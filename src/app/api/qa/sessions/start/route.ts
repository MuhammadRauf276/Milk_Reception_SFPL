import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

const startSessionSchema = z.object({
  visitId: z.string().min(1, 'Visit ID is required'),
  operationalTimestamp: z.string().optional(),
});

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
    const validated = startSessionSchema.parse(body);
    const visitId = BigInt(validated.visitId);
    const userIdBigInt = dbUser.id;
    const now = new Date();
    const targetOpTs = validated.operationalTimestamp ? new Date(validated.operationalTimestamp) : now;

    const result = await prisma.$transaction(async (tx) => {
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          gate_log: true,
          qa_session: {
            include: { starter: true },
          },
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      // Validate exact chronology against DB predecessor gate entry_timestamp
      const predTs = visit.gate_log?.entry_timestamp ? new Date(visit.gate_log.entry_timestamp) : null;
      const chronoVal = validateOperationalTimestamp(targetOpTs.toISOString(), predTs, 'QA Start', 'Gate Entry');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // Check if session already exists
      if (visit.qa_session) {
        const existingSession = visit.qa_session;
        if (existingSession.started_by !== userIdBigInt) {
          const starterName = existingSession.starter.full_name || existingSession.starter.username;
          throw new Error(`Vehicle is currently in testing by Chemist ${starterName}. Competing claims are blocked.`);
        }

        // If current chemist already owns it, return session
        return { session: existingSession, isNew: false };
      }

      // Create new QA Testing Session
      const session = await tx.qATestingSession.create({
        data: {
          visit_id: visitId,
          started_by: userIdBigInt,
          started_at: targetOpTs,
          status: 'IN_PROGRESS',
        },
      });

      // Create START Event
      await tx.qATestingSessionEvent.create({
        data: {
          session_id: session.id,
          event_type: 'START',
          timestamp: targetOpTs,
          user_id: userIdBigInt,
          note: `QA Testing session started by ${dbUser.full_name || dbUser.username}`,
        },
      });

      // Update VehicleVisit current status to PLANT_QA
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'PLANT_QA' },
      });

      return { session, isNew: true };
    });

    return NextResponse.json({
      success: true,
      sessionId: result.session.id.toString(),
      startedAt: result.session.started_at.toISOString(),
      message: `QA testing session started for Visit #${validated.visitId}`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to start QA session' }, { status: 400 });
  }
}
