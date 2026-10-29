import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { parseStrictDateOnly } from '@/lib/datetime-utils';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import { getErrorMessage } from '@/lib/errors';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: authUser.username }, { username: authUser.id }],
      is_active: true,
    },
  });

  if (!dbUser || !canActAs(dbUser.role, 'QA_LAB_ATTENDANT')) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Laboratory role required.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;

  try {
    const visitId = BigInt(visitIdStr);
    const body = await req.json().catch(() => ({}));
    const requestedAction: 'GATE_EXIT' | 'WEIGHBRIDGE' | 'ESCALATE_AVP_QA' | 'AUTO' =
      body.action || 'AUTO';
    const opTimestamp = body.operationalTimestamp ? new Date(body.operationalTimestamp) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          portions: true,
          qa_session: true,
        },
      });

      if (!visit) {
        return { error: 'Vehicle visit not found', status: 404 };
      }

      const portions = visit.portions;
      const decisions = portions.map((p) => p.plant_decision);
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');
      const hasPending = decisions.some(
        (d) => !d || d === 'PENDING' || d === 'HOLD' || d === 'UNDER_TEST'
      );
      const hasException = portions.some(
        (p) =>
          p.manager_review_status === 'PENDING' ||
          (p.exception_reasons && Array.isArray(p.exception_reasons) && p.exception_reasons.length > 0)
      );

      let targetAction = requestedAction;
      if (targetAction === 'AUTO') {
        if (hasException && hasPending) {
          targetAction = 'ESCALATE_AVP_QA';
        } else if (allRejected || (visit.test_mode === 'COMPOSITE' && decisions[0] === 'REJECTED')) {
          targetAction = 'GATE_EXIT';
        } else if (hasAccepted) {
          targetAction = 'WEIGHBRIDGE';
        } else {
          return {
            error: 'Cannot finalize visit. Portions have not all been tested and decided.',
            status: 400,
          };
        }
      }

      if (targetAction === 'GATE_EXIT') {
        const rejectDateStr = getOperationalBusinessDate(opTimestamp);
        const rejectDate = parseStrictDateOnly(rejectDateStr);

        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: {
            current_status: 'READY_FOR_GATE_EXIT',
            operational_date: rejectDate,
            business_date_source: 'LAST_QA_REJECTION',
            business_date_set_at: opTimestamp,
          },
        });

        if (visit.qa_session) {
          await tx.qATestingSession.update({
            where: { id: visit.qa_session.id },
            data: {
              status: 'COMPLETED',
              completed_by: dbUser.id,
              completed_at: opTimestamp,
            },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: visit.qa_session.id,
              event_type: 'COMPLETE',
              timestamp: opTimestamp,
              user_id: dbUser.id,
              note: 'QA testing completed. All portions rejected. Vehicle routed to Gate Exit.',
            },
          });
        }

        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: visitId,
          action: 'PLANT_QA_ROUTED_TO_GATE_EXIT',
          oldValues: { status: visit.current_status },
          newValues: { status: 'READY_FOR_GATE_EXIT' },
          actor: auditActorFromUser(dbUser),
        });

        return {
          success: true,
          action: 'GATE_EXIT',
          newStatus: 'READY_FOR_GATE_EXIT',
          message: `Vehicle ${visit.vehicle_number} rejected and routed to Gate Exit.`,
        };
      }

      if (targetAction === 'WEIGHBRIDGE') {
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: { current_status: 'READY_FOR_GROSS' },
        });

        if (visit.qa_session) {
          await tx.qATestingSession.update({
            where: { id: visit.qa_session.id },
            data: {
              status: 'COMPLETED',
              completed_by: dbUser.id,
              completed_at: opTimestamp,
            },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: visit.qa_session.id,
              event_type: 'COMPLETE',
              timestamp: opTimestamp,
              user_id: dbUser.id,
              note: 'QA testing completed. Quality accepted. Vehicle routed to Gross Weighbridge.',
            },
          });
        }

        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: visitId,
          action: 'PLANT_QA_ROUTED_TO_WEIGHBRIDGE',
          oldValues: { status: visit.current_status },
          newValues: { status: 'READY_FOR_GROSS' },
          actor: auditActorFromUser(dbUser),
        });

        return {
          success: true,
          action: 'WEIGHBRIDGE',
          newStatus: 'READY_FOR_GROSS',
          message: `Vehicle ${visit.vehicle_number} accepted and routed to Weighbridge.`,
        };
      }

      if (targetAction === 'ESCALATE_AVP_QA') {
        await tx.visitPortion.updateMany({
          where: { visit_id: visitId, plant_decision: 'PENDING' },
          data: {
            manager_review_status: 'PENDING',
            manager_review_requested_by_user_id: dbUser.id,
            manager_review_requested_at: opTimestamp,
          },
        });

        if (visit.qa_session) {
          await tx.qATestingSession.update({
            where: { id: visit.qa_session.id },
            data: { status: 'ON_HOLD' },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: visit.qa_session.id,
              event_type: 'HOLD',
              timestamp: opTimestamp,
              user_id: dbUser.id,
              note: 'QA testing session escalated to AVP QA for quality exception review.',
            },
          });
        }

        await createNotificationsForEvent(tx, {
          eventKey: 'PLANT_QA_EXCEPTION_PENDING',
          sourceId: visitId.toString(),
          title: 'Plant QA exception needs review',
          body: `Vehicle ${visit.vehicle_number} requires AVP-QA quality exception review.`,
          deepLink: '/department/qa-head',
          dedupeSuffix: `qa-escalate:${visitId}:${Date.now()}`,
        });

        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: visitId,
          action: 'PLANT_QA_ESCALATED_TO_AVP_QA',
          oldValues: { status: visit.current_status },
          newValues: { status: 'PLANT_QA', sessionStatus: 'ON_HOLD' },
          actor: auditActorFromUser(dbUser),
        });

        return {
          success: true,
          action: 'ESCALATE_AVP_QA',
          newStatus: 'PLANT_QA',
          message: `Vehicle ${visit.vehicle_number} escalated to AVP QA.`,
        };
      }

      return { error: 'Invalid routing action', status: 400 };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to complete QA session' },
      { status: 500 }
    );
  }
}
