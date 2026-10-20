import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';
import { MilkTestPolicyService } from '@/backend/services/milkTestPolicyService';
import { getErrorMessage } from '@/lib/errors';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;

  try {
    const visitId = BigInt(visitIdStr);

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: {
        portions: {
          include: {
            dispatch_lab_results: {
              include: { lab_test: true },
            },
            plant_lab_results: {
              include: { lab_test: true },
            },
          },
          orderBy: { portion_number: 'asc' },
        },
        gate_log: true,
        qa_session: true,
      },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Vehicle visit record not found' }, { status: 404 });
    }

    // For in-progress / completed QA work: use assigned snapshot.
    // For waiting visits prior to QA start: query current active master tests.
    const activePlantTests = visit.qa_session
      ? (await getOrAssignPlantQATests(prisma, visitId)).map((a) => ({
          id: a.test_id.toString(),
          testCode: a.test_code_snapshot,
          testName: a.test_name_snapshot,
          resultType: a.result_type_snapshot,
          unit: a.unit_snapshot,
          testScope: a.test_scope_snapshot || 'BOTH',
          isRequired: a.is_required_snapshot,
          displayOrder: a.display_order_snapshot,
          resultOptions: a.result_options_snapshot || null,
        }))
      : (await MilkTestPolicyService.getEffectivePolicy('PLANT_QA')).map((t) => ({
          id: t.id,
          testCode: t.testCode,
          testName: t.testName,
          resultType: t.resultType,
          unit: t.unit,
          testScope: 'BOTH',
          isRequired: t.isRequired,
          displayOrder: t.displayOrder,
          resultOptions: t.resultOptions || null,
        }));

    // Determine overall visit decision summary
    const portions = visit.portions || [];
    const decisions = portions.map((p) => p.plant_decision || 'PENDING');
    const allAccepted = decisions.length > 0 && decisions.every((d) => d === 'ACCEPTED');
    const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
    const hasAccepted = decisions.some((d) => d === 'ACCEPTED');
    const hasRejected = decisions.some((d) => d === 'REJECTED');

    let visitDecisionSummary = 'PENDING';
    if (allAccepted) visitDecisionSummary = 'ACCEPTED';
    else if (allRejected) visitDecisionSummary = 'REJECTED';
    else if (hasAccepted && hasRejected) visitDecisionSummary = 'PARTIALLY_ACCEPTED';

    const formattedVisit = {
      id: visit.id.toString(),
      visit_number: visit.visit_number,
      reception_number: visit.reception_number || null,
      vehicle_number: visit.vehicle_number,
      token_number: visit.token_number || null,
      identifiers: vehicleVisitPaperIdentity(visit),
      operational_date: visit.operational_date ? visit.operational_date.toISOString().split('T')[0] : null,
      entry_timestamp: visit.gate_log?.entry_timestamp ? visit.gate_log.entry_timestamp.toISOString() : null,
      current_status: visit.current_status,
      test_mode: visit.test_mode || 'PORTION_WISE',
      visit_decision_summary: visitDecisionSummary,
      vehicle_dispatch_quantity_value: visit.vehicle_dispatch_quantity_value !== null && visit.vehicle_dispatch_quantity_value !== undefined
        ? Number(visit.vehicle_dispatch_quantity_value)
        : null,
      vehicle_dispatch_quantity_unit: visit.vehicle_dispatch_quantity_unit || null,
      vehicle_dispatch_quantity_basis: visit.vehicle_dispatch_quantity_basis || null,
      vehicle_dispatch_lr: visit.vehicle_dispatch_lr !== null && visit.vehicle_dispatch_lr !== undefined
        ? Number(visit.vehicle_dispatch_lr)
        : null,
      vehicle_dispatch_fat: visit.vehicle_dispatch_fat !== null && visit.vehicle_dispatch_fat !== undefined
        ? Number(visit.vehicle_dispatch_fat)
        : null,
      vehicle_dispatch_snf: visit.vehicle_dispatch_snf !== null && visit.vehicle_dispatch_snf !== undefined
        ? Number(visit.vehicle_dispatch_snf)
        : null,
      portions: portions.map((p) => ({
        id: p.id.toString(),
        visit_id: p.visit_id.toString(),
        portion_number: p.portion_number,
        current_status: p.current_status,
        dispatch_quantity_value: p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined
          ? Number(p.dispatch_quantity_value)
          : null,
        dispatch_quantity_unit: p.dispatch_quantity_unit || null,
        dispatch_quantity_basis: p.dispatch_quantity_basis || null,
        plant_decision: p.plant_decision || 'PENDING',
        plant_rejection_reason: p.plant_rejection_reason || null,
        plant_decided_at: p.plant_decided_at ? p.plant_decided_at.toISOString() : null,
        seal_number: p.seal_number || null,
        plant_seal_number_entered: p.plant_seal_number_entered || null,
        seal_match: p.seal_match !== null && p.seal_match !== undefined ? p.seal_match : null,
        exception_reasons: p.exception_reasons || [],
        dispatch_results: p.dispatch_lab_results.map((dr) => ({
          testId: dr.test_id.toString(),
          testCode: dr.lab_test.testCode,
          testName: dr.lab_test.testName,
          resultType: dr.lab_test.resultType,
          unit: dr.lab_test.unit,
          performanceStatus: dr.performance_status,
          notPerformedReason: dr.not_performed_reason || null,
          numericValue: dr.numeric_value ? Number(dr.numeric_value) : null,
          textValue: dr.text_value || null,
          isPassed: dr.is_passed,
        })),
        plant_results: p.plant_lab_results.map((pr) => ({
          testId: pr.test_id.toString(),
          testCode: pr.lab_test.testCode,
          testName: pr.lab_test.testName,
          resultType: pr.lab_test.resultType,
          unit: pr.lab_test.unit,
          performanceStatus: pr.performance_status,
          notPerformedReason: pr.not_performed_reason || null,
          numericValue: pr.numeric_value ? Number(pr.numeric_value) : null,
          textValue: pr.text_value || null,
          isPassed: pr.is_passed,
        })),
      })),
      active_plant_tests: activePlantTests,
    };

    return NextResponse.json({ visit: formattedVisit });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to fetch vehicle visit details' }, { status: 500 });
  }
}
