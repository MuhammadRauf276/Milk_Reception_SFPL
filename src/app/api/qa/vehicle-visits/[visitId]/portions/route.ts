import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

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

  try {
    const visitId = BigInt(visitIdStr);

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

    const newPortion = await prisma.$transaction(async (tx) => {
      const portion = await tx.visitPortion.create({
        data: {
          visit_id: visitId,
          portion_number: nextPortionNumber,
          current_status: 'UNDER_TEST',
          plant_decision: 'PENDING',
          manager_review_status: 'NONE',
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
        },
        actor: auditActorFromUser(dbUser),
      });

      return portion;
    });

    return NextResponse.json({
      success: true,
      portion: {
        id: newPortion.id.toString(),
        visit_id: newPortion.visit_id.toString(),
        portion_number: newPortion.portion_number,
        current_status: newPortion.current_status,
        plant_decision: newPortion.plant_decision || 'PENDING',
        plant_rejection_reason: newPortion.plant_rejection_reason || null,
        dispatch_results: [],
        plant_results: [],
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to create new QA test portion' },
      { status: 500 }
    );
  }
}
