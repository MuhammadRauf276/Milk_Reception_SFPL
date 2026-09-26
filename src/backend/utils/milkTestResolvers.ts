/**
 * Canonical Core Milk Test Resolvers
 * Authoritative shared helpers to resolve measured LR and Fat test results
 * from lab test snapshots or active LabTest definitions.
 */

export interface TestSnapshotLike {
  test_id?: string | bigint | number;
  testId?: string | bigint | number;
  test_code_snapshot?: string | null;
  testCode?: string | null;
  test_name_snapshot?: string | null;
  testName?: string | null;
  result_type_snapshot?: string | null;
  resultType?: string | null;
  numeric_value?: number | string | null | any;
  numericValue?: number | string | null | any;
}

/**
 * Determines whether a test metadata snapshot represents a Lactometer Reading (LR) candidate.
 * Canonical LR test codes: LT-000008 ("LR at 20 Celsius"), LT-000027 ("Lactometer Reading").
 * Must NOT be a CALCULATED ratio.
 */
export function isLrTestCandidate(
  testCode?: string | null,
  testName?: string | null,
  resultType?: string | null
): boolean {
  if (resultType && resultType.trim().toUpperCase() === 'CALCULATED') {
    return false;
  }
  const codeUpper = (testCode || '').trim().toUpperCase();
  const nameUpper = (testName || '').trim().toUpperCase();

  // Explicit test code match
  if (codeUpper === 'LT-000008' || codeUpper === 'LT-000027') {
    return true;
  }
  // Exclude ratio tests
  if (nameUpper.includes('RATIO') || codeUpper.includes('RATIO')) {
    return false;
  }
  // Name or code semantics
  if (codeUpper === 'LR' || codeUpper.includes('LACTOMETER')) {
    return true;
  }
  if (
    nameUpper.includes('LACTOMETER') ||
    /\bLR\b/.test(nameUpper) ||
    nameUpper.startsWith('LR ') ||
    nameUpper.endsWith(' LR')
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether a test metadata snapshot represents a Fat % candidate.
 * Canonical Fat test code: LT-000026 ("Fat").
 * Must NOT be a ratio test (e.g. "SNF to Fat Ratio").
 */
export function isFatTestCandidate(
  testCode?: string | null,
  testName?: string | null,
  resultType?: string | null
): boolean {
  if (resultType && resultType.trim().toUpperCase() === 'CALCULATED') {
    return false;
  }
  const codeUpper = (testCode || '').trim().toUpperCase();
  const nameUpper = (testName || '').trim().toUpperCase();

  // Exclude ratio tests
  if (
    nameUpper.includes('RATIO') ||
    nameUpper.includes('SNF TO FAT') ||
    codeUpper.includes('RATIO')
  ) {
    return false;
  }

  // Explicit test code match
  if (codeUpper === 'LT-000026') {
    return true;
  }

  // Name or code semantics
  if (codeUpper === 'FAT' || codeUpper.includes('FAT')) {
    return true;
  }
  if (
    nameUpper === 'FAT' ||
    nameUpper.startsWith('FAT ') ||
    nameUpper.endsWith(' FAT') ||
    nameUpper.includes('FAT %') ||
    nameUpper.includes('FAT PERCENTAGE') ||
    /\bFAT\b/.test(nameUpper)
  ) {
    return true;
  }
  return false;
}

export type ResolveCoreMilkTestResult<T = any> =
  | {
      success: true;
      lr: number;
      fat: number;
      lrTest: T;
      fatTest: T;
    }
  | {
      success: false;
      error: string;
      statusCode: 400;
    };

/**
 * Authoritative Server-Side Helper to resolve exactly one LR and one Fat test result
 * from a list of test snapshots or lab results.
 *
 * Rules:
 * 1. Zero candidates -> FAIL CLOSED (400).
 * 2. Multiple candidates -> FAIL CLOSED (400, Ambiguous).
 * 3. Non-numeric or invalid value -> FAIL CLOSED (400).
 */
export type ValidateCoreMilkTestCandidatesResult<T = any> =
  | {
      valid: true;
      lrCandidate: T;
      fatCandidate: T;
    }
  | {
      valid: false;
      error: string;
    };

/**
 * Validates that a candidate test list contains exactly one LR candidate
 * and exactly one Fat candidate, without requiring numeric values yet (e.g. for policy pre-flight).
 */
export function validateCoreMilkTestCandidates<T extends TestSnapshotLike>(
  tests: T[]
): ValidateCoreMilkTestCandidatesResult<T> {
  if (!Array.isArray(tests) || tests.length === 0) {
    return {
      valid: false,
      error: 'Missing lab tests: cannot validate core LR and Fat test requirements.',
    };
  }

  const lrCandidates = tests.filter((r) => {
    const code = r.test_code_snapshot ?? r.testCode;
    const name = r.test_name_snapshot ?? r.testName;
    const type = r.result_type_snapshot ?? r.resultType;
    return isLrTestCandidate(code, name, type);
  });

  if (lrCandidates.length === 0) {
    return {
      valid: false,
      error: 'Missing LR test: no Lactometer Reading (LR) test found in policy.',
    };
  }
  if (lrCandidates.length > 1) {
    return {
      valid: false,
      error: `Ambiguous LR test resolution: found ${lrCandidates.length} LR test candidates in policy.`,
    };
  }

  const fatCandidates = tests.filter((r) => {
    const code = r.test_code_snapshot ?? r.testCode;
    const name = r.test_name_snapshot ?? r.testName;
    const type = r.result_type_snapshot ?? r.resultType;
    return isFatTestCandidate(code, name, type);
  });

  if (fatCandidates.length === 0) {
    return {
      valid: false,
      error: 'Missing Fat test: no Fat % test found in policy.',
    };
  }
  if (fatCandidates.length > 1) {
    return {
      valid: false,
      error: `Ambiguous Fat test resolution: found ${fatCandidates.length} Fat test candidates in policy.`,
    };
  }

  return {
    valid: true,
    lrCandidate: lrCandidates[0],
    fatCandidate: fatCandidates[0],
  };
}

export function resolveCoreMilkTestResults<T extends TestSnapshotLike>(
  results: T[]
): ResolveCoreMilkTestResult<T> {
  const candidateValidation = validateCoreMilkTestCandidates(results);
  if (!candidateValidation.valid) {
    return {
      success: false,
      error: candidateValidation.error,
      statusCode: 400,
    };
  }

  const lrTest = candidateValidation.lrCandidate;
  const fatTest = candidateValidation.fatCandidate;

  // 3. Extract and validate numeric LR
  const rawLr = lrTest.numeric_value ?? lrTest.numericValue;
  if (rawLr === null || rawLr === undefined || rawLr === '') {
    return {
      success: false,
      error: 'Missing LR test result: Lactometer Reading (LR) must have a valid numeric value.',
      statusCode: 400,
    };
  }
  const lrNum = Number(rawLr);
  if (isNaN(lrNum) || lrNum <= 0) {
    return {
      success: false,
      error: 'Invalid LR test result: Lactometer Reading (LR) must be a positive number.',
      statusCode: 400,
    };
  }

  // 4. Extract and validate numeric Fat
  const rawFat = fatTest.numeric_value ?? fatTest.numericValue;
  if (rawFat === null || rawFat === undefined || rawFat === '') {
    return {
      success: false,
      error: 'Missing Fat test result: Fat % must have a valid numeric value.',
      statusCode: 400,
    };
  }
  const fatNum = Number(rawFat);
  if (isNaN(fatNum) || fatNum < 0) {
    return {
      success: false,
      error: 'Invalid Fat test result: Fat % must be a non-negative number.',
      statusCode: 400,
    };
  }

  return {
    success: true,
    lr: lrNum,
    fat: fatNum,
    lrTest,
    fatTest,
  };
}
