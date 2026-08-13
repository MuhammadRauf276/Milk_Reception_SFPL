import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const rules = await prisma.labTestRule.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        lab_test: {
          select: { testCode: true, testName: true, resultType: true, unit: true },
        },
      },
    });

    const serialized = rules.map((r) => ({
      id: r.id.toString(),
      testCode: r.lab_test.testCode,
      testName: r.lab_test.testName,
      resultType: r.lab_test.resultType,
      unit: r.lab_test.unit,
      version: r.version,
      ruleCategory: r.rule_category,
      minValue: r.min_value ? Number(r.min_value) : null,
      maxValue: r.max_value ? Number(r.max_value) : null,
      acceptableOption: r.acceptable_option,
      warningTrigger: r.warning_trigger,
      decisionConsequence: r.decision_consequence,
      isActive: r.is_active,
      effectiveFrom: r.effective_from.toISOString(),
      effectiveTo: r.effective_to ? r.effective_to.toISOString() : null,
    }));

    return NextResponse.json({ rules: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
