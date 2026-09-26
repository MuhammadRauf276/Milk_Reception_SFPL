import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';
import { QualityRuleService } from '@/backend/services/qualityRuleService';

const createRuleSchema = z.object({
  labTestId: z.union([z.string(), z.number()]),
  testingPoint: z.enum([
    'PLANT_QA',
    'ZMCC_LAB_MOT',
    'ZMCC_LAB_CONTRACTOR',
    'ZMCC_LAB_LOCAL_SUPPLIER',
    'MOT_SHOP',
    'DISPATCH',
  ]),
  ruleCategory: z.enum(['RELEASE', 'MONITORING']).default('RELEASE'),
  minValue: z.union([z.number(), z.string()]).nullable().optional(),
  maxValue: z.union([z.number(), z.string()]).nullable().optional(),
  acceptableOption: z.string().nullable().optional(),
  warningTrigger: z.string().nullable().optional(),
  decisionConsequence: z.string().nullable().optional(),
  effectiveFrom: z.string().optional(),
  reason: z.string().trim().min(3, 'A substantive governance reason of at least 3 characters is required.'),
});

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

  const allowedRoles = ['QA_HEAD', 'QA_MANAGER', 'SUPER_ADMIN', 'DATA_EXECUTIVE'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. QA Head, QA Manager, Super Admin or Data Executive role required.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const testingPoint = searchParams.get('testingPoint');
  const isActive = searchParams.get('isActive');

  try {
    const rules = await prisma.labTestRule.findMany({
      where: {
        ...(testingPoint ? { testing_point: testingPoint } : {}),
        ...(isActive !== null && isActive !== undefined ? { is_active: isActive === 'true' } : {}),
      },
      include: {
        lab_test: true,
      },
      orderBy: [
        { testing_point: 'asc' },
        { lab_test_id: 'asc' },
        { version: 'desc' },
      ],
    });

    const serialized = rules.map((r) => ({
      id: r.id.toString(),
      labTestId: r.lab_test_id.toString(),
      testCode: r.lab_test.testCode,
      testName: r.lab_test.testName,
      resultType: r.lab_test.resultType,
      testingPoint: r.testing_point,
      version: r.version,
      ruleCategory: r.rule_category,
      effectiveFrom: r.effective_from.toISOString(),
      effectiveTo: r.effective_to?.toISOString() || null,
      minValue: r.min_value ? Number(r.min_value) : null,
      maxValue: r.max_value ? Number(r.max_value) : null,
      acceptableOption: r.acceptable_option,
      warningTrigger: r.warning_trigger,
      decisionConsequence: r.decision_consequence,
      isActive: r.is_active,
    }));

    return NextResponse.json({
      success: true,
      rules: serialized,
    });
  } catch (error: unknown) {
    console.error('Error fetching SOP rules:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch SOP rules';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

  const allowedRoles = ['QA_HEAD', 'QA_MANAGER', 'SUPER_ADMIN', 'DATA_EXECUTIVE'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Head, QA Manager, Super Admin, or Data Executive role is required to configure SOP rules.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const validated = createRuleSchema.parse(body);

    if (validated.testingPoint === 'ZMCC_LAB_CONTRACTOR') {
      return NextResponse.json(
        { error: "Testing point 'ZMCC_LAB_CONTRACTOR' is deprecated and blocked for new rules. Use 'ZMCC_LAB_MOT' or 'ZMCC_LAB_LOCAL_SUPPLIER' instead." },
        { status: 400 }
      );
    }

    const effectiveDate = validated.effectiveFrom ? new Date(validated.effectiveFrom) : new Date();

    const newRule = await QualityRuleService.createOrSupersedeRule({
      labTestId: validated.labTestId,
      testingPoint: validated.testingPoint,
      ruleCategory: validated.ruleCategory,
      minValue: validated.minValue,
      maxValue: validated.maxValue,
      acceptableOption: validated.acceptableOption,
      warningTrigger: validated.warningTrigger,
      decisionConsequence: validated.decisionConsequence,
      effectiveFrom: effectiveDate,
      createdByUserId: dbUser.id,
      reason: validated.reason,
    });

    return NextResponse.json({
      success: true,
      rule: {
        id: newRule.id.toString(),
        labTestId: newRule.lab_test_id.toString(),
        testingPoint: newRule.testing_point,
        version: newRule.version,
        ruleCategory: newRule.rule_category,
        isActive: newRule.is_active,
        effectiveFrom: newRule.effective_from.toISOString(),
      },
    });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null) {
      const errRecord = error as { name?: string; issues?: Array<{ message: string }>; errors?: Array<{ message: string }>; message?: string };
      if (errRecord.name === 'ZodError' || errRecord.issues) {
        const msg = errRecord.issues?.[0]?.message || errRecord.errors?.[0]?.message || errRecord.message || 'Validation failed';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      console.error('Error creating SOP rule:', error);
      return NextResponse.json({ error: errRecord.message || 'Failed to create SOP rule' }, { status: 400 });
    }
    console.error('Error creating SOP rule:', error);
    return NextResponse.json({ error: 'Failed to create SOP rule' }, { status: 400 });
  }
}
