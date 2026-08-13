import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = serializeBigInt(obj[key]);
    }
    return res;
  }
  return obj;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const user = await getCurrentUser();
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
      },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Vehicle visit record not found' }, { status: 404 });
    }

    // Fetch active PLANT & BOTH lab tests
    const activePlantTests = await prisma.labTest.findMany({
      where: {
        isActive: true,
        testScope: { in: ['PLANT', 'BOTH'] },
      },
      orderBy: [
        { displayOrder: 'asc' },
        { testName: 'asc' },
      ],
    });

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
      entry_timestamp: visit.gate_log?.entry_timestamp ? visit.gate_log.entry_timestamp.toISOString() : null,
      visit_decision_summary: visitDecisionSummary,
      portions: portions.map((p) => ({
        id: p.id.toString(),
        visit_id: p.visit_id.toString(),
        portion_number: p.portion_number,
        current_status: p.current_status,
        declared_quantity_kg: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0,
        plant_decision: p.plant_decision || 'PENDING',
        plant_rejection_reason: p.plant_rejection_reason || null,
        plant_decided_at: p.plant_decided_at ? p.plant_decided_at.toISOString() : null,
        dispatch_results: p.dispatch_lab_results.map((dr) => ({
          testId: dr.test_id.toString(),
          testCode: dr.lab_test.testCode,
          testName: dr.lab_test.testName,
          resultType: dr.lab_test.resultType,
          unit: dr.lab_test.unit,
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
          numericValue: pr.numeric_value ? Number(pr.numeric_value) : null,
          textValue: pr.text_value || null,
          isPassed: pr.is_passed,
        })),
      })),
      active_plant_tests: activePlantTests.map((t) => ({
        id: t.id.toString(),
        testCode: t.testCode,
        testName: t.testName,
        resultType: t.resultType,
        unit: t.unit,
        testScope: t.testScope,
        isRequired: t.isRequired,
        displayOrder: t.displayOrder,
      })),
    };

    return NextResponse.json({ visit: formattedVisit });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch vehicle visit details' }, { status: 500 });
  }
}
