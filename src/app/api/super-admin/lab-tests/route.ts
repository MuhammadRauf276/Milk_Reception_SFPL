import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { createLabTestSchema, validatePlantQAResultOptions } from '@/lib/validations/labTest';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'DATA_EXECUTIVE')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin or Data Executive authorization required.' }, { status: 403 });
  }

  try {
    const sp = new URL(req.url).searchParams;
    const paged = sp.has('page') || sp.has('pageSize');
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25));
    const q = (sp.get('q') || '').trim();
    const status = sp.get('status');
    const stage = (sp.get('stage') || sp.get('testingPoint') || '').trim();

    const where: Prisma.LabTestWhereInput = {};
    if (q) {
      where.OR = [
        { testCode: { contains: q, mode: 'insensitive' } },
        { testName: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (status === 'active') where.isActive = true;
    if (status === 'inactive') where.isActive = false;
    if (stage && stage !== 'ALL' && stage !== 'CATALOG') {
      where.policy_assignments = {
        some: {
          testing_point: stage,
          is_active: true,
        },
      };
    }

    const [totalRecords, tests, maxOrder] = await Promise.all([
      paged ? prisma.labTest.count({ where }) : Promise.resolve(0),
      prisma.labTest.findMany({
        where,
        orderBy: { displayOrder: 'asc' },
        ...(paged ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      paged ? prisma.labTest.aggregate({ _max: { displayOrder: true } }) : Promise.resolve(null),
    ]);

    // One grouped count per result table, rules, and policy assignments
    const ids = tests.map((t) => t.id);
    const [policyAssignments, labRules, dispatchCounts, plantCounts, zmccCounts] = ids.length
      ? await Promise.all([
          prisma.milkTestPolicyAssignment.findMany({
            where: { lab_test_id: { in: ids }, is_active: true },
            select: { lab_test_id: true, testing_point: true, is_required: true, is_photo_required: true, display_order: true },
            orderBy: { display_order: 'asc' },
          }),
          prisma.labTestRule.findMany({
            where: { lab_test_id: { in: ids }, is_active: true, rule_category: 'RELEASE' },
            select: { lab_test_id: true, testing_point: true, min_value: true, max_value: true, acceptable_option: true },
          }),
          prisma.dispatchLabResult.groupBy({ by: ['test_id'], where: { test_id: { in: ids } }, _count: { _all: true } }),
          prisma.plantLabResult.groupBy({ by: ['test_id'], where: { test_id: { in: ids } }, _count: { _all: true } }),
          prisma.zmccLabResult.groupBy({ by: ['test_id'], where: { test_id: { in: ids } }, _count: { _all: true } }),
        ])
      : [[], [], [], [], []];

    const stagesByTestId = new Map<string, string[]>();
    for (const pa of policyAssignments) {
      const tid = pa.lab_test_id.toString();
      const list = stagesByTestId.get(tid) || [];
      if (!list.includes(pa.testing_point)) list.push(pa.testing_point);
      stagesByTestId.set(tid, list);
    }

    const rulesByTestId = new Map<string, { min_value: number | null; max_value: number | null; acceptable_option: string | null }>();
    for (const r of labRules) {
      const tid = r.lab_test_id.toString();
      const matchStage = stage && stage !== 'ALL' && stage !== 'CATALOG' ? r.testing_point === stage : true;
      if (matchStage || !rulesByTestId.has(tid)) {
        rulesByTestId.set(tid, {
          min_value: r.min_value !== null ? Number(r.min_value) : null,
          max_value: r.max_value !== null ? Number(r.max_value) : null,
          acceptable_option: r.acceptable_option,
        });
      }
    }

    const historical = new Map<string, number>();
    for (const rows of [dispatchCounts, plantCounts, zmccCounts]) {
      for (const r of rows) {
        const key = String(r.test_id);
        historical.set(key, (historical.get(key) ?? 0) + r._count._all);
      }
    }

    const isStageFilterActive = Boolean(stage && stage !== 'ALL' && stage !== 'CATALOG');

    const serialized = tests.map((t) => {
      const rule = rulesByTestId.get(t.id.toString());
      const stages = stagesByTestId.get(t.id.toString()) ?? [];
      const stageAssignment = isStageFilterActive
        ? policyAssignments.find((pa) => pa.lab_test_id === t.id && pa.testing_point === stage)
        : null;

      return {
        id: t.id.toString(),
        testCode: t.testCode,
        testName: t.testName,
        resultType: t.resultType,
        unit: t.unit,
        testScope: t.testScope,
        assignedStages: stages,
        isRequired: stageAssignment ? stageAssignment.is_required : t.isRequired,
        isActive: t.isActive,
        isPhotoRequired: stageAssignment ? (stageAssignment.is_photo_required ?? false) : (t.isPhotoRequired ?? false),
        displayOrder: t.displayOrder,
        resultOptions: t.resultOptions || null,
        historicalResultsCount: historical.get(t.id.toString()) ?? 0,
        minValue: rule?.min_value ?? null,
        maxValue: rule?.max_value ?? null,
        acceptableOption: rule?.acceptable_option ?? null,
      };
    });

    return NextResponse.json(
      {
        labTests: serialized,
        ...(paged
          ? {
              maxDisplayOrder: maxOrder?._max.displayOrder ?? 0,
              pagination: {
                page,
                pageSize,
                totalRecords,
                totalPages: totalRecords === 0 ? 1 : Math.ceil(totalRecords / pageSize),
              },
            }
          : {}),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'DATA_EXECUTIVE')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin or Data Executive authorization required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = createLabTestSchema.parse(body);

    // Validate categorical result options
    if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(validated.resultType)) {
      if (validated.resultOptions && validated.resultOptions.length < 2) {
        return NextResponse.json({ error: 'Categorical tests must define at least 2 result options.' }, { status: 400 });
      }

      // Enforce valid Plant QA options (cannot be all-neutral for required Plant test)
      const plantValidation = validatePlantQAResultOptions(
        validated.testScope,
        validated.isRequired,
        validated.resultType,
        validated.resultOptions
      );
      if (!plantValidation.isValid) {
        return NextResponse.json({ error: plantValidation.error }, { status: 400 });
      }
    } else {
      if (validated.resultOptions && validated.resultOptions.length > 0) {
        return NextResponse.json({ error: `Result options are not permitted for ${validated.resultType} tests.` }, { status: 400 });
      }
    }

    // Concurrency-safe automatic testCode generation
    const nextSeqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lab_test_code_seq') as nextval`;
    const nextSeq = nextSeqResult[0]?.nextval ? Number(nextSeqResult[0].nextval) : 100;
    let finalTestCode = `LT-${String(nextSeq).padStart(6, '0')}`;

    let collision = await prisma.labTest.findUnique({ where: { testCode: finalTestCode } });
    while (collision) {
      const retrySeqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lab_test_code_seq') as nextval`;
      const retrySeq = retrySeqResult[0]?.nextval ? Number(retrySeqResult[0].nextval) : Date.now();
      finalTestCode = `LT-${String(retrySeq).padStart(6, '0')}`;
      collision = await prisma.labTest.findUnique({ where: { testCode: finalTestCode } });
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const created = await prisma.$transaction(async (tx) => {
      const newTest = await tx.labTest.create({
        data: {
          testCode: finalTestCode,
          testName: validated.testName,
          resultType: validated.resultType,
          unit: validated.unit || null,
          testScope: validated.testScope,
          isRequired: validated.isRequired,
          isActive: validated.isActive,
          isPhotoRequired: validated.isPhotoRequired ?? false,
          displayOrder: validated.displayOrder,
          resultOptions: validated.resultOptions ? (validated.resultOptions as Prisma.InputJsonValue) : undefined,
        },
      });

      // Automatically initialize stage policy assignments for selected stages
      const stagesToSeed: string[] = Array.isArray(body.assignedStages) && body.assignedStages.length > 0
        ? body.assignedStages
        : validated.testScope === 'ALL'
        ? ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA']
        : validated.testScope === 'MOT_SHOP' || validated.testScope === 'MOT'
        ? ['MOT_SHOP']
        : validated.testScope === 'ZMCC'
        ? ['ZMCC_LAB_MC', 'ZMCC_LAB_HC']
        : validated.testScope === 'DISPATCH'
        ? ['DISPATCH']
        : validated.testScope === 'PLANT'
        ? ['PLANT_QA']
        : ['DISPATCH', 'PLANT_QA'];

      const minVal = body.minValue !== undefined && body.minValue !== '' && body.minValue !== null ? Number(body.minValue) : null;
      const maxVal = body.maxValue !== undefined && body.maxValue !== '' && body.maxValue !== null ? Number(body.maxValue) : null;
      const optVal = typeof body.acceptableOption === 'string' && body.acceptableOption.trim() ? body.acceptableOption.trim() : null;

      for (const stage of stagesToSeed) {
        const maxOrder = await tx.milkTestPolicyAssignment.aggregate({
          where: { testing_point: stage },
          _max: { display_order: true },
        });
        const nextOrder = (maxOrder._max.display_order ?? 0) + 1;
        await tx.milkTestPolicyAssignment.create({
          data: {
            lab_test_id: newTest.id,
            testing_point: stage,
            is_active: true,
            is_required: validated.isRequired,
            is_photo_required: validated.isPhotoRequired ?? false,
            display_order: nextOrder,
            created_by_user_id: adminUser?.id ?? BigInt(1),
            updated_by_user_id: adminUser?.id ?? BigInt(1),
          },
        });

        // Initialize default RELEASE rule so operational sessions never fail with missing rule
        await tx.labTestRule.create({
          data: {
            lab_test_id: newTest.id,
            testing_point: stage,
            rule_category: 'RELEASE',
            min_value: minVal,
            max_value: maxVal,
            acceptable_option: optVal,
            is_active: true,
            version: 1,
            created_by: adminUser?.id ?? BigInt(1),
          },
        });
      }

      await writeAuditLog(tx, {
        tableName: 'lab_test',
        recordId: newTest.id,
        action: 'LAB_TEST_CREATED',
        newValues: {
          testCode: newTest.testCode,
          testName: newTest.testName,
          resultType: newTest.resultType,
          isPhotoRequired: newTest.isPhotoRequired,
          resultOptions: newTest.resultOptions as Prisma.InputJsonValue,
        },
        actor: { ...auditActorFromUser(authUser), userId: adminUser?.id ?? null },
      });

      return newTest;
    });

    return NextResponse.json({
      success: true,
      labTest: {
        id: created.id.toString(),
        testCode: created.testCode,
        testName: created.testName,
        resultType: created.resultType,
        unit: created.unit,
        testScope: created.testScope,
        isRequired: created.isRequired,
        isActive: created.isActive,
        isPhotoRequired: created.isPhotoRequired,
        displayOrder: created.displayOrder,
        resultOptions: created.resultOptions || null,
        historicalResultsCount: 0,
      },
    }, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null) {
      const errRecord = error as { name?: string; issues?: Array<{ message: string }>; errors?: Array<{ message: string }>; message?: string };
      if (errRecord.name === 'ZodError' || errRecord.issues) {
        const msg = errRecord.issues?.[0]?.message || errRecord.errors?.[0]?.message || errRecord.message || 'Validation failed';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      return NextResponse.json({ error: errRecord.message || 'Failed to create lab test' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to create lab test' }, { status: 500 });
  }
}

