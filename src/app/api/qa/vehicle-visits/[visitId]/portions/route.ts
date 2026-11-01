import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import {
  findOperationRecord,
  recordOperation,
  checkOperationReplay,
  handleConcurrentReplayOrConflict,
} from '@/backend/services/operationIdempotencyService';
import { Prisma } from '@prisma/client';

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
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  if (!dbUser || !canActAs(dbUser.role, 'QA_LAB_ATTENDANT')) {
    return NextResponse.json(
      { error: 'Unauthorized. QA role required for adding test portions.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }

  const clientOperationId = (
    req.headers.get('idempotency-key') ||
    req.headers.get('x-client-operation-id') ||
    (typeof body.clientOperationId === 'string' ? body.clientOperationId : '')
  ).trim();

  try {
    const visitId = BigInt(visitIdStr);

    const canonicalPayload = {
      visitId: visitIdStr,
    };

    // 1. Check idempotency store first
    if (clientOperationId) {
      const replayResponse = await checkOperationReplay(clientOperationId, {
        operationType: 'QA_ADD_PORTION',
        entityType: 'vehicle_visit',
        entityId: visitId,
        incomingPayload: canonicalPayload,
      });
      if (replayResponse) return replayResponse;

      // Check visit_portion unique constraint directly
      const existingPortion = await prisma.visitPortion.findUnique({
        where: { creation_client_event_id: clientOperationId },
      });
      if (existingPortion) {
        if (existingPortion.visit_id.toString() !== visitIdStr) {
          return NextResponse.json(
            { error: 'Idempotency conflict: Portion creation ID reused for another visit.' },
            { status: 409 }
          );
        }
        return NextResponse.json({
          success: true,
          idempotent: true,
          is_replay: true,
          portion: {
            id: existingPortion.id.toString(),
            visit_id: existingPortion.visit_id.toString(),
            portion_number: existingPortion.portion_number,
            current_status: existingPortion.current_status,
            plant_decision: existingPortion.plant_decision || 'PENDING',
            plant_rejection_reason: existingPortion.plant_rejection_reason || null,
            dispatch_results: [],
            plant_results: [],
          },
        });
      }
    }

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: {
        portions: {
          orderBy: { portion_number: 'desc' },
          take: 1,
        },
        qa_session: true,
      },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Vehicle visit record not found' }, { status: 404 });
    }

    const currentMaxPortion = visit.portions.length > 0 ? visit.portions[0].portion_number : 0;
    const nextPortionNumber = currentMaxPortion + 1;

    let responsePayload: Record<string, unknown> | null = null;

    try {
      const newPortion = await prisma.$transaction(async (tx) => {
        const portion = await tx.visitPortion.create({
          data: {
            visit_id: visitId,
            portion_number: nextPortionNumber,
            current_status: 'UNDER_TEST',
            plant_decision: 'PENDING',
            manager_review_status: 'NONE',
            creation_client_event_id: clientOperationId || undefined,
          },
        });

        if (visit.qa_session && visit.qa_session.status === 'IN_PROGRESS') {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: visit.qa_session.id,
              event_type: 'PORTION_ADDED',
              timestamp: new Date(),
              user_id: dbUser.id,
              note: `QA Chemist added new test portion #${nextPortionNumber} for independent chamber sampling.`,
            },
          });
        }

        await writeAuditLog(tx, {
          tableName: 'visit_portion',
          recordId: portion.id,
          action: 'PLANT_QA_PORTION_ADDED',
          newValues: {
            visit_id: visitId.toString(),
            portion_number: nextPortionNumber,
            added_by: dbUser.username,
            creation_client_event_id: clientOperationId || null,
          },
          actor: auditActorFromUser(dbUser),
        });

        const formattedResponse = {
          success: true,
          portion: {
            id: portion.id.toString(),
            visit_id: portion.visit_id.toString(),
            portion_number: portion.portion_number,
            current_status: portion.current_status,
            plant_decision: portion.plant_decision || 'PENDING',
            plant_rejection_reason: portion.plant_rejection_reason || null,
            dispatch_results: [],
            plant_results: [],
          },
        };

        if (clientOperationId) {
          await recordOperation({
            key: clientOperationId,
            operationType: 'QA_ADD_PORTION',
            entityType: 'vehicle_visit',
            entityId: visitId,
            requestPayload: canonicalPayload,
            responsePayload: formattedResponse,
            statusCode: 200,
          }, tx);
        }

        return formattedResponse;
      });

      responsePayload = newPortion;
    } catch (txError) {
      if (clientOperationId) {
        const concurrentReplay = await handleConcurrentReplayOrConflict(clientOperationId, {
          operationType: 'QA_ADD_PORTION',
          entityType: 'vehicle_visit',
          entityId: visitId,
          incomingPayload: canonicalPayload,
        });
        if (concurrentReplay) return concurrentReplay;
      }

      if (
        txError instanceof Prisma.PrismaClientKnownRequestError &&
        txError.code === 'P2002' &&
        clientOperationId
      ) {
        // Concurrent replay won the race: return the winner's portion
        const winner = await prisma.visitPortion.findUnique({
          where: { creation_client_event_id: clientOperationId },
        });
        if (winner && winner.visit_id.toString() === visitIdStr) {
          return NextResponse.json({
            success: true,
            idempotent: true,
            is_replay: true,
            portion: {
              id: winner.id.toString(),
              visit_id: winner.visit_id.toString(),
              portion_number: winner.portion_number,
              current_status: winner.current_status,
              plant_decision: winner.plant_decision || 'PENDING',
              plant_rejection_reason: winner.plant_rejection_reason || null,
              dispatch_results: [],
              plant_results: [],
            },
          });
        }
      }
      throw txError;
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to create new QA test portion' },
      { status: 500 }
    );
  }
}
