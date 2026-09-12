/**
 * Canonical Milk Test Policy Types & Pure Contracts
 * Client-safe pure types and constants with ZERO Prisma/DB/Node dependencies.
 */

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

export interface ActorUser {
  id: string | bigint | number;
  username: string;
  role: string;
}

export interface CreatePolicyAssignmentInput {
  labTestId: string | bigint | number;
  testingPoint: string;
  isRequired?: boolean;
  displayOrder?: unknown;
}

export interface UpdatePolicyAssignmentInput {
  isRequired?: boolean;
  displayOrder?: unknown;
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
