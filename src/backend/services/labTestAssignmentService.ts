import { PrismaClient, Prisma } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AssignedLabTestDTO {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  displayOrder: number;
  resultOptions?: any[] | null;
  assignedAt?: string;
}

export function serializeAssignment(a: any): AssignedLabTestDTO {
  return {
    id: a.id.toString(),
    testId: a.test_id.toString(),
    testCode: a.test_code_snapshot,
    testName: a.test_name_snapshot,
    resultType: a.result_type_snapshot,
    unit: a.unit_snapshot,
    testScope: a.test_scope_snapshot || 'BOTH',
    isRequired: a.is_required_snapshot,
    displayOrder: a.display_order_snapshot,
    resultOptions: a.result_options_snapshot || (a.resultOptions ? a.resultOptions : null),
    assignedAt: a.assigned_at ? a.assigned_at.toISOString() : undefined,
  };
}

/**
 * Returns existing Plant QA assignments for a visit, or null if none exist.
 */
export async function getAssignedPlantQATests(
  db: DbClient,
  visitId: bigint
): Promise<any[] | null> {
  const assignments = await db.labTestAssignment.findMany({
    where: {
      visit_id: visitId,
      workflow: 'PLANT_QA',
    },
    orderBy: [
      { display_order_snapshot: 'asc' },
      { test_name_snapshot: 'asc' },
    ],
  });

  return assignments.length > 0 ? assignments : null;
}

/**
 * Returns existing Dispatch assignments for a visit, or null if none exist.
 */
export async function getAssignedDispatchTests(
  db: DbClient,
  visitId: bigint
): Promise<any[] | null> {
  const assignments = await db.labTestAssignment.findMany({
    where: {
      visit_id: visitId,
      workflow: 'DISPATCH',
    },
    orderBy: [
      { display_order_snapshot: 'asc' },
      { test_name_snapshot: 'asc' },
    ],
  });

  return assignments.length > 0 ? assignments : null;
}

/**
 * Fetches existing or creates a stable frozen snapshot of Plant QA test assignments.
 * Supports deterministic legacy bootstrap if existing results exist.
 */
export async function getOrAssignPlantQATests(
  db: DbClient,
  visitId: bigint
): Promise<any[]> {
  const existing = await getAssignedPlantQATests(db, visitId);
  if (existing) {
    return existing;
  }

  // Check for legacy in-progress results on this visit
  const existingResults = await db.plantLabResult.findMany({
    where: { visit_id: visitId },
    select: { test_id: true },
  });
  const existingTestIds = Array.from(new Set(existingResults.map((r) => r.test_id)));

  // Query active PLANT/BOTH tests from master
  const activeMasterTests = await db.labTest.findMany({
    where: {
      isActive: true,
      testScope: { in: ['PLANT', 'BOTH'] },
    },
  });

  let testsToAssign = activeMasterTests;

  if (existingTestIds.length > 0) {
    // Union: Active master tests + any tests already tested historically in this visit
    const legacyTests = await db.labTest.findMany({
      where: { id: { in: existingTestIds } },
    });

    const activeIdSet = new Set(activeMasterTests.map((t) => t.id.toString()));
    const combined = [...activeMasterTests];
    for (const lt of legacyTests) {
      if (!activeIdSet.has(lt.id.toString())) {
        combined.push(lt);
      }
    }
    testsToAssign = combined;
  }

  // Sort by display order
  testsToAssign.sort((a, b) => a.displayOrder - b.displayOrder || a.testName.localeCompare(b.testName));

  // Atomically persist snapshot
  for (const t of testsToAssign) {
    const defaultOptions = t.resultOptions || (
      t.resultType === 'OK_NOT_OK'
        ? [{ value: 'OK', label: 'OK', isPassing: true }, { value: 'NOT_OK', label: 'Not OK', isPassing: false }]
        : t.resultType === 'POSITIVE_NEGATIVE'
        ? [{ value: 'NEGATIVE', label: 'Negative', isPassing: true }, { value: 'POSITIVE', label: 'Positive', isPassing: false }]
        : null
    );

    await db.labTestAssignment.upsert({
      where: {
        visit_id_workflow_test_id: {
          visit_id: visitId,
          workflow: 'PLANT_QA',
          test_id: t.id,
        },
      },
      update: {},
      create: {
        visit_id: visitId,
        workflow: 'PLANT_QA',
        test_id: t.id,
        test_code_snapshot: t.testCode,
        test_name_snapshot: t.testName,
        result_type_snapshot: t.resultType,
        unit_snapshot: t.unit,
        test_scope_snapshot: t.testScope,
        is_required_snapshot: t.isRequired,
        display_order_snapshot: t.displayOrder,
        result_options_snapshot: (defaultOptions as any) ?? undefined,
      },
    });
  }

  const result = await getAssignedPlantQATests(db, visitId);
  return result || [];
}

/**
 * Fetches existing or creates a stable frozen snapshot of Dispatch test assignments.
 */
export async function getOrAssignDispatchTests(
  db: DbClient,
  visitId: bigint
): Promise<any[]> {
  const existing = await getAssignedDispatchTests(db, visitId);
  if (existing) {
    return existing;
  }

  // Check for legacy results
  const existingResults = await db.dispatchLabResult.findMany({
    where: { visit_id: visitId },
    select: { test_id: true },
  });
  const existingTestIds = Array.from(new Set(existingResults.map((r) => r.test_id)));

  // Query active DISPATCH/BOTH tests from master
  const activeMasterTests = await db.labTest.findMany({
    where: {
      isActive: true,
      testScope: { in: ['DISPATCH', 'BOTH'] },
    },
  });

  let testsToAssign = activeMasterTests;

  if (existingTestIds.length > 0) {
    const legacyTests = await db.labTest.findMany({
      where: { id: { in: existingTestIds } },
    });

    const activeIdSet = new Set(activeMasterTests.map((t) => t.id.toString()));
    const combined = [...activeMasterTests];
    for (const lt of legacyTests) {
      if (!activeIdSet.has(lt.id.toString())) {
        combined.push(lt);
      }
    }
    testsToAssign = combined;
  }

  // Sort by display order
  testsToAssign.sort((a, b) => a.displayOrder - b.displayOrder || a.testName.localeCompare(b.testName));

  // Atomically persist snapshot
  for (const t of testsToAssign) {
    const defaultOptions = t.resultOptions || (
      t.resultType === 'OK_NOT_OK'
        ? [{ value: 'OK', label: 'OK', isPassing: true }, { value: 'NOT_OK', label: 'Not OK', isPassing: false }]
        : t.resultType === 'POSITIVE_NEGATIVE'
        ? [{ value: 'NEGATIVE', label: 'Negative', isPassing: true }, { value: 'POSITIVE', label: 'Positive', isPassing: false }]
        : null
    );

    await db.labTestAssignment.upsert({
      where: {
        visit_id_workflow_test_id: {
          visit_id: visitId,
          workflow: 'DISPATCH',
          test_id: t.id,
        },
      },
      update: {},
      create: {
        visit_id: visitId,
        workflow: 'DISPATCH',
        test_id: t.id,
        test_code_snapshot: t.testCode,
        test_name_snapshot: t.testName,
        result_type_snapshot: t.resultType,
        unit_snapshot: t.unit,
        test_scope_snapshot: t.testScope,
        is_required_snapshot: t.isRequired,
        display_order_snapshot: t.displayOrder,
        result_options_snapshot: (defaultOptions as any) ?? undefined,
      },
    });
  }

  const result = await getAssignedDispatchTests(db, visitId);
  return result || [];
}
