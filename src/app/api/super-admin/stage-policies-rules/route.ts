import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { isValidTestingPoint, TestingPoint } from '@/types/milk-test-policy';

const READ_ROLES = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'DATA_ANALYST', 'HEAD_OF_MPD', 'QA_HEAD'];
const WRITE_ROLES = ['SUPER_ADMIN', 'DATA_EXECUTIVE'];

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const role = authUser.role?.trim() || '';
  if (!READ_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden. Insufficient role permissions.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const testingPointParam = searchParams.get('testingPoint') || 'PLANT_QA';
    const isGlobal = testingPointParam === 'GLOBAL_DEFAULT' || testingPointParam === 'GLOBAL';

    if (!isGlobal && !isValidTestingPoint(testingPointParam)) {
      return NextResponse.json({ error: `Invalid testingPoint "${testingPointParam}".` }, { status: 400 });
    }

    const testingPoint = isGlobal ? null : (testingPointParam as TestingPoint);

    const [labTests, policyAssignments, activeRules] = await Promise.all([
      prisma.labTest.findMany({
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
      !isGlobal && testingPoint
        ? prisma.milkTestPolicyAssignment.findMany({
            where: { testing_point: testingPoint },
            orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
      prisma.labTestRule.findMany({
        where: {
          testing_point: isGlobal ? null : testingPoint,
          is_active: true,
        },
        orderBy: [{ version: 'desc' }],
      }),
    ]);

    const policyByTestId = new Map<string, (typeof policyAssignments)[number]>();
    for (const p of policyAssignments) {
      policyByTestId.set(p.lab_test_id.toString(), p);
    }

    const ruleByTestId = new Map<string, (typeof activeRules)[number]>();
    for (const r of activeRules) {
      const tid = r.lab_test_id.toString();
      if (!ruleByTestId.has(tid)) {
        ruleByTestId.set(tid, r);
      }
    }

    const items = labTests.map((t) => {
      const tid = t.id.toString();
      const policy = policyByTestId.get(tid) || null;
      const rule = ruleByTestId.get(tid) || null;

      return {
        labTest: {
          id: tid,
          testCode: t.testCode,
          testName: t.testName,
          resultType: t.resultType,
          unit: t.unit,
          isActive: t.isActive,
          displayOrder: t.displayOrder,
          resultOptions: t.resultOptions,
          isPhotoRequired: t.isPhotoRequired ?? false,
        },
        policy: isGlobal
          ? {
              id: `global-${tid}`,
              isActive: t.isActive,
              isRequired: true,
              isPhotoRequired: t.isPhotoRequired ?? false,
              displayOrder: t.displayOrder ?? 1,
              updatedAt: new Date().toISOString(),
            }
          : policy
          ? {
              id: policy.id.toString(),
              isActive: policy.is_active,
              isRequired: policy.is_required,
              isPhotoRequired: policy.is_photo_required ?? t.isPhotoRequired ?? false,
              displayOrder: policy.display_order,
              updatedAt: policy.updated_at.toISOString(),
            }
          : null,
        rule: rule
          ? {
              id: rule.id.toString(),
              version: rule.version,
              ruleCategory: rule.rule_category,
              ruleTypeLabel: rule.rule_category === 'MONITORING' ? 'Warning Only' : 'Must Pass',
              minValue: rule.min_value !== null ? Number(rule.min_value) : null,
              maxValue: rule.max_value !== null ? Number(rule.max_value) : null,
              warningOffset: rule.warning_offset !== null ? Number(rule.warning_offset) : null,
              acceptableOption: rule.acceptable_option,
              effectiveFrom: rule.effective_from.toISOString(),
            }
          : null,
      };
    });

    items.sort((a, b) => {
      const aActive = a.policy?.isActive ? 0 : 1;
      const bActive = b.policy?.isActive ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aOrder = a.policy?.displayOrder ?? a.labTest.displayOrder ?? 999;
      const bOrder = b.policy?.displayOrder ?? b.labTest.displayOrder ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.labTest.testCode.localeCompare(b.labTest.testCode);
    });

    return NextResponse.json({
      testingPoint: isGlobal ? 'GLOBAL_DEFAULT' : testingPoint,
      canEdit: WRITE_ROLES.includes(role),
      items,
    });
  } catch (err: unknown) {
    console.error('[API_STAGE_POLICIES_RULES_GET_ERROR]', err);
    const message = err instanceof Error ? err.message : 'Failed to load stage policies and rules.';
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
      OR: [{ username: authUser.username }, { username: String(authUser.id) }],
      is_active: true,
    },
  });

  if (!dbUser || !WRITE_ROLES.includes(dbUser.role.trim())) {
    return NextResponse.json(
      { error: 'Forbidden. Only Super Admin and Data Executive can configure stage test policies and rules.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      labTestId,
      testingPoint,
      isActive = true,
      isRequired = true,
      displayOrder = 1,
      ruleCategory = 'RELEASE',
      minValue = null,
      maxValue = null,
      warningOffset = null,
      isPhotoRequired = false,
      acceptableOption = null,
      reason = 'Updated stage policy and passing rule',
    } = body;

    if (!labTestId) {
      return NextResponse.json({ error: 'labTestId is required.' }, { status: 400 });
    }

    const isGlobal = testingPoint === 'GLOBAL_DEFAULT' || testingPoint === 'GLOBAL' || testingPoint === null;

    if (!isGlobal && (!testingPoint || !isValidTestingPoint(testingPoint))) {
      return NextResponse.json({ error: 'Valid testingPoint is required.' }, { status: 400 });
    }

    if (testingPoint === 'ZMCC_LAB_CONTRACTOR') {
      return NextResponse.json(
        { error: "Testing point 'ZMCC_LAB_CONTRACTOR' is historical only. Use 'ZMCC_LAB_MOT' or 'ZMCC_LAB_LOCAL_SUPPLIER'." },
        { status: 400 }
      );
    }

    const normalizedRuleCategory: 'RELEASE' | 'MONITORING' =
      ruleCategory === 'MONITORING' ? 'MONITORING' : 'RELEASE';

    const cleanReason =
      typeof reason === 'string' && reason.trim().length >= 3
        ? reason.trim()
        : 'Configured stage policy and passing rule';

    const testIdBig = BigInt(String(labTestId));
    const parsedDisplayOrder = Number.isFinite(Number(displayOrder)) ? Math.trunc(Number(displayOrder)) : 1;
    const parsedWarningOffset =
      warningOffset !== null && warningOffset !== undefined && warningOffset !== ''
        ? Number(warningOffset)
        : null;

    const result = await prisma.$transaction(async (tx) => {
      const labTest = await tx.labTest.findUnique({ where: { id: testIdBig } });
      if (!labTest) {
        throw new Error('Selected LabTest does not exist.');
      }

      if (labTest.resultType === 'NUMERIC' || labTest.resultType === 'CALCULATED') {
        if (
          minValue !== null &&
          minValue !== undefined &&
          minValue !== '' &&
          maxValue !== null &&
          maxValue !== undefined &&
          maxValue !== '' &&
          Number(minValue) > Number(maxValue)
        ) {
          throw new Error('Minimum limit cannot be greater than Maximum limit.');
        }
      }

      // Update labTest.isPhotoRequired if global or provided
      if (isGlobal || isPhotoRequired !== undefined) {
        await tx.labTest.update({
          where: { id: testIdBig },
          data: {
            isPhotoRequired: Boolean(isPhotoRequired),
          },
        });
      }

      // 1. Create / Version the SOP Rule FIRST inside the atomic transaction
      const savedRule = await QualityRuleService.createOrSupersedeRule(
        {
          labTestId: testIdBig,
          testingPoint: isGlobal ? null : (testingPoint as string),
          ruleCategory: normalizedRuleCategory,
          minValue: labTest.resultType === 'NUMERIC' || labTest.resultType === 'CALCULATED' ? minValue : null,
          maxValue: labTest.resultType === 'NUMERIC' || labTest.resultType === 'CALCULATED' ? maxValue : null,
          warningOffset: labTest.resultType === 'NUMERIC' || labTest.resultType === 'CALCULATED' ? parsedWarningOffset : null,
          acceptableOption: labTest.resultType === 'QUALITATIVE' ? (acceptableOption || 'PASS') : null,
          createdByUserId: dbUser.id,
          reason: cleanReason,
        },
        tx
      );

      // 2. Upsert the Stage Policy Assignment SECOND inside the same transaction (only if not global)
      let savedPolicyId = 'global';
      if (!isGlobal && testingPoint) {
        const existingPolicy = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: testIdBig,
              testing_point: testingPoint as string,
            },
          },
        });

        if (existingPolicy) {
          const updated = await tx.milkTestPolicyAssignment.update({
            where: { id: existingPolicy.id },
            data: {
              is_active: Boolean(isActive),
              is_required: Boolean(isRequired),
              is_photo_required: Boolean(isPhotoRequired),
              display_order: parsedDisplayOrder,
              updated_by_user_id: dbUser.id,
            },
          });
          savedPolicyId = updated.id.toString();
        } else {
          const created = await tx.milkTestPolicyAssignment.create({
            data: {
              lab_test_id: testIdBig,
              testing_point: testingPoint as string,
              is_active: Boolean(isActive),
              is_required: Boolean(isRequired),
              is_photo_required: Boolean(isPhotoRequired),
              display_order: parsedDisplayOrder,
              created_by_user_id: dbUser.id,
              updated_by_user_id: dbUser.id,
            },
          });
          savedPolicyId = created.id.toString();
        }
      }

      return { savedPolicyId, savedRule };
    });

    return NextResponse.json({
      success: true,
      policyId: result.savedPolicyId,
      ruleId: result.savedRule.id.toString(),
      ruleVersion: result.savedRule.version,
    });
  } catch (err: unknown) {
    console.error('[API_STAGE_POLICIES_RULES_POST_ERROR]', err);
    const message = err instanceof Error ? err.message : 'Failed to save stage test policy and rule.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
