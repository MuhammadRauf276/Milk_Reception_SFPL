import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

class RouteError extends Error {
  statusCode: number;
  constructor(message?: string, statusCode: number = 400) {
    super(message || 'Operation failed');
    this.statusCode = statusCode;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
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
    return NextResponse.json({ error: 'Unauthorized. QA Chemist or QA Manager role required.' }, { status: 403 });
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  try {
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);
    const userIdBigInt = dbUser.id;

    const body = await req.json().catch(() => ({}));
    const rawReason = body.reason || body.holdReason;
    const holdReason = rawReason ? String(rawReason).trim() : 'Placed on QA Hold for review/retest';
    const now = new Date();
    const targetOpTs = body.operationalTimestamp ? new Date(body.operationalTimestamp) : (body.opTimestamp ? new Date(body.opTimestamp) : now);

    const portion = await prisma.visitPortion.findFirst({
      where: { id: portionId, visit_id: visitId },
    });

    if (!portion) {
      return NextResponse.json({ error: 'Portion record not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // 0. Acquire PostgreSQL Row-Level Lock (FOR UPDATE) for the exact VehicleVisit to serialize QA mutations
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      // 1. Re-read the VisitPortion within the locked transaction client
      const lockedPortion = await tx.visitPortion.findFirst({
        where: { id: portionId, visit_id: visitId },
      });

      if (!lockedPortion) {
        throw new RouteError('Portion record not found for this vehicle visit', 404);
      }

      // 2. Re-read the QATestingSession within the locked transaction client
      const session = await tx.qATestingSession.findUnique({
        where: { visit_id: visitId },
      });

      if (!session) {
        throw new RouteError('QA testing session not found.', 404);
      }

      // A. Finalized portion: plant_decision = ACCEPTED or REJECTED
      if (lockedPortion.plant_decision === 'ACCEPTED' || lockedPortion.plant_decision === 'REJECTED') {
        throw new RouteError(`Cannot place portion on HOLD: Portion is already finalized as ${lockedPortion.plant_decision}.`, 409);
      }

      // B. Exact idempotent HOLD replay: portion is HOLD and session is ON_HOLD
      if (lockedPortion.plant_decision === 'HOLD' && session.status === 'ON_HOLD') {
        return;
      }

      // C. New HOLD transition: portion is not finalized, not already HOLD, and session is IN_PROGRESS
      if (lockedPortion.plant_decision !== 'HOLD' && session.status === 'IN_PROGRESS') {
        // permitted new HOLD transition - proceed below
      } else {
        // D. Any other combination (e.g. session ON_HOLD but portion not HOLD, session COMPLETED, etc.)
        throw new RouteError(`Cannot place portion on HOLD: Invalid state transition (portion decision: ${lockedPortion.plant_decision}, session status: ${session.status}).`, 409);
      }

      // Validate chronology against session start or latest RESUME event
      const latestResumeEvent = await tx.qATestingSessionEvent.findFirst({
        where: { session_id: session.id, event_type: 'RESUME' },
        orderBy: { timestamp: 'desc' },
      });

      const predTs = latestResumeEvent?.timestamp ? new Date(latestResumeEvent.timestamp) : (session.started_at ? new Date(session.started_at) : null);
      const predLabel = latestResumeEvent ? 'QA Resume' : 'QA Start';

      const chronoVal = validateOperationalTimestamp(targetOpTs.toISOString(), predTs, 'QA Hold', predLabel);
      if (!chronoVal.isValid) {
        throw new RouteError(chronoVal.error, 400);
      }

      await tx.visitPortion.update({
        where: { id: portionId },
        data: {
          plant_decision: 'HOLD',
          current_status: 'HOLD',
          plant_rejection_reason: `HOLD: ${holdReason}`,
          plant_decided_by: userIdBigInt,
          plant_decided_at: targetOpTs,
        },
      });

      await tx.qATestingSession.update({
        where: { id: session.id },
        data: { status: 'ON_HOLD' },
      });

      await tx.qATestingSessionEvent.create({
        data: {
          session_id: session.id,
          event_type: 'HOLD',
          timestamp: targetOpTs,
          user_id: userIdBigInt,
          note: holdReason,
        },
      });

      // Keep vehicle visit status at PLANT_QA
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'PLANT_QA' },
      });
    });

    return NextResponse.json({
      success: true,
      portionId: portionIdStr,
      plantDecision: 'HOLD',
      message: `Portion #${portion.portion_number} placed on HOLD.`,
    });
  } catch (error: any) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Unexpected error in QA hold route:', error);
    return NextResponse.json({ error: 'Failed to place portion on hold' }, { status: 500 });
  }
}
