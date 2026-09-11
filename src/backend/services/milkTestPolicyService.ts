import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';

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

export const CANONICAL_TESTING_POINTS = [
  'MOT_SHOP',
  'ZMCC_LAB_MOT',
  'ZMCC_LAB_CONTRACTOR',
  'DISPATCH',
  'PLANT_QA',
] as const;

export type TestingPoint = (typeof CANONICAL_TESTING_POINTS)[number];

export const MPD_TESTING_POINTS: readonly TestingPoint[] = [
  'MOT_SHOP',
  'ZMCC_LAB_MOT',
  'ZMCC_LAB_CONTRACTOR',
  'DISPATCH',
];

export function isValidTestingPoint(point: unknown): point is TestingPoint {
  return typeof point === 'string' && (CANONICAL_TESTING_POINTS as readonly string[]).includes(point as TestingPoint);
}

export function assertCanMutateTestingPoint(userRole: string | undefined | null, testingPoint: TestingPoint): void {
  if (!userRole) {
    throw new ForbiddenError('Unauthorized. Missing user role.');
  }

  const normalized = userRole.trim();

  if (normalized === 'SUPER_ADMIN' || normalized === 'Admin') {
    return;
  }

  if (normalized === 'HEAD_OF_MPD') {
    if (testingPoint === 'PLANT_QA') {
      throw new ForbiddenError('Head of MPD is strictly forbidden from managing Plant QA test policy.');
    }
    if ((MPD_TESTING_POINTS as readonly string[]).includes(testingPoint)) {
      return;
    }
    throw new ForbiddenError(`Head of MPD is not authorized to manage testing point "${testingPoint}".`);
  }

  // All other operational, source-bound, legacy, or unauthorized roles
  // (ZMCC_MANAGER, MPD_Zone_Manager, ZMCC_LAB_ATTENDANT, MOT, PHE_OPERATOR, QA_Operator, CONTRACTOR_MANAGER, etc.)
  throw new ForbiddenError(`Role "${normalized}" is not authorized to modify milk test policy.`);
}

export interface ActorUser {
  id: string | bigint | number;
  username: string;
  role: string;
}

export interface CreatePolicyAssignmentInput {
  labTestId: string | bigint | number;
  testingPoint: string;
  isRequired?: boolean;
  displayOrder?: number;
}

