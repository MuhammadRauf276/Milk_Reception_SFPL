// Test point policy contract: testing points (matrix columns), labels and the per-cell policy shape (client-safe).
// Mode literals mirror TestPointPolicy.test_mode / rule_mode / photo_mode in prisma/schema.prisma.

export type TestPointCode =
  | 'MOT_SHOP'
  | 'ZMCC_LAB_MC'
  | 'ZMCC_LAB_HC'
  | 'ZMCC_DISPATCH'
  | 'CONTRACTOR_DISPATCH'
  | 'PLANT_QA';

export const TEST_POINT_CODES: readonly TestPointCode[] = [
  'MOT_SHOP',
  'ZMCC_LAB_MC',
  'ZMCC_LAB_HC',
  'ZMCC_DISPATCH',
  'CONTRACTOR_DISPATCH',
  'PLANT_QA',
];

export const TEST_POINT_LABELS: Record<TestPointCode, string> = {
  MOT_SHOP: 'Shop (MOT)',
  ZMCC_LAB_MC: 'ZMCC lab – MC',
  ZMCC_LAB_HC: 'ZMCC lab – HC',
  ZMCC_DISPATCH: 'ZMCC dispatch',
  CONTRACTOR_DISPATCH: 'Contractor dispatch',
  PLANT_QA: 'Plant QA',
};

export interface TestPointPolicyCell {
  labTestId: string;
  testCode: string;
  testName: string;
  point: TestPointCode;
  testMode: 'COMPULSORY' | 'OPTIONAL' | 'OFF';
  ruleMode: 'APPLY' | 'WARN';
  photoMode: 'REQUIRED' | 'OPTIONAL' | 'NONE';
  version: number;
  effectiveFrom: string;
  source: 'DB' | 'DEFAULT';
}
