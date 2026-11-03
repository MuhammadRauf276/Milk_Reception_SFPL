import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { LabTestResultOption, resultOptionsArraySchema, validatePlantQAResultOptions } from '@/lib/validations/labTest';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import { isLabTestRole, roleEditBlock } from '@/lib/lab-test-roles';
import { requireRoles } from '@/backend/core/route-guards';
import { setPhotoRequiredForTest } from '@/backend/services/testPointPolicyService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'DATA_EXECUTIVE')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin or Data Executive authorization required.' }, { status: 403 });
  }

  const { id: testIdStr } = await params;
  const testId = BigInt(testIdStr);

  try {
    const body = await req.json();
    const targetTest = await prisma.labTest.findUnique({ where: { id: testId } });
    if (!targetTest) {
      return NextResponse.json({ error: 'Target Lab Test record not found.' }, { status: 404 });
    }

    // Tests the milk formulas depend on (LR, Fat, ...) are protected: they cannot be switched off or change type.
    const storedRole = (targetTest as { systemRole?: string | null }).systemRole ?? null;
    if (storedRole) {
      if (body.resultType && body.resultType !== targetTest.resultType) {
        return NextResponse.json({ error: `"${targetTest.testName}" is the ${storedRole} test the milk formulas use, so its result type cannot change.` }, { status: 400 });
      }
    }

    // A role holder cannot be switched off, and a role cannot be given to an inactive test.
    const roleBlock = roleEditBlock({ testName: targetTest.testName, systemRole: storedRole, isActive: targetTest.isActive }, body);
    if (roleBlock) return NextResponse.json({ error: roleBlock }, { status: 400 });

    // Assigning / moving a role (Super Admin only). One test per role: the role must be free, or cleared on the other test first.
    if (body.systemRole !== undefined) {
      if (authUser.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Only Super Admin can assign a system role.' }, { status: 403 });
      }
      if (body.systemRole !== null && !isLabTestRole(body.systemRole)) {
        return NextResponse.json({ error: 'Unknown system role.' }, { status: 400 });
      }
      if (body.systemRole !== null) {
        if ((body.systemRole === 'LR' || body.systemRole === 'FAT') && targetTest.resultType !== 'NUMERIC') {
          return NextResponse.json({ error: 'LR and Fat must be numeric tests.' }, { status: 400 });
        }
        const holder = await prisma.labTest.findFirst({ where: { systemRole: body.systemRole, NOT: { id: testId } }, select: { testCode: true, testName: true } });
        if (holder) {
          return NextResponse.json({ error: `${body.systemRole} is already set on "${holder.testName}" (${holder.testCode}). Clear it there first.` }, { status: 409 });
        }
      }
    }

    // RESULT_TYPE IMMUTABILITY PROTECTION ENFORCEMENT
    if (body.resultType && body.resultType !== targetTest.resultType) {
      const dispatchCount = await prisma.dispatchLabResult.count({ where: { test_id: testId } });
      const plantCount = await prisma.plantLabResult.count({ where: { test_id: testId } });
      const zmccCount = await prisma.zmccLabResult.count({ where: { test_id: testId } });
      const totalCount = dispatchCount + plantCount + zmccCount;

      if (totalCount > 0) {
        return NextResponse.json(
          {
            error: `Result type change rejected. Cannot change resultType from "${targetTest.resultType}" to "${body.resultType}" for Lab Test "${targetTest.testCode}" (${targetTest.testName}) because ${totalCount} historical result records already exist.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate resultOptions if provided
    let parsedResultOptions: LabTestResultOption[] | null | undefined =
      (targetTest.resultOptions as unknown as LabTestResultOption[] | null) ?? undefined;
    const effectiveType = body.resultType || targetTest.resultType;
    const effectiveScope = body.testScope || targetTest.testScope;
    const effectiveRequired = body.isRequired !== undefined ? Boolean(body.isRequired) : targetTest.isRequired;

    if (body.resultOptions !== undefined) {
      if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(effectiveType)) {
        if (body.resultOptions !== null) {
          const parseRes = resultOptionsArraySchema.safeParse(body.resultOptions);
          if (!parseRes.success) {
            return NextResponse.json({ error: parseRes.error.issues[0]?.message || 'Invalid result options' }, { status: 400 });
          }
          parsedResultOptions = parseRes.data;
        } else {
          parsedResultOptions = null;
        }
      } else {
        if (body.resultOptions && body.resultOptions.length > 0) {
          return NextResponse.json({ error: `Result options are not permitted for ${effectiveType} tests.` }, { status: 400 });
        }
        parsedResultOptions = null;
      }
    }

    // Enforce valid Plant QA options (cannot be all-neutral for required Plant test)
    const plantValidation = validatePlantQAResultOptions(
      effectiveScope,
      effectiveRequired,
      effectiveType,
      parsedResultOptions
    );
    if (!plantValidation.isValid) {
      return NextResponse.json({ error: plantValidation.error }, { status: 400 });
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const updatedTest = await prisma.$transaction(async (tx) => {
      const updated = await tx.labTest.update({
        where: { id: testId },
        data: {
          testName: body.testName !== undefined ? body.testName.trim() : targetTest.testName,
          unit: body.unit !== undefined ? (body.unit ? body.unit.trim() : null) : targetTest.unit,
          testScope: body.testScope !== undefined ? body.testScope : targetTest.testScope,
          displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : targetTest.displayOrder,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : targetTest.isActive,
          isPhotoRequired: body.isPhotoRequired !== undefined ? Boolean(body.isPhotoRequired) : targetTest.isPhotoRequired,
          ...(body.systemRole !== undefined ? { systemRole: body.systemRole } : {}),
          resultOptions: parsedResultOptions !== undefined
            ? (parsedResultOptions === null ? Prisma.DbNull : (parsedResultOptions as unknown as Prisma.InputJsonValue))
            : undefined,
        },
      });

      if (body.isPhotoRequired !== undefined) {
        const photoVal = Boolean(body.isPhotoRequired);
        await tx.milkTestPolicyAssignment.updateMany({
          where: {
            lab_test_id: testId,
          },
          data: {
            is_photo_required: photoVal,
            updated_by_user_id: adminUser?.id ?? BigInt(1),
          },
        });
      }

      if (body.isRequired !== undefined) {
        const reqVal = Boolean(body.isRequired);
        await tx.milkTestPolicyAssignment.updateMany({
          where: {
            lab_test_id: testId,
          },
          data: {
            is_required: reqVal,
            updated_by_user_id: adminUser?.id ?? BigInt(1),
          },
        });
      }

      const minVal = body.minValue !== undefined && body.minValue !== '' && body.minValue !== null ? Number(body.minValue) : null;
      const maxVal = body.maxValue !== undefined && body.maxValue !== '' && body.maxValue !== null ? Number(body.maxValue) : null;
      const optVal = typeof body.acceptableOption === 'string' && body.acceptableOption.trim() ? body.acceptableOption.trim() : null;
      const warningHoldVal = typeof body.warningHoldText === 'string'
        ? body.warningHoldText.trim()
        : typeof body.warningHold === 'string'
        ? body.warningHold.trim()
        : undefined;
      const failRejectVal = typeof body.failRejectText === 'string'
        ? body.failRejectText.trim()
        : typeof body.failReject === 'string'
        ? body.failReject.trim()
        : undefined;
      const ruleCategoryVal = body.category === 'MONITORING' || body.category === 'RELEASE'
        ? body.category
        : (targetTest.testScope === 'MONITORING' ? 'MONITORING' : 'RELEASE');

      // 1. Update all existing rules for this lab test with the new limits and thresholds
      const ruleUpdateData: Prisma.LabTestRuleUpdateInput = {};
      if (body.minValue !== undefined) ruleUpdateData.min_value = minVal;
      if (body.maxValue !== undefined) ruleUpdateData.max_value = maxVal;
      if (body.acceptableOption !== undefined) ruleUpdateData.acceptable_option = optVal;
      if (warningHoldVal !== undefined) ruleUpdateData.warning_trigger = warningHoldVal && warningHoldVal !== '—' ? warningHoldVal : null;
      if (failRejectVal !== undefined) ruleUpdateData.decision_consequence = failRejectVal && failRejectVal !== '—' ? failRejectVal : null;
      if (body.category !== undefined) ruleUpdateData.rule_category = ruleCategoryVal;

      if (Object.keys(ruleUpdateData).length > 0) {
        await tx.labTestRule.updateMany({
          where: { lab_test_id: testId },
          data: ruleUpdateData,
        });
      }

      // 2. Synchronize stage policy assignments and stage rules
      if (Array.isArray(body.assignedStages)) {
        const ALL_POSSIBLE_STAGES = ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA'];

        for (const stage of ALL_POSSIBLE_STAGES) {
          const shouldBeActive = body.assignedStages.includes(stage);
          const existingAssignment = await tx.milkTestPolicyAssignment.findUnique({
            where: {
              lab_test_id_testing_point: {
                lab_test_id: testId,
                testing_point: stage,
              },
            },
          });

          if (existingAssignment) {
            await tx.milkTestPolicyAssignment.update({
              where: { id: existingAssignment.id },
              data: {
                is_active: shouldBeActive,
                updated_by_user_id: adminUser?.id ?? BigInt(1),
              },
            });
          } else if (shouldBeActive) {
            const maxOrder = await tx.milkTestPolicyAssignment.aggregate({
              where: { testing_point: stage },
              _max: { display_order: true },
            });
            const nextOrder = (maxOrder._max.display_order ?? 0) + 1;
            await tx.milkTestPolicyAssignment.create({
              data: {
                lab_test_id: testId,
                testing_point: stage,
                is_active: true,
                is_required: true,
                display_order: nextOrder,
                created_by_user_id: adminUser?.id ?? BigInt(1),
                updated_by_user_id: adminUser?.id ?? BigInt(1),
              },
            });
          }

          if (shouldBeActive) {
            const existingRule = await tx.labTestRule.findFirst({
              where: {
                lab_test_id: testId,
                testing_point: stage,
              },
            });
            if (existingRule) {
              await tx.labTestRule.update({
                where: { id: existingRule.id },
                data: {
                  min_value: minVal !== null ? minVal : existingRule.min_value,
                  max_value: maxVal !== null ? maxVal : existingRule.max_value,
                  acceptable_option: optVal !== null ? optVal : existingRule.acceptable_option,
                  warning_trigger: warningHoldVal !== undefined ? (warningHoldVal && warningHoldVal !== '—' ? warningHoldVal : null) : existingRule.warning_trigger,
                  decision_consequence: failRejectVal !== undefined ? (failRejectVal && failRejectVal !== '—' ? failRejectVal : null) : existingRule.decision_consequence,
                  rule_category: ruleCategoryVal,
                  is_active: true,
                },
              });
            } else {
              await tx.labTestRule.create({
                data: {
                  lab_test_id: testId,
                  testing_point: stage,
                  rule_category: ruleCategoryVal,
                  min_value: minVal,
                  max_value: maxVal,
                  acceptable_option: optVal,
                  warning_trigger: warningHoldVal && warningHoldVal !== '—' ? warningHoldVal : null,
                  decision_consequence: failRejectVal && failRejectVal !== '—' ? failRejectVal : null,
                  is_active: true,
                  version: 1,
                  created_by: adminUser?.id ?? BigInt(1),
                },
              });
            }
          }
        }
      }

      await writeAuditLog(tx, {
        tableName: 'lab_test',
        recordId: testId,
        action: 'LAB_TEST_UPDATED',
        oldValues: {
          testName: targetTest.testName,
          displayOrder: targetTest.displayOrder,
          isActive: targetTest.isActive,
          isPhotoRequired: targetTest.isPhotoRequired,
          resultOptions: targetTest.resultOptions,
        },
        newValues: {
          testName: updated.testName,
          displayOrder: updated.displayOrder,
          isActive: updated.isActive,
          isPhotoRequired: updated.isPhotoRequired,
          resultOptions: updated.resultOptions,
        },
        actor: { ...auditActorFromUser(authUser), userId: adminUser?.id ?? null },
      });

      return updated;
    });

    // The stage forms read the Master Test Matrix first, so the photo checkbox must be written there too.
    if (body.isPhotoRequired !== undefined) {
      const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
      if ('response' in guard) return guard.response;
      await setPhotoRequiredForTest(guard.acting, testId, Boolean(body.isPhotoRequired));
    }

    return NextResponse.json({
      success: true,
      labTest: {
        id: updatedTest.id.toString(),
        testCode: updatedTest.testCode,
        testName: updatedTest.testName,
        resultType: updatedTest.resultType,
        unit: updatedTest.unit,
        testScope: updatedTest.testScope,
        displayOrder: updatedTest.displayOrder,
        isActive: updatedTest.isActive,
        isPhotoRequired: updatedTest.isPhotoRequired,
        resultOptions: updatedTest.resultOptions || null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

