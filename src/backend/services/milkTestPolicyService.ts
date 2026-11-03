import { prisma } from '@core/db';
import { auditActorFromUser, writeAuditLog } from '@/backend/core/audit';
import { Prisma } from '@prisma/client';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { getEffectivePolicy as getMatrixPolicy, selectStageCells, keepFormulaTests, type PolicyDb, type StageAssignmentLike } from '@/backend/services/testPointPolicyService';

export class ValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export {
  CANONICAL_TESTING_POINTS,
  MPD_TESTING_POINTS,
  isValidTestingPoint,
} from '@/types/milk-test-policy';
export type {
  TestingPoint,
  ActorUser,
  CreatePolicyAssignmentInput,
  UpdatePolicyAssignmentInput,
  SerializedPolicyAssignment,
  EffectivePolicyTest,
} from '@/types/milk-test-policy';
import {
  CANONICAL_TESTING_POINTS,
  isValidTestingPoint,
  TestingPoint,
  ActorUser,
  CreatePolicyAssignmentInput,
  UpdatePolicyAssignmentInput,
  SerializedPolicyAssignment,
  EffectivePolicyTest,
} from '@/types/milk-test-policy';

export function assertCanMutateTestingPoint(userRole: string | undefined | null, _testingPoint: TestingPoint): void {
  if (!userRole) {
    throw new ForbiddenError('Unauthorized. Missing user role.');
  }

  const normalized = userRole.trim();

  if (normalized === 'SUPER_ADMIN' || normalized === 'DATA_EXECUTIVE') {
    return;
  }

  // Configuration is strictly centralized to Super Admin & Data Executive
  throw new ForbiddenError(
    `Role "${normalized}" is not authorized to modify stage test policies. Only Super Admin and Data Executive can configure test policies and rules.`
  );
}

export function assertCanReadAdminPolicies(userRole: string | undefined | null): void {
  if (!userRole) {
    throw new ForbiddenError('Unauthorized. Missing user role.');
  }
  const normalized = userRole.trim();
  if (
    normalized === 'SUPER_ADMIN' ||
    normalized === 'DATA_EXECUTIVE' ||
    normalized === 'DATA_ANALYST' ||
    normalized === 'HEAD_OF_MPD' ||
    normalized === 'QA_HEAD'
  ) {
    return;
  }
  throw new ForbiddenError(`Role "${normalized}" is not authorized to access policy administrative view.`);
}

const ROLE_EFFECTIVE_POINTS: Record<string, readonly TestingPoint[]> = {
  SUPER_ADMIN: ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA'],
  DATA_EXECUTIVE: ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA'],
  DATA_ANALYST: ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA'],
  HEAD_OF_MPD: ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH'],
  ZMCC_MANAGER: ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH'],
  MOT: ['MOT_SHOP'],
  ZMCC_LAB_ATTENDANT: ['ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH'],
  CONTRACTOR_OPERATOR: ['DISPATCH'],
  CONTRACTOR_MANAGER: ['DISPATCH'],
  QA_HEAD: ['PLANT_QA'],
  QA_LAB_ATTENDANT: ['PLANT_QA'],
};

export function assertCanReadEffectivePolicy(userRole: string | undefined | null, testingPoint: TestingPoint): void {
  if (!userRole) {
    throw new ForbiddenError('Unauthorized. Missing user role.');
  }
  const normalized = userRole.trim();
  const allowed = ROLE_EFFECTIVE_POINTS[normalized];
  if (allowed && allowed.includes(testingPoint)) {
    return;
  }
  throw new ForbiddenError(`Role "${normalized}" is not authorized to read effective policy for "${testingPoint}".`);
}

export function parseAndValidateDisplayOrder(val: unknown, fallback?: number): number {
  if (val === undefined || val === null) {
    if (fallback !== undefined) return fallback;
    return 0;
  }
  const num = typeof val === 'number' ? val : (typeof val === 'string' && val.trim() !== '' ? Number(val) : NaN);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new ValidationError('displayOrder must be a finite integer.');
  }
  return num;
}

