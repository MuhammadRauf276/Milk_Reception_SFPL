import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';

const correctDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT'] as const),
  reason: z.string().trim().min(3, 'A substantive managerial reason of at least 3 characters is required.'),
  idempotency_key: z.string().trim().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  const authUser = await getCurrentUser(req);
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

  const allowedRoles = ['QA_MANAGER'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Manager role is strictly required for managerial exception decisions.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  try {
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);
    const userIdBigInt = dbUser.id;

    const body = await req.json();
    const validated = correctDecisionSchema.parse(body);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Row lock on vehicle_visit
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: { gate_log: true },
      });

      if (!visit) {
        throw new Error('Vehicle visit not found.');
      }

      const portion = await tx.visitPortion.findFirst({
        where: { id: portionId, visit_id: visitId },
      });

      if (!portion) {
        throw new Error('Portion not found for this vehicle visit.');
      }

      // Check Physical-State Guard: Exit timestamp blocks fabrication of physical admission
      if (visit.gate_log?.exit_timestamp) {
        // Exited -> audit-only review without fabrication (no fake gross, unloading, receipt, silo stock, or error)
        if (portion.manager_review_status === 'REVIEWED_EXITED') {
          return {
            idempotent: true,
            reviewOnly: true,
            portion,
            newVisitStatus: visit.current_status,
          };
        }

        const updatedPortion = await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            manager_review_status: 'REVIEWED_EXITED',
            manager_reviewed_by_user_id: userIdBigInt,
            manager_reviewed_at: now,
            manager_review_reason: validated.reason,
            manager_requested_decision: validated.decision,
          },
        });

        await tx.auditLog.create({
          data: {
            table_name: 'visit_portion',
            record_id: portionId,
            action: 'PLANT_QA_MANAGER_REVIEW_AFTER_EXIT',
            old_values: {
              effective_decision: portion.plant_decision,
              original_decision: portion.original_plant_decision || portion.plant_decision,
              exception_classification: portion.corrected_plant_decision,
              manager_review_status: portion.manager_review_status,
              current_status: portion.current_status,
              system_quality_outcome: portion.system_quality_outcome,
              physical_exit_state: 'EXITED',
              exit_timestamp: visit.gate_log.exit_timestamp.toISOString(),
            },
            new_values: {
              visit_id: String(visitId),
              portion_number: portion.portion_number,
              decision: validated.decision,
              effective_decision: portion.plant_decision,
              exception_classification: portion.corrected_plant_decision,
              manager_review_status: 'REVIEWED_EXITED',
              reason: validated.reason,
              review_only: true,
              physical_exit_state: 'EXITED',
              exit_timestamp: visit.gate_log.exit_timestamp.toISOString(),
              new_visit_status: visit.current_status,
              ...(validated.idempotency_key ? { idempotency_key: validated.idempotency_key } : {}),
            },
            user_id: userIdBigInt,
          },
        });

        return {
          idempotent: false,
          reviewOnly: true,
          portion: updatedPortion,
          newVisitStatus: visit.current_status,
        };
      }

      // On-site:
      // Fail closed if approving exception while rule configuration is broken or missing
      if (validated.decision === 'APPROVE') {
        if (portion.system_quality_outcome === 'RULE_CONFIGURATION_ERROR') {
          throw new Error('CONFIG_ERROR:Cannot approve exception: Laboratory rule configuration error exists. This must be corrected by QA Head.');
        }
        if (portion.system_quality_outcome === 'NO_ACTIVE_RULE') {
          throw new Error('NO_ACTIVE_RULE:Cannot approve exception: Missing required laboratory release rule. This must be corrected by QA Head.');
        }
      }

      // Check idempotency with idempotency_key
      if (validated.idempotency_key) {
        const priorAudit = await tx.auditLog.findFirst({
          where: {
            table_name: 'visit_portion',
            record_id: portionId,
            action: { in: ['PLANT_QA_MANAGER_EXCEPTION_APPROVED', 'PLANT_QA_MANAGER_EXCEPTION_REJECTED'] },
          },
          orderBy: { id: 'desc' },
        });

        if (priorAudit && (priorAudit.new_values as any)?.idempotency_key === validated.idempotency_key) {
          const priorDecision = (priorAudit.new_values as any)?.decision;
          const priorReason = (priorAudit.new_values as any)?.reason;
          if (priorDecision !== validated.decision || priorReason !== validated.reason) {
            throw new Error('IDEMPOTENCY_CONFLICT:Conflict: Idempotency key reused with different decision or reason.');
          }
          return {
            idempotent: true,
            reviewOnly: false,
            portion,
            newVisitStatus: visit.current_status,
          };
        }
      }

      // Check if already reviewed with expectedStatus
      const expectedStatus = validated.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (portion.manager_review_status === expectedStatus) {
        if (portion.manager_review_reason && portion.manager_review_reason !== validated.reason) {
          throw new Error('IDEMPOTENCY_CONFLICT:Conflict: Manager decision was already recorded with a different reason.');
        }
        return {
          idempotent: true,
          reviewOnly: false,
          portion,
          newVisitStatus: visit.current_status,
        };
      }

      // Allow review if PENDING, or if originally REJECTED/HOLD
      const allowablePriorDecisions = ['PENDING', 'REJECTED', 'HOLD'];
      if (
        portion.manager_review_status !== 'PENDING' &&
        !allowablePriorDecisions.includes(portion.plant_decision || '')
      ) {
        throw new Error(
          `Portion is not eligible for QA Manager review (current status: ${portion.plant_decision}, review status: ${portion.manager_review_status}).`
        );
      }

      let newPlantDecision: string;
      let newCorrectedPlantDecision: string;
      let newManagerReviewStatus: string;
      let auditAction: string;

      if (validated.decision === 'APPROVE') {
        newPlantDecision = 'ACCEPTED';
        newCorrectedPlantDecision = 'ACCEPTED_EXCEPTION';
        newManagerReviewStatus = 'APPROVED';
        auditAction = 'PLANT_QA_MANAGER_EXCEPTION_APPROVED';
      } else {
        newPlantDecision = 'REJECTED';
        newCorrectedPlantDecision = 'REJECTED';
        newManagerReviewStatus = 'REJECTED';
        auditAction = 'PLANT_QA_MANAGER_EXCEPTION_REJECTED';
      }

      // First decision on escalated OUT_OF_SPEC is the FIRST FINAL HUMAN DECISION, not a post-final correction.
      const isFirstDecision = portion.manager_review_status === 'PENDING' || portion.plant_decision === 'PENDING';
      const originalPlantDecision = portion.original_plant_decision ?? (isFirstDecision ? null : portion.plant_decision);

      const updatedPortion = await tx.visitPortion.update({
        where: { id: portionId },
        data: {
          plant_decision: newPlantDecision,
          current_status: newPlantDecision,
          original_plant_decision: originalPlantDecision,
          corrected_plant_decision: newCorrectedPlantDecision,
          plant_correction_reason: isFirstDecision ? null : validated.reason,
          plant_corrected_by: isFirstDecision ? null : userIdBigInt,
          plant_corrected_at: isFirstDecision ? null : now,
          manager_review_status: newManagerReviewStatus,
          manager_reviewed_by_user_id: userIdBigInt,
          manager_reviewed_at: now,
          manager_review_reason: validated.reason,
          plant_rejection_reason: validated.decision === 'REJECT' ? validated.reason : portion.plant_rejection_reason,
          plant_decided_by: userIdBigInt,
          plant_decided_at: now,
        },
      });

      // Recalculate visit workflow status
      const allPortions = await tx.visitPortion.findMany({
        where: { visit_id: visitId },
      });

      const decisions = allPortions.map((p) => p.plant_decision);
      const hasUnresolved = decisions.some(
        (d) => !d || d === 'PENDING' || d === 'HOLD' || d === 'UNDER_TEST'
      );
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');

      let newVisitStatus = 'PLANT_QA';
      if (hasUnresolved) {
        newVisitStatus = 'PLANT_QA';
      } else if (allRejected) {
        newVisitStatus = 'READY_FOR_GATE_EXIT';
      } else if (hasAccepted) {
        newVisitStatus = 'READY_FOR_GROSS';
      }

      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: newVisitStatus },
      });

      // Complete QA testing session if leaving PLANT_QA
      const activeSession = await tx.qATestingSession.findUnique({
        where: { visit_id: visitId },
      });

      if (activeSession) {
        await tx.qATestingSessionEvent.create({
          data: {
            session_id: activeSession.id,
            event_type: validated.decision === 'APPROVE' ? 'PORTION_ACCEPTED' : 'PORTION_REJECTED',
            timestamp: now,
            user_id: userIdBigInt,
            note: `QA Manager decided ${validated.decision} for Portion #${portion.portion_number}. Reason: ${validated.reason}`,
          },
        });

        if (newVisitStatus !== 'PLANT_QA' && activeSession.status === 'IN_PROGRESS') {
          await tx.qATestingSession.update({
            where: { id: activeSession.id },
            data: {
              status: 'COMPLETED',
              completed_by: userIdBigInt,
              completed_at: now,
            },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: activeSession.id,
              event_type: 'COMPLETE',
              timestamp: now,
              user_id: userIdBigInt,
              note: `QA session completed following manager review. Final visit status: ${newVisitStatus}`,
            },
          });
        }
      }

      // Record AuditLog
      await tx.auditLog.create({
        data: {
          table_name: 'visit_portion',
          record_id: portionId,
          action: auditAction,
          old_values: {
            effective_decision: portion.plant_decision,
            original_decision: portion.original_plant_decision || portion.plant_decision,
            exception_classification: portion.corrected_plant_decision,
            manager_review_status: portion.manager_review_status,
            current_status: portion.current_status,
            system_quality_outcome: portion.system_quality_outcome,
            physical_exit_state: 'ON_SITE',
            exit_timestamp: null,
          },
          new_values: {
            visit_id: String(visitId),
            portion_number: portion.portion_number,
            decision: validated.decision,
            effective_decision: newPlantDecision,
            exception_classification: newCorrectedPlantDecision,
            manager_review_status: newManagerReviewStatus,
            reason: validated.reason,
            review_only: false,
            physical_exit_state: 'ON_SITE',
            exit_timestamp: null,
            system_quality_outcome: portion.system_quality_outcome,
            new_visit_status: newVisitStatus,
            ...(validated.idempotency_key ? { idempotency_key: validated.idempotency_key } : {}),
          },
          user_id: userIdBigInt,
        },
      });

      return {
        idempotent: false,
        portion: updatedPortion,
        newVisitStatus,
      };
    });

    return NextResponse.json({
      success: true,
      message: result.reviewOnly
        ? `QA Manager review recorded (vehicle already exited; review-only).`
        : `QA Manager decision recorded successfully: ${validated.decision}.`,
      portionId: portionIdStr,
      decision: validated.decision,
      reviewOnly: !!result.reviewOnly,
      newVisitStatus: result.newVisitStatus,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (error.message?.startsWith('IDEMPOTENCY_CONFLICT:')) {
      return NextResponse.json({ error: error.message.replace('IDEMPOTENCY_CONFLICT:', '') }, { status: 409 });
    }
    if (error.message?.startsWith('CONFIG_ERROR:') || error.message?.startsWith('NO_ACTIVE_RULE:')) {
      return NextResponse.json({ error: error.message.split(':')[1] }, { status: 422 });
    }
    const statusCode = error.message?.includes('VEHICLE_ALREADY_EXITED_REVIEW_ONLY') ? 409 : 400;
    return NextResponse.json({ error: error.message || 'Failed to process QA Manager decision' }, { status: statusCode });
  }
}
