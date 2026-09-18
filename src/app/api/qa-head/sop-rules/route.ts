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

  const allowedRoles = ['QA_HEAD', 'QA_MANAGER', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. QA Head or Admin role required.' }, { status: 403 });
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
  } catch (error: any) {
    console.error('Error fetching SOP rules:', error);
    return NextResponse.json({ error: 'Failed to fetch SOP rules' }, { status: 500 });
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

  const allowedRoles = ['QA_HEAD'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Head role is strictly required to configure SOP rules.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const validated = createRuleSchema.parse(body);

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
  } catch (error: any) {
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error('Error creating SOP rule:', error);
    return NextResponse.json({ error: error.message || 'Failed to create SOP rule' }, { status: 400 });
  }
}