async function assertRequiredAssignmentHasReleaseRule(
  tx: Prisma.TransactionClient,
  labTestId: bigint,
  testingPoint: TestingPoint
): Promise<void> {
  const rules = await QualityRuleService.resolveActiveRulesForTestingPoint(testingPoint, new Date(), tx);
  const rule = rules.get(labTestId.toString());
  if (!rule || rule.isConfigurationError || (rule.rule_category !== 'RELEASE' && rule.rule_category !== 'MONITORING')) {
    throw new ValidationError(
      `Required test activation requires a valid active rule (Must Pass or Warning Only) for this test at ${testingPoint}.`
    );
  }
}


export interface ResolvedActor {
  id: bigint;
  username: string;
  role: string;
  is_active: boolean;
}

export async function resolveAndAuthorizeActor(
  actor: ActorUser | null | undefined,
  testingPoint: TestingPoint,
  tx?: Prisma.TransactionClient
): Promise<ResolvedActor> {
  if (!actor || actor.id === undefined || actor.id === null) {
    throw new ForbiddenError('Unauthorized. Actor user ID is missing.');
  }

  let actorIdBig: bigint;
  try {
    const strId = String(actor.id).trim();
    if (!strId || !/^-?\d+$/.test(strId)) {
      throw new Error();
    }
    actorIdBig = BigInt(strId);
  } catch {
    throw new ForbiddenError('Unauthorized. Invalid actor user ID.');
  }

  const db = tx || prisma;
  const liveUser = await db.user.findUnique({
    where: { id: actorIdBig },
    select: { id: true, username: true, role: true, is_active: true },
  });

  if (!liveUser) {
    throw new ForbiddenError('Unauthorized. Actor user does not exist.');
  }

  if (!liveUser.is_active) {
    throw new ForbiddenError('Unauthorized. Actor user is inactive.');
  }

  // Authorize using live database role, NOT caller-supplied role!
  assertCanMutateTestingPoint(liveUser.role, testingPoint);

  return liveUser;
}


interface AssignmentDbRow {
  id: bigint;
  lab_test_id: bigint;
  testing_point: string;
  is_required: boolean;
  is_photo_required?: boolean | null;
  display_order: number;
  is_active: boolean;
  created_by_user_id: bigint;
  updated_by_user_id: bigint | null;
  created_at: Date;
  updated_at: Date;
  lab_test?: {
    id: bigint;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    testScope: string;
    isRequired: boolean;
    isPhotoRequired?: boolean | null;
    isActive: boolean;
    displayOrder: number;
    resultOptions?: unknown;
  } | null;
  creator?: {
    id: bigint;
    username: string;
    full_name: string | null;
  } | null;
  updater?: {
    id: bigint;
    username: string;
    full_name: string | null;
  } | null;
}

function serializeAssignment(row: AssignmentDbRow): SerializedPolicyAssignment {
  return {
    id: row.id.toString(),
    labTestId: row.lab_test_id.toString(),
    testingPoint: row.testing_point as TestingPoint,
    isRequired: row.is_required,
    isPhotoRequired: row.is_photo_required ?? row.lab_test?.isPhotoRequired ?? false,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdByUserId: row.created_by_user_id.toString(),
    updatedByUserId: row.updated_by_user_id ? row.updated_by_user_id.toString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    labTest: row.lab_test
      ? {
          id: row.lab_test.id.toString(),
          testCode: row.lab_test.testCode,
          testName: row.lab_test.testName,
          resultType: row.lab_test.resultType,
          unit: row.lab_test.unit,
          testScope: row.lab_test.testScope,
          isRequired: row.lab_test.isRequired,
          isPhotoRequired: row.lab_test.isPhotoRequired ?? false,
          isActive: row.lab_test.isActive,
          displayOrder: row.lab_test.displayOrder,
          resultOptions: row.lab_test.resultOptions,
        }
      : undefined,
    creator: row.creator
      ? {
          id: row.creator.id.toString(),
          username: row.creator.username,
          fullName: row.creator.full_name,
        }
      : undefined,
    updater: row.updater
      ? {
          id: row.updater.id.toString(),
          username: row.updater.username,
          fullName: row.updater.full_name,
        }
      : null,
  };
}

