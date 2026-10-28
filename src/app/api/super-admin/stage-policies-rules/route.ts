import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { isValidTestingPoint, TestingPoint } from '@/types/milk-test-policy';

const READ_ROLES = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'DATA_ANALYST', 'HEAD_OF_MPD', 'EXECUTIVE_MANAGEMENT', 'QA_HEAD'];
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

    const [labTests, policyAssignments, activeRules, globalRules] = await Promise.all([
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
      !isGlobal
        ? prisma.labTestRule.findMany({
            where: {
              testing_point: null,
              is_active: true,
            },
            orderBy: [{ version: 'desc' }],
          })
        : Promise.resolve([]),
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

    const globalRuleByTestId = new Map<string, (typeof globalRules)[number]>();
    for (const gr of globalRules) {
      const tid = gr.lab_test_id.toString();
      if (!globalRuleByTestId.has(tid)) {
        globalRuleByTestId.set(tid, gr);
      }
    }

    const items = labTests.map((t) => {
      const tid = t.id.toString();
      const policy = policyByTestId.get(tid) || null;
      const stageRule = ruleByTestId.get(tid) || null;
      const globalRule = globalRuleByTestId.get(tid) || null;
      const effectiveRule = stageRule || globalRule;
      const isInherited = Boolean(!isGlobal && !stageRule && globalRule);

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
          ? null
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
        rule: effectiveRule
          ? {
              id: effectiveRule.id.toString(),
              version: effectiveRule.version,
              ruleCategory: effectiveRule.rule_category,
              ruleTypeLabel: effectiveRule.rule_category === 'MONITORING' ? 'Warning Only' : 'Must Pass',
              minValue: effectiveRule.min_value !== null ? Number(effectiveRule.min_value) : null,
              maxValue: effectiveRule.max_value !== null ? Number(effectiveRule.max_value) : null,
              warningOffset: effectiveRule.warning_offset !== null ? Number(effectiveRule.warning_offset) : null,
              warningTrigger: effectiveRule.warning_trigger || 'BOTH',
              acceptableOption: effectiveRule.acceptable_option,
              effectiveFrom: effectiveRule.effective_from.toISOString(),
              isInherited,
              isRecordOnly: effectiveRule.warning_trigger === 'RECORD_ONLY',
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

    const assignedItems = isGlobal ? items : items.filter((i) => i.policy !== null);
    const unassignedTests = isGlobal
      ? []
      : items
          .filter((i) => i.policy === null)
          .map((i) => ({
            id: i.labTest.id,
            testCode: i.labTest.testCode,
            testName: i.labTest.testName,
            resultType: i.labTest.resultType,
            unit: i.labTest.unit,
          }));

    return NextResponse.json({
      testingPoint: isGlobal ? 'GLOBAL_DEFAULT' : testingPoint,
      canEdit: WRITE_ROLES.includes(role),
      items: assignedItems,
      unassignedTests,
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

    // 1. Quick Reorder Action
    if (body.action === 'reorder') {
      const { testingPoint, orderedTestIds } = body;
      if (!testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid testingPoint is required for reorder.' }, { status: 400 });
      }
      if (!Array.isArray(orderedTestIds) || orderedTestIds.length === 0) {
        return NextResponse.json({ error: 'orderedTestIds array is required.' }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < orderedTestIds.length; i++) {
          const tid = BigInt(String(orderedTestIds[i]));
          const seq = i + 1;
          const existing = await tx.milkTestPolicyAssignment.findUnique({
            where: {
              lab_test_id_testing_point: {
                lab_test_id: tid,
                testing_point: testingPoint,
              },
            },
          });
          if (existing) {
            await tx.milkTestPolicyAssignment.update({
              where: { id: existing.id },
              data: { display_order: seq, updated_by_user_id: dbUser.id },
            });
          } else {
            await tx.milkTestPolicyAssignment.create({
              data: {
                lab_test_id: tid,
                testing_point: testingPoint,
                is_active: true,
                is_required: true,
                display_order: seq,
                created_by_user_id: dbUser.id,
                updated_by_user_id: dbUser.id,
              },
            });
          }
        }
      });

      return NextResponse.json({ success: true, message: 'Tests reordered successfully.' });
    }

    // 2. Quick Assign Test to Stage Action
    if (body.action === 'assignTest') {
      const { labTestId, testingPoint } = body;
      if (!labTestId || !testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid labTestId and testingPoint are required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));

      await prisma.$transaction(async (tx) => {
        const existing = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: tid,
              testing_point: testingPoint,
            },
          },
        });
        if (existing) {
          await tx.milkTestPolicyAssignment.update({
            where: { id: existing.id },
            data: { is_active: true, updated_by_user_id: dbUser.id },
          });
        } else {
          const maxOrderResult = await tx.milkTestPolicyAssignment.aggregate({
            where: { testing_point: testingPoint },
            _max: { display_order: true },
          });
          const nextOrder = (maxOrderResult._max.display_order ?? 0) + 1;
          await tx.milkTestPolicyAssignment.create({
            data: {
              lab_test_id: tid,
              testing_point: testingPoint,
              is_active: true,
              is_required: true,
              display_order: nextOrder,
              created_by_user_id: dbUser.id,
              updated_by_user_id: dbUser.id,
            },
          });
        }
      });
      return NextResponse.json({ success: true, message: 'Test assigned to stage.' });
    }

    // 3. Confirm No Rule (Record Only) Action
    if (body.action === 'confirmNoRule') {
      const { labTestId, testingPoint, reason = 'Confirmed record only (no pass/fail rule)' } = body;
      if (!labTestId) {
        return NextResponse.json({ error: 'labTestId is required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));
      const isGlobal = testingPoint === 'GLOBAL_DEFAULT' || testingPoint === 'GLOBAL' || testingPoint === null;
      const pt = isGlobal ? null : testingPoint;

      await QualityRuleService.createOrSupersedeRule({
        labTestId: tid,
        testingPoint: pt,
        ruleCategory: 'MONITORING',
        minValue: null,
        maxValue: null,
        warningOffset: null,
        acceptableOption: null,
        warningTrigger: 'RECORD_ONLY',
        createdByUserId: dbUser.id,
        reason: typeof reason === 'string' && reason.trim().length >= 3 ? reason.trim() : 'Confirmed record only (no rule)',
      });

      return NextResponse.json({ success: true, message: 'Confirmed test has no pass/fail rule.' });
    }

    // 4. Quick Toggle Active Action
    if (body.action === 'toggleActive') {
      const { labTestId, testingPoint, isActive } = body;
      if (!labTestId || !testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid labTestId and testingPoint are required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));
      const activeBool = Boolean(isActive);

      await prisma.$transaction(async (tx) => {
        const existing = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: tid,
              testing_point: testingPoint,
            },
          },
        });
        if (existing) {
          await tx.milkTestPolicyAssignment.update({
            where: { id: existing.id },
            data: { is_active: activeBool, updated_by_user_id: dbUser.id },
          });
        } else {
          const maxOrderResult = await tx.milkTestPolicyAssignment.aggregate({
            where: { testing_point: testingPoint },
            _max: { display_order: true },
          });
          const nextOrder = (maxOrderResult._max.display_order ?? 0) + 1;
          await tx.milkTestPolicyAssignment.create({
            data: {
              lab_test_id: tid,
              testing_point: testingPoint,
              is_active: activeBool,
              is_required: true,
              display_order: nextOrder,
              created_by_user_id: dbUser.id,
              updated_by_user_id: dbUser.id,
            },
          });
        }

        // Sync testPointPolicy
        const pointCodesToSync: string[] = [];
        if (testingPoint === 'MOT_SHOP') pointCodesToSync.push('MOT_SHOP');
        else if (testingPoint === 'ZMCC_LAB_MC') pointCodesToSync.push('ZMCC_LAB_MC');
        else if (testingPoint === 'ZMCC_LAB_HC') pointCodesToSync.push('ZMCC_LAB_HC');
        else if (testingPoint === 'DISPATCH') pointCodesToSync.push('DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH');
        else if (testingPoint === 'PLANT_QA') pointCodesToSync.push('PLANT_QA');

        for (const pt of pointCodesToSync) {
          const existingTpp = await tx.testPointPolicy.findFirst({
            where: { lab_test_id: tid, testing_point: pt },
            orderBy: { version: 'desc' },
          });
          if (existingTpp) {
            await tx.testPointPolicy.update({
              where: { id: existingTpp.id },
              data: {
                test_mode: activeBool ? 'COMPULSORY' : 'OFF',
                version: existingTpp.version + 1,
                changed_by: dbUser.id,
                change_reason: `Quick toggle: ${activeBool ? 'Activated' : 'Deactivated'} at ${testingPoint}`,
              },
            });
          }
        }
      });

      return NextResponse.json({ success: true, isActive: activeBool });
    }

    // 5. Quick Toggle Required (Compulsory vs Optional)
    if (body.action === 'toggleRequired') {
      const { labTestId, testingPoint, isRequired } = body;
      if (!labTestId || !testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid labTestId and testingPoint are required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));
      const reqBool = Boolean(isRequired);

      await prisma.$transaction(async (tx) => {
        const existing = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: tid,
              testing_point: testingPoint,
            },
          },
        });
        if (existing) {
          await tx.milkTestPolicyAssignment.update({
            where: { id: existing.id },
            data: { is_required: reqBool, updated_by_user_id: dbUser.id },
          });
        }

        // Sync testPointPolicy
        const pointCodesToSync: string[] = [];
        if (testingPoint === 'MOT_SHOP') pointCodesToSync.push('MOT_SHOP');
        else if (testingPoint === 'ZMCC_LAB_MC') pointCodesToSync.push('ZMCC_LAB_MC');
        else if (testingPoint === 'ZMCC_LAB_HC') pointCodesToSync.push('ZMCC_LAB_HC');
        else if (testingPoint === 'DISPATCH') pointCodesToSync.push('DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH');
        else if (testingPoint === 'PLANT_QA') pointCodesToSync.push('PLANT_QA');

        for (const pt of pointCodesToSync) {
          const existingTpp = await tx.testPointPolicy.findFirst({
            where: { lab_test_id: tid, testing_point: pt },
            orderBy: { version: 'desc' },
          });
          if (existingTpp) {
            await tx.testPointPolicy.update({
              where: { id: existingTpp.id },
              data: {
                test_mode: reqBool ? 'COMPULSORY' : 'OPTIONAL',
                version: existingTpp.version + 1,
                changed_by: dbUser.id,
                change_reason: `Quick toggle: ${reqBool ? 'Compulsory' : 'Optional'} at ${testingPoint}`,
              },
            });
          }
        }
      });

      return NextResponse.json({ success: true, isRequired: reqBool });
    }

    // 6. Quick Toggle Photo Requirement
    if (body.action === 'togglePhoto') {
      const { labTestId, testingPoint, isPhotoRequired } = body;
      if (!labTestId || !testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid labTestId and testingPoint are required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));
      const photoBool = Boolean(isPhotoRequired);

      await prisma.$transaction(async (tx) => {
        const existing = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: tid,
              testing_point: testingPoint,
            },
          },
        });
        if (existing) {
          await tx.milkTestPolicyAssignment.update({
            where: { id: existing.id },
            data: { is_photo_required: photoBool, updated_by_user_id: dbUser.id },
          });
        }

        // Sync testPointPolicy
        const pointCodesToSync: string[] = [];
        if (testingPoint === 'MOT_SHOP') pointCodesToSync.push('MOT_SHOP');
        else if (testingPoint === 'ZMCC_LAB_MC') pointCodesToSync.push('ZMCC_LAB_MC');
        else if (testingPoint === 'ZMCC_LAB_HC') pointCodesToSync.push('ZMCC_LAB_HC');
        else if (testingPoint === 'DISPATCH') pointCodesToSync.push('DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH');
        else if (testingPoint === 'PLANT_QA') pointCodesToSync.push('PLANT_QA');

        for (const pt of pointCodesToSync) {
          const existingTpp = await tx.testPointPolicy.findFirst({
            where: { lab_test_id: tid, testing_point: pt },
            orderBy: { version: 'desc' },
          });
          if (existingTpp) {
            await tx.testPointPolicy.update({
              where: { id: existingTpp.id },
              data: {
                photo_mode: photoBool ? 'REQUIRED' : 'NONE',
                version: existingTpp.version + 1,
                changed_by: dbUser.id,
                change_reason: `Quick toggle photo: ${photoBool ? 'Required' : 'None'} at ${testingPoint}`,
              },
            });
          }
        }
      });

      return NextResponse.json({ success: true, isPhotoRequired: photoBool });
    }

    // 7. Unassign / Remove Test from Stage
    if (body.action === 'unassignTest') {
      const { labTestId, testingPoint } = body;
      if (!labTestId || !testingPoint || !isValidTestingPoint(testingPoint)) {
        return NextResponse.json({ error: 'Valid labTestId and testingPoint are required.' }, { status: 400 });
      }
      const tid = BigInt(String(labTestId));

      await prisma.$transaction(async (tx) => {
        await tx.milkTestPolicyAssignment.deleteMany({
          where: {
            lab_test_id: tid,
            testing_point: testingPoint,
          },
        });
      });

      return NextResponse.json({ success: true, message: 'Test removed from stage.' });
    }

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
      warningTrigger = 'BOTH',
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

      // A compulsory test must have a passing rule: without one the system cannot say YES or NO.
      if (!isGlobal && isActive && isRequired && (labTest.resultType === 'NUMERIC' || labTest.resultType === 'CALCULATED')) {
        const hasLimit = (v: unknown) => v !== null && v !== undefined && v !== '';
        if (!hasLimit(minValue) && !hasLimit(maxValue)) {
          throw new Error('A compulsory test needs a passing rule. Enter a minimum or maximum limit, or make the test optional.');
        }
      }

      // Update labTest.isPhotoRequired ONLY if global
      if (isGlobal && isPhotoRequired !== undefined) {
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
          warningTrigger: warningTrigger || 'BOTH',
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

        // Keep testPointPolicy in sync for engines reading test_point_policy
        const pointCodesToSync: string[] = [];
        if (testingPoint === 'MOT_SHOP') {
          pointCodesToSync.push('MOT_SHOP');
        } else if (testingPoint === 'ZMCC_LAB_MC') {
          pointCodesToSync.push('ZMCC_LAB_MC');
        } else if (testingPoint === 'ZMCC_LAB_HC') {
          pointCodesToSync.push('ZMCC_LAB_HC');
        } else if (testingPoint === 'DISPATCH') {
          pointCodesToSync.push('DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH');
        } else if (testingPoint === 'PLANT_QA') {
          pointCodesToSync.push('PLANT_QA');
        }

        const testModeVal = Boolean(isActive) ? (Boolean(isRequired) ? 'COMPULSORY' : 'OPTIONAL') : 'OFF';
        const photoModeVal = Boolean(isPhotoRequired) ? 'REQUIRED' : 'NONE';
        const ruleModeVal = normalizedRuleCategory === 'MONITORING' ? 'WARN' : 'APPLY';

        for (const pt of pointCodesToSync) {
          const existingTpp = await tx.testPointPolicy.findFirst({
            where: { lab_test_id: testIdBig, testing_point: pt },
            orderBy: { version: 'desc' },
          });

          if (existingTpp) {
            await tx.testPointPolicy.update({
              where: { id: existingTpp.id },
              data: {
                test_mode: testModeVal,
                rule_mode: ruleModeVal,
                photo_mode: photoModeVal,
                version: existingTpp.version + 1,
                changed_by: dbUser.id,
                change_reason: cleanReason,
              },
            });
          } else {
            await tx.testPointPolicy.create({
              data: {
                lab_test_id: testIdBig,
                testing_point: pt,
                test_mode: testModeVal,
                rule_mode: ruleModeVal,
                photo_mode: photoModeVal,
                version: 1,
                effective_from: new Date(),
                changed_by: dbUser.id,
                change_reason: cleanReason,
              },
            });
          }
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
