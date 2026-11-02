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
  MOT_SHOP: 'MOT Village Collection',
  ZMCC_LAB_MC: 'ZMCC Lab for MC',
  ZMCC_LAB_HC: 'ZMCC Lab for HC',
  ZMCC_DISPATCH: 'ZMCC Lab Dispatch to Plant',
  CONTRACTOR_DISPATCH: 'Contractor Dispatch to plant',
  PLANT_QA: 'Plant QA Reception Lab',
};

export type PolicyTestMode = 'COMPULSORY' | 'OPTIONAL' | 'OFF' | 'APPLIED' | 'NOT_APPLIED' | 'AUTO';

export interface TestPointPolicyCell {
  labTestId: string;
  testCode: string;
  testName: string;
  displayOrder?: number;
  point: TestPointCode;
  testMode: PolicyTestMode;
  ruleMode: 'APPLY' | 'WARN';
  photoMode: 'REQUIRED' | 'OPTIONAL' | 'NONE';
  version: number;
  effectiveFrom: string;
  source: 'DB' | 'DEFAULT';
}

/**
 * Normalizes test mode aliases:
 * 'APPLIED' -> 'OPTIONAL'
 * 'NOT_APPLIED' -> 'OFF'
 */
export function normalizeTestMode(mode: string): 'COMPULSORY' | 'OPTIONAL' | 'OFF' | 'AUTO' {
  const upper = (mode || '').toUpperCase().trim();
  if (upper === 'COMPULSORY') return 'COMPULSORY';
  if (upper === 'AUTO') return 'AUTO';
  if (upper === 'NOT_APPLIED' || upper === 'OFF') return 'OFF';
  return 'OPTIONAL'; // Default or 'APPLIED'
}