export class MilkTestPolicyService {
  /**
   * Retrieves effective active test policies for a given testing point.
   * Returns active policy assignments where the referenced LabTest is also active.
   * Deterministically ordered by policy display_order ASC, then lab_test display_order ASC, then lab_test.id ASC.
   */
  static async getEffectivePolicy(testingPointRaw: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<EffectivePolicyTest[]> {
    if (!isValidTestingPoint(testingPointRaw)) {
      throw new ValidationError(`Invalid testing point "${testingPointRaw}". Allowed values: ${CANONICAL_TESTING_POINTS.join(', ')}`);
    }
    const testingPoint = testingPointRaw as TestingPoint;

    // Plant QA follows the Super Admin matrix (TestPointPolicy) so the plant form shows exactly what was allowed.
    if (testingPoint === 'PLANT_QA') {
      const plantTests = await MilkTestPolicyService.resolvePlantPolicy(db);
      if (plantTests) return plantTests;
    }

    const assignments = await db.milkTestPolicyAssignment.findMany({
      where: {
        testing_point: testingPoint,
        is_active: true,
        lab_test: {
          isActive: true,
        },
      },
      include: {
        lab_test: true,
      },
      orderBy: [
        { display_order: 'asc' },
        { lab_test: { displayOrder: 'asc' } },
        { lab_test_id: 'asc' },
      ],
    });

    if (assignments.length > 0) {
      return assignments.map((a) => ({
        id: a.lab_test.id.toString(),
        policyAssignmentId: a.id.toString(),
        testCode: a.lab_test.testCode,
        testName: a.lab_test.testName,
        resultType: a.lab_test.resultType,
        unit: a.lab_test.unit,
        resultOptions: a.lab_test.resultOptions,
        isRequired: a.is_required,
        isPhotoRequired: a.is_photo_required ?? a.lab_test.isPhotoRequired ?? false,
        displayOrder: a.display_order,
        isActive: a.is_active,
        testingPoint: a.testing_point as TestingPoint,
      }));
    }

    // Fallback when Super Admin has not configured explicit assignments for this stage yet:
    // Match active master tests based on their testScope so user screens don't render empty.
    let scopeIn: string[] = ['ALL'];
    if (testingPoint === 'PLANT_QA') scopeIn = ['PLANT', 'BOTH', 'ALL'];
    else if (testingPoint === 'DISPATCH') scopeIn = ['DISPATCH', 'BOTH', 'ALL'];
    else if (testingPoint === 'MOT_SHOP') scopeIn = ['MOT_SHOP', 'MOT', 'ALL'];
    else if (['ZMCC_LAB_MC', 'ZMCC_LAB_HC'].includes(testingPoint)) {
      scopeIn = ['ZMCC', 'ALL'];
    }

    const fallbackTests = await db.labTest.findMany({
      where: {
        isActive: true,
        OR: [
          { testScope: { in: scopeIn } },
          ...(['ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'MOT_SHOP'].includes(testingPoint)
            ? [{ systemRole: { in: ['LR', 'FAT'] } }, { testCode: { in: ['LT-000008', 'LT-000026', 'LT-000027'] } }]
            : []),
        ],
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });

    return fallbackTests.map((t) => ({
      id: t.id.toString(),
      policyAssignmentId: `fallback-${t.id}`,
      testCode: t.testCode,
      testName: t.testName,
      resultType: t.resultType,
      unit: t.unit,
      resultOptions: t.resultOptions,
      isRequired: t.isRequired,
      isPhotoRequired: t.isPhotoRequired ?? false,
      displayOrder: t.displayOrder,
      isActive: true,
      testingPoint,
    }));
  }

  /**
   * Plant QA tests from the Super Admin matrix (the single source of truth), with active stage assignments
   * as the fallback for tests that have no saved matrix row. See selectStageCells for the exact rule.
   * Returns null only when Plant QA was never configured at all, so the older scope fallback still applies.
   */
  private static async resolvePlantPolicy(
    db: Prisma.TransactionClient | typeof prisma
  ): Promise<EffectivePolicyTest[] | null> {
    const matrix = await getMatrixPolicy('PLANT_QA', new Date(), db as unknown as PolicyDb);
    const assignments = await db.milkTestPolicyAssignment.findMany({ where: { testing_point: 'PLANT_QA' } });
    const configured = matrix.cells.some((c) => c.source === 'DB') || assignments.length > 0;
    if (!configured) return null;

    const activeByTest = new Map<string, StageAssignmentLike>(
      assignments.filter((a) => a.is_active).map((a): [string, StageAssignmentLike] => [a.lab_test_id.toString(), a])
    );
    const assignmentIdByTest = new Map<string, string>(assignments.map((a): [string, string] => [a.lab_test_id.toString(), a.id.toString()]));
    const selected = keepFormulaTests(selectStageCells(matrix.cells, activeByTest), matrix.cells);
    if (selected.length === 0) return [];

    const labTests = await db.labTest.findMany({
      where: { id: { in: selected.map((s) => BigInt(s.cell.labTestId)) }, isActive: true },
    });
    const byId = new Map<string, (typeof labTests)[number]>(labTests.map((t): [string, typeof t] => [t.id.toString(), t]));

    const entries: Array<{ test: EffectivePolicyTest; labOrder: number }> = [];
    for (const s of selected) {
      const t = byId.get(s.cell.labTestId);
      if (!t) continue;
      entries.push({
        labOrder: t.displayOrder ?? 999,
        test: {
          id: t.id.toString(),
          policyAssignmentId: assignmentIdByTest.get(s.cell.labTestId) ?? `matrix-${s.cell.labTestId}`,
          testCode: t.testCode,
          testName: t.testName,
          resultType: t.resultType,
          unit: t.unit,
          resultOptions: t.resultOptions,
          isRequired: s.isRequired,
          isPhotoRequired: s.isPhotoRequired,
          displayOrder: s.displayOrder,
          isActive: true,
          testingPoint: 'PLANT_QA',
        },
      });
    }
    entries.sort(
      (a, b) => a.test.displayOrder - b.test.displayOrder || a.labOrder - b.labOrder || (BigInt(a.test.id) < BigInt(b.test.id) ? -1 : 1)
    );
    return entries.map((e) => e.test);
  }

  /**
   * Retrieves all policy assignments with optional filtering by testingPoint and isActive.
   */
  static async getAllPolicies(filters?: {
    testingPoint?: string;
    isActive?: boolean;
  }): Promise<SerializedPolicyAssignment[]> {
    const whereClause: Prisma.MilkTestPolicyAssignmentWhereInput = {};

    if (filters?.testingPoint) {
      if (!isValidTestingPoint(filters.testingPoint)) {
        throw new ValidationError(`Invalid testing point "${filters.testingPoint}". Allowed values: ${CANONICAL_TESTING_POINTS.join(', ')}`);
      }
      whereClause.testing_point = filters.testingPoint;
    }

    if (filters?.isActive !== undefined) {
      whereClause.is_active = filters.isActive;
    }

    const assignments = await prisma.milkTestPolicyAssignment.findMany({
      where: whereClause,
      include: {
        lab_test: true,
        creator: {
          select: { id: true, username: true, full_name: true },
        },
        updater: {
          select: { id: true, username: true, full_name: true },
        },
      },
      orderBy: [
        { testing_point: 'asc' },
        { display_order: 'asc' },
        { id: 'asc' },
      ],
    });

    return assignments.map(serializeAssignment);
  }

  /**
   * Creates a new policy assignment for a lab test at a testing point.
   */
  static async createPolicyAssignment(
    actor: ActorUser,
    input: CreatePolicyAssignmentInput
  ): Promise<SerializedPolicyAssignment> {
    if (!isValidTestingPoint(input.testingPoint)) {
      throw new ValidationError(
        `Invalid testing point "${input.testingPoint}". Allowed values: ${CANONICAL_TESTING_POINTS.join(', ')}`
      );
    }
    const testingPoint = input.testingPoint as TestingPoint;

    // Validate displayOrder early
    let displayOrder: number | undefined;
    if (input.displayOrder !== undefined && input.displayOrder !== null) {
      displayOrder = parseAndValidateDisplayOrder(input.displayOrder);
    }

    let labTestIdBig: bigint;
    try {
      const strLabTestId = String(input.labTestId).trim();
      if (!strLabTestId || !/^-?\d+$/.test(strLabTestId)) {
        throw new Error();
      }
      labTestIdBig = BigInt(strLabTestId);
    } catch {
      throw new ValidationError('Invalid labTestId format.');
    }

    const labTest = await prisma.labTest.findUnique({
      where: { id: labTestIdBig },
    });
    if (!labTest) {
      throw new NotFoundError(`Lab test with ID ${labTestIdBig.toString()} not found.`);
    }

    if (!labTest.isActive) {
      throw new ValidationError(`Cannot assign inactive lab test "${labTest.testName}" (${labTest.testCode}) to a policy.`);
    }

    const isRequired = input.isRequired !== undefined ? Boolean(input.isRequired) : true;
    const finalDisplayOrder = displayOrder !== undefined ? displayOrder : (labTest.displayOrder ?? 0);

    const existing = await prisma.milkTestPolicyAssignment.findUnique({
      where: {
        lab_test_id_testing_point: {
          lab_test_id: labTestIdBig,
          testing_point: testingPoint,
        },
      },
    });

    if (existing) {
      throw new ConflictError(
        `Policy assignment for test "${labTest.testName}" at testing point "${testingPoint}" already exists (ID: ${existing.id.toString()}, Active: ${existing.is_active}). Use PATCH to update its status.`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-resolve and authorize actor with live DB state inside transaction
      const resolvedActor = await resolveAndAuthorizeActor(actor, testingPoint, tx);
      if (isRequired) await assertRequiredAssignmentHasReleaseRule(tx, labTestIdBig, testingPoint);

      const created = await tx.milkTestPolicyAssignment.create({
        data: {
          lab_test_id: labTestIdBig,
          testing_point: testingPoint,
          is_required: isRequired,
          is_photo_required: input.isPhotoRequired !== undefined ? Boolean(input.isPhotoRequired) : (labTest.isPhotoRequired ?? false),
          display_order: finalDisplayOrder,
          is_active: true,
          created_by_user_id: resolvedActor.id,
        },
        include: {
          lab_test: true,
          creator: { select: { id: true, username: true, full_name: true } },
          updater: { select: { id: true, username: true, full_name: true } },
        },
      });

      await writeAuditLog(tx, {
        tableName: 'milk_test_policy_assignment',
        recordId: created.id,
        action: 'MILK_TEST_POLICY_CREATED',
        actor: auditActorFromUser(resolvedActor),
        newValues: {
          id: created.id.toString(),
          lab_test_id: created.lab_test_id.toString(),
          test_code: created.lab_test.testCode,
          test_name: created.lab_test.testName,
          testing_point: created.testing_point,
          is_required: created.is_required,
          is_photo_required: created.is_photo_required,
          display_order: created.display_order,
          is_active: created.is_active,
        },
      });

      return created;
    });

    return serializeAssignment(result);
  }

  /**
   * Updates an existing policy assignment (is_required, display_order, is_active).
   * Soft-deactivation is achieved by setting is_active = false.
   */
  static async updatePolicyAssignment(
    actor: ActorUser,
    idRaw: string | bigint | number,
    input: UpdatePolicyAssignmentInput
  ): Promise<SerializedPolicyAssignment> {
    let idBig: bigint;
    try {
      const strId = String(idRaw).trim();
      if (!strId || !/^-?\d+$/.test(strId)) {
        throw new Error();
      }
      idBig = BigInt(strId);
    } catch {
      throw new ValidationError('Invalid policy assignment ID format.');
    }

    // Validate displayOrder if provided
    let newDisplayOrder: number | undefined;
    if (input.displayOrder !== undefined && input.displayOrder !== null) {
      newDisplayOrder = parseAndValidateDisplayOrder(input.displayOrder);
    }

    const existing = await prisma.milkTestPolicyAssignment.findUnique({
      where: { id: idBig },
      include: {
        lab_test: true,
      },
    });

    if (!existing) {
      throw new NotFoundError(`Milk test policy assignment with ID ${idBig.toString()} not found.`);
    }

    const testingPoint = existing.testing_point as TestingPoint;

    const dataToUpdate: Prisma.MilkTestPolicyAssignmentUpdateInput = {};
    let hasChanges = false;

    if (input.isRequired !== undefined && input.isRequired !== existing.is_required) {
      dataToUpdate.is_required = Boolean(input.isRequired);
      hasChanges = true;
    }

    if (input.isPhotoRequired !== undefined && input.isPhotoRequired !== existing.is_photo_required) {
      dataToUpdate.is_photo_required = Boolean(input.isPhotoRequired);
      hasChanges = true;
    }

    if (newDisplayOrder !== undefined && newDisplayOrder !== existing.display_order) {
      dataToUpdate.display_order = newDisplayOrder;
      hasChanges = true;
    }

    let isDeactivation = false;
    let isReactivation = false;

    if (input.isActive !== undefined && input.isActive !== existing.is_active) {
      dataToUpdate.is_active = Boolean(input.isActive);
      hasChanges = true;
      if (!input.isActive) {
        isDeactivation = true;
      } else {
        isReactivation = true;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const resolvedActor = await resolveAndAuthorizeActor(actor, testingPoint, tx);

      const resultingRequired = input.isRequired !== undefined ? Boolean(input.isRequired) : existing.is_required;
      const resultingActive = input.isActive !== undefined ? Boolean(input.isActive) : existing.is_active;
      if (resultingRequired && resultingActive) {
        await assertRequiredAssignmentHasReleaseRule(tx, existing.lab_test_id, testingPoint);
      }

      if (!hasChanges) {
        const full = await tx.milkTestPolicyAssignment.findUnique({
          where: { id: idBig },
          include: {
            lab_test: true,
            creator: { select: { id: true, username: true, full_name: true } },
            updater: { select: { id: true, username: true, full_name: true } },
          },
        });
        return full!;
      }

      dataToUpdate.updater = { connect: { id: resolvedActor.id } };

      const auditAction = isDeactivation
        ? 'MILK_TEST_POLICY_DEACTIVATED'
        : isReactivation
        ? 'MILK_TEST_POLICY_ACTIVATED'
        : 'MILK_TEST_POLICY_UPDATED';

      const updated = await tx.milkTestPolicyAssignment.update({
        where: { id: idBig },
        data: dataToUpdate,
        include: {
          lab_test: true,
          creator: { select: { id: true, username: true, full_name: true } },
          updater: { select: { id: true, username: true, full_name: true } },
        },
      });

      await writeAuditLog(tx, {
        tableName: 'milk_test_policy_assignment',
        recordId: updated.id,
        action: auditAction,
        actor: auditActorFromUser(resolvedActor),
        oldValues: {
          id: existing.id.toString(),
          lab_test_id: existing.lab_test_id.toString(),
          testing_point: existing.testing_point,
          is_required: existing.is_required,
          display_order: existing.display_order,
          is_active: existing.is_active,
        },
        newValues: {
          id: updated.id.toString(),
          lab_test_id: updated.lab_test_id.toString(),
          testing_point: updated.testing_point,
          is_required: updated.is_required,
          display_order: updated.display_order,
          is_active: updated.is_active,
        },
      });

      return updated;
    });

    return serializeAssignment(result);
  }
}
