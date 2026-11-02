import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { LabTestResultOption, resultOptionsArraySchema, validatePlantQAResultOptions } from '@/lib/validations/labTest';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

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

    // RESULT_TYPE IMMUTABILITY PROTECTION ENFORCEMENT
    // Switching between NUMERIC and CALCULATED is always safe because both represent numbers/floating-point evaluations.
    if (body.resultType && body.resultType !== targetTest.resultType) {
      const isNumericPair = (body.resultType === 'NUMERIC' && targetTest.resultType === 'CALCULATED') ||
                            (body.resultType === 'CALCULATED' && targetTest.resultType === 'NUMERIC');
      if (!isNumericPair) {
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
          resultType: body.resultType !== undefined ? body.resultType : targetTest.resultType,
          unit: body.unit !== undefined ? (body.unit ? body.unit.trim() : null) : targetTest.unit,
          testScope: body.testScope !== undefined ? body.testScope : targetTest.testScope,
          displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : targetTest.displayOrder,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : targetTest.isActive,
          isPhotoRequired: body.isPhotoRequired !== undefined ? Boolean(body.isPhotoRequired) : targetTest.isPhotoRequired,
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

        // 3. Synchronize modern 6-stage test_point_policies
        const ALL_MATRIX_POINTS = ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH', 'PLANT_QA'];
        for (const pt of ALL_MATRIX_POINTS) {
          const isAssigned = body.assignedStages.includes(pt) || (pt === 'ZMCC_DISPATCH' && body.assignedStages.includes('DISPATCH')) || (pt === 'CONTRACTOR_DISPATCH' && body.assignedStages.includes('DISPATCH'));
          const mode = effectiveType === 'CALCULATED'
            ? 'AUTO'
            : isAssigned
            ? (effectiveRequired ? 'COMPULSORY' : 'APPLIED')
            : 'NOT_APPLIED';

          const existingPolicy = await tx.testPointPolicy.findFirst({
            where: { lab_test_id: testId, testing_point: pt, is_active: true },
          });

          if (existingPolicy) {
            await tx.testPointPolicy.update({
              where: { id: existingPolicy.id },
              data: {
                test_mode: mode,
                photo_mode: body.isPhotoRequired !== undefined ? (body.isPhotoRequired ? 'REQUIRED' : 'NONE') : existingPolicy.photo_mode,
                changed_by: adminUser?.id ?? BigInt(1),
                change_reason: `Super Admin updated test policies for ${targetTest.testCode}`,
              },
            });
          } else {
            await tx.testPointPolicy.create({
              data: {
                lab_test_id: testId,
                testing_point: pt,
                test_mode: mode,
                rule_mode: 'APPLY',
                photo_mode: body.isPhotoRequired ? 'REQUIRED' : 'NONE',
                version: 1,
                is_active: true,
                changed_by: adminUser?.id ?? BigInt(1),
                change_reason: `Initial policy creation on edit for ${targetTest.testCode}`,
              },
            });
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

