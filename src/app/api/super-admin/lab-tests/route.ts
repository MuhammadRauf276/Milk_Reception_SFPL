import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { createLabTestSchema, validatePlantQAResultOptions } from '@/lib/validations/labTest';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const tests = await prisma.labTest.findMany({
      orderBy: { displayOrder: 'asc' },
    });

    const serialized = await Promise.all(
      tests.map(async (t) => {
        const dispatchCount = await prisma.dispatchLabResult.count({ where: { test_id: t.id } });
        const plantCount = await prisma.plantLabResult.count({ where: { test_id: t.id } });
        const totalHistoricalResults = dispatchCount + plantCount;

        return {
          id: t.id.toString(),
          testCode: t.testCode,
          testName: t.testName,
          resultType: t.resultType,
          unit: t.unit,
          testScope: t.testScope,
          isRequired: t.isRequired,
          isActive: t.isActive,
          displayOrder: t.displayOrder,
          resultOptions: t.resultOptions || null,
          historicalResultsCount: totalHistoricalResults,
        };
      })
    );

    return NextResponse.json({ labTests: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
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

    const created = await prisma.labTest.create({
      data: {
        testCode: finalTestCode,
        testName: validated.testName,
        resultType: validated.resultType,
        unit: validated.unit || null,
        testScope: validated.testScope,
        isRequired: validated.isRequired,
        isActive: validated.isActive,
        displayOrder: validated.displayOrder,
        resultOptions: validated.resultOptions ? (validated.resultOptions as any) : undefined,
      },
    });

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });
    await prisma.auditLog.create({
      data: {
        table_name: 'lab_test',
        record_id: created.id,
        action: 'LAB_TEST_CREATED',
        new_values: {
          testCode: created.testCode,
          testName: created.testName,
          resultType: created.resultType,
          resultOptions: created.resultOptions,
        },
        user_id: adminUser?.id || null,
      },
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
        displayOrder: created.displayOrder,
        resultOptions: created.resultOptions || null,
        historicalResultsCount: 0,
      },
    }, { status: 201 });
  } catch (error: any) {
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to create lab test' }, { status: 500 });
  }
}