export interface UpdatePolicyAssignmentInput {
  isRequired?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

export interface SerializedPolicyAssignment {
  id: string;
  labTestId: string;
  testingPoint: TestingPoint;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  labTest?: {
    id: string;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    testScope: string;
    isRequired: boolean;
    isActive: boolean;
    displayOrder: number;
    resultOptions: any;
  };
  creator?: {
    id: string;
    username: string;
    fullName: string | null;
  };
  updater?: {
    id: string;
    username: string;
    fullName: string | null;
  } | null;
}

export interface EffectivePolicyTest {
  id: string;
  policyAssignmentId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  resultOptions: any;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  testingPoint: TestingPoint;
}

function serializeAssignment(row: any): SerializedPolicyAssignment {
  return {
    id: row.id.toString(),
    labTestId: row.lab_test_id.toString(),
    testingPoint: row.testing_point as TestingPoint,
    isRequired: row.is_required,
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
  static async getEffectivePolicy(testingPointRaw: string): Promise<EffectivePolicyTest[]> {
    if (!isValidTestingPoint(testingPointRaw)) {
      throw new ValidationError(`Invalid testing point "${testingPointRaw}". Allowed values: ${CANONICAL_TESTING_POINTS.join(', ')}`);
    }
    const testingPoint = testingPointRaw as TestingPoint;

    const assignments = await prisma.milkTestPolicyAssignment.findMany({
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

    return assignments.map((a) => ({
      id: a.lab_test.id.toString(),
      policyAssignmentId: a.id.toString(),
      testCode: a.lab_test.testCode,
      testName: a.lab_test.testName,
      resultType: a.lab_test.resultType,
      unit: a.lab_test.unit,
      resultOptions: a.lab_test.resultOptions,
      isRequired: a.is_required,
      displayOrder: a.display_order,
      isActive: a.is_active,
      testingPoint: a.testing_point as TestingPoint,
    }));
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

    assertCanMutateTestingPoint(actor.role, testingPoint);

    let labTestIdBig: bigint;
    try {
      labTestIdBig = BigInt(String(input.labTestId).trim());
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
    const displayOrder = input.displayOrder !== undefined ? Math.floor(Number(input.displayOrder)) || 0 : (labTest.displayOrder ?? 0);

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

    let actorIdBig: bigint | null = null;
    try {
      actorIdBig = BigInt(String(actor.id).trim());
    } catch {
      actorIdBig = null;
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.milkTestPolicyAssignment.create({
        data: {
          lab_test_id: labTestIdBig,
          testing_point: testingPoint,
          is_required: isRequired,
          display_order: displayOrder,
          is_active: true,
          created_by_user_id: actorIdBig || BigInt(1),
        },
        include: {
          lab_test: true,
          creator: { select: { id: true, username: true, full_name: true } },
          updater: { select: { id: true, username: true, full_name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'milk_test_policy_assignment',
          record_id: created.id,
          action: 'MILK_TEST_POLICY_CREATED',
          user_id: actorIdBig,
          new_values: {
            id: created.id.toString(),
            lab_test_id: created.lab_test_id.toString(),
            test_code: created.lab_test.testCode,
            test_name: created.lab_test.testName,
            testing_point: created.testing_point,
            is_required: created.is_required,
            display_order: created.display_order,
            is_active: created.is_active,
          },
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
      idBig = BigInt(String(idRaw).trim());
    } catch {
      throw new ValidationError('Invalid policy assignment ID format.');
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
    assertCanMutateTestingPoint(actor.role, testingPoint);

    const dataToUpdate: Prisma.MilkTestPolicyAssignmentUpdateInput = {};
    let hasChanges = false;

    if (input.isRequired !== undefined && input.isRequired !== existing.is_required) {
      dataToUpdate.is_required = Boolean(input.isRequired);
      hasChanges = true;
    }

    if (input.displayOrder !== undefined && input.displayOrder !== existing.display_order) {
      dataToUpdate.display_order = Math.floor(Number(input.displayOrder)) || 0;
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

    if (!hasChanges) {
      const full = await prisma.milkTestPolicyAssignment.findUnique({
        where: { id: idBig },
        include: {
          lab_test: true,
          creator: { select: { id: true, username: true, full_name: true } },
          updater: { select: { id: true, username: true, full_name: true } },
        },
      });
      return serializeAssignment(full);
    }

    let actorIdBig: bigint | null = null;
    try {
      actorIdBig = BigInt(String(actor.id).trim());
    } catch {
      actorIdBig = null;
    }

    if (actorIdBig) {
      dataToUpdate.updater = { connect: { id: actorIdBig } };
    }

    const auditAction = isDeactivation
      ? 'MILK_TEST_POLICY_DEACTIVATED'
      : isReactivation
      ? 'MILK_TEST_POLICY_ACTIVATED'
      : 'MILK_TEST_POLICY_UPDATED';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.milkTestPolicyAssignment.update({
        where: { id: idBig },
        data: dataToUpdate,
        include: {
          lab_test: true,
          creator: { select: { id: true, username: true, full_name: true } },
          updater: { select: { id: true, username: true, full_name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'milk_test_policy_assignment',
          record_id: updated.id,
          action: auditAction,
          user_id: actorIdBig,
          old_values: {
            id: existing.id.toString(),
            lab_test_id: existing.lab_test_id.toString(),
            testing_point: existing.testing_point,
            is_required: existing.is_required,
            display_order: existing.display_order,
            is_active: existing.is_active,
          },
          new_values: {
            id: updated.id.toString(),
            lab_test_id: updated.lab_test_id.toString(),
            testing_point: updated.testing_point,
            is_required: updated.is_required,
            display_order: updated.display_order,
            is_active: updated.is_active,
          },
        },
      });

      return updated;
    });

    return serializeAssignment(result);
  }
}
