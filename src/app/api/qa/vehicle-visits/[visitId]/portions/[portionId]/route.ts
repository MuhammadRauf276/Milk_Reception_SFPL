import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getErrorMessage } from '@/lib/errors';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

export async function DELETE(
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


  if (!dbUser || !canActAs(dbUser.role, 'QA_LAB_ATTENDANT')) {
    return NextResponse.json(
      { error: 'Unauthorized. QA role required for removing test portions.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  try {
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: {
        portions: {
          orderBy: { portion_number: 'asc' },
        },
        qa_session: true,
      },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Vehicle visit record not found' }, { status: 404 });
    }

    if (visit.portions.length <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove portion. A vehicle visit must have at least one test portion.' },
        { status: 400 }
      );
    }

    const portion = visit.portions.find((p) => p.id === portionId);
    if (!portion) {
      return NextResponse.json({ error: 'Portion record not found' }, { status: 404 });
    }

    // Do not allow deleting an already finalized portion
    if (portion.plant_decision === 'ACCEPTED' || portion.plant_decision === 'REJECTED') {
      return NextResponse.json(
        { error: 'Cannot remove portion. This portion has already been finalized.' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete any draft plant lab results for this portion
      await tx.plantLabResult.deleteMany({
        where: { portion_id: portionId },
      });

      // Delete any QA warnings linked to this portion
      await tx.qAWarning.deleteMany({
        where: { portion_id: portionId },
      });

      // Delete the portion
      await tx.visitPortion.delete({
        where: { id: portionId },
      });

      if (visit.qa_session && visit.qa_session.status === 'IN_PROGRESS') {
        await tx.qATestingSessionEvent.create({
          data: {
            session_id: visit.qa_session.id,
            event_type: 'PORTION_REMOVED',
            timestamp: new Date(),
            user_id: dbUser.id,
            note: `QA Chemist removed unintentionally added test portion #${portion.portion_number}.`,
          },
        });
      }

      await writeAuditLog(tx, {
        tableName: 'visit_portion',
        recordId: portionId,
        action: 'PLANT_QA_PORTION_REMOVED',
        oldValues: {
          visit_id: visitId.toString(),
          portion_number: portion.portion_number,
        },
        actor: auditActorFromUser(dbUser),
      });
    });

    return NextResponse.json({
      success: true,
      message: `Portion #${portion.portion_number} removed successfully.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to remove test portion' },
      { status: 500 }
    );
  }
}
