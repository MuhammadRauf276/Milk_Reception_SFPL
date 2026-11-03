import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import type { QualityEvaluationSnapshot } from '@/backend/services/qualityRuleService';

export async function GET(req: Request) {
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

  const allowedRoles = ['QA_HEAD', 'SUPER_ADMIN', 'DATA_EXECUTIVE'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Head, Super Admin or Data Executive role required.' },
      { status: 403 }
    );
  }

  try {
    const pendingPortions = await prisma.visitPortion.findMany({
      where: {
        manager_review_status: 'PENDING',
      },
      include: {
        visit: {
          include: {
            procurement_source: true,
            gate_log: true,
          },
        },
        plant_lab_results: {
          include: {
            lab_test: true,
            applied_rule: true,
          },
          orderBy: { test_id: 'asc' },
        },
        manager_requester: {
          select: {
            id: true,
            username: true,
            full_name: true,
          },
        },
      },
      orderBy: { manager_review_requested_at: 'asc' },
    });

    const serialized = pendingPortions.map((p) => ({
      portionId: p.id.toString(),
      visitId: p.visit_id.toString(),
      portionNumber: p.portion_number,
      vehicleNumber: p.visit.vehicle_number,
      sourceName: p.visit.procurement_source?.name || 'Unknown',
      sourceCode: p.visit.procurement_source?.code || '',
      systemQualityOutcome: p.system_quality_outcome,
      managerReviewStatus: p.manager_review_status,
      managerRequestedDecision: p.manager_requested_decision,
      managerReviewRequestedAt: p.manager_review_requested_at?.toISOString() || null,
      managerReviewReason: p.manager_review_reason,
      sealNumber: p.seal_number || null,
      plantSealNumberEntered: p.plant_seal_number_entered || null,
      sealMatch: p.seal_match,
      exceptionReasons: p.exception_reasons || null,
      requesterName: p.manager_requester?.full_name || p.manager_requester?.username || 'Unknown',
      vehicleExited: !!p.visit.gate_log?.exit_timestamp,
      results: p.plant_lab_results.map((r) => {
        // evaluation_snapshot is written by QualityRuleService as a QualityEvaluationSnapshot.
        const snapshot = r.evaluation_snapshot as QualityEvaluationSnapshot | null;
        return {
        id: r.id.toString(),
        testCode: r.lab_test.testCode,
        testName: r.lab_test.testName,
        resultType: r.lab_test.resultType,
        numericValue: r.numeric_value ? Number(r.numeric_value) : null,
        textValue: r.text_value,
        performanceStatus: r.performance_status,
        notPerformedReason: r.not_performed_reason,
        evaluationStatus: r.evaluation_status,
        isPassed: r.is_passed,
        appliedRuleVersion: snapshot?.releaseRule?.version || r.applied_rule?.version || r.applied_rule_version || null,
        appliedRule: snapshot?.releaseRule
          ? {
              id: snapshot.releaseRule.id,
              version: snapshot.releaseRule.version,
              category: snapshot.releaseRule.category,
              minValue: snapshot.releaseRule.minValue,
              maxValue: snapshot.releaseRule.maxValue,
              acceptableOption: snapshot.releaseRule.acceptableOption,
            }
          : (r.applied_rule
            ? {
                id: r.applied_rule.id.toString(),
                version: r.applied_rule.version,
                category: r.applied_rule.rule_category,
                minValue: r.applied_rule.min_value ? Number(r.applied_rule.min_value) : null,
                maxValue: r.applied_rule.max_value ? Number(r.applied_rule.max_value) : null,
                acceptableOption: r.applied_rule.acceptable_option,
              }
            : null),
        monitoringRule: snapshot?.monitoringRule || null,
        evaluationSnapshot: snapshot || null,
        };
      }),
    }));

    return NextResponse.json({
      success: true,
      pendingCount: serialized.length,
      portions: serialized,
      queue: serialized,
    });
  } catch (error) {
    console.error('Error in QA Manager queue route:', error);
    return NextResponse.json({ error: 'Failed to fetch manager review queue' }, { status: 500 });
  }
}
