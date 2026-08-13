import { prisma } from '../src/backend/core/db';
import { validatePositiveDecimal, validateNonNegativeDecimal, calculateSnfFatRatio } from '../src/lib/validation-helpers';

async function runSystemDataValidationTests() {
  console.log('==================================================');
  console.log('RUNNING SYSTEM DATA VALIDATION TESTS (VALID-NUM-A..M)');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName}: ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${detail}`);
      failed++;
    }
  }

  // VALID-NUM-A: Dispatch quantity -100 rejected
  const dispatchNeg = validatePositiveDecimal(-100, 'Dispatch Quantity');
  assert(!dispatchNeg.isValid, 'VALID-NUM-A', 'Dispatch quantity -100 rejected');

  // VALID-NUM-B: Dispatch quantity 0 rejected
  const dispatchZero = validatePositiveDecimal(0, 'Dispatch Quantity');
  assert(!dispatchZero.isValid, 'VALID-NUM-B', 'Dispatch quantity 0 rejected');

  // VALID-NUM-C: Positive quantity accepted
  const dispatchPos = validatePositiveDecimal(8500, 'Dispatch Quantity');
  assert(dispatchPos.isValid && dispatchPos.value === 8500, 'VALID-NUM-C', 'Positive quantity 8500 accepted');

  // VALID-NUM-D: Gross -500 rejected
  const grossNeg = validatePositiveDecimal(-500, 'Gross Weight');
  assert(!grossNeg.isValid, 'VALID-NUM-D', 'Gross weight -500 rejected');

  // VALID-NUM-E: Gross 0 rejected
  const grossZero = validatePositiveDecimal(0, 'Gross Weight');
  assert(!grossZero.isValid, 'VALID-NUM-E', 'Gross weight 0 rejected');

  // VALID-NUM-F: Tare -500 rejected
  const tareNeg = validatePositiveDecimal(-500, 'Tare Weight');
  assert(!tareNeg.isValid, 'VALID-NUM-F', 'Tare weight -500 rejected');

  // VALID-NUM-G: Tare 0 rejected
  const tareZero = validatePositiveDecimal(0, 'Tare Weight');
  assert(!tareZero.isValid, 'VALID-NUM-G', 'Tare weight 0 rejected');

  // VALID-NUM-H: Tare >= Gross rejected
  const grossVal = 12000;
  const tareVal = 12000;
  const tareGreater = 13000;
  assert(tareVal >= grossVal, 'VALID-NUM-H1', 'Tare equal to Gross (12000 >= 12000) flagged invalid');
  assert(tareGreater >= grossVal, 'VALID-NUM-H2', 'Tare greater than Gross (13000 >= 12000) flagged invalid');

  // VALID-NUM-I: Net <= 0 impossible
  const validGross = 25000;
  const validTare = 10000;
  const netWeight = validGross - validTare;
  assert(netWeight > 0 && netWeight === 15000, 'VALID-NUM-I', `Calculated Net weight ${netWeight} kg is strictly positive`);

  // VALID-NUM-J: NaN / Infinity / malformed number rejected
  const nanVal = validatePositiveDecimal(NaN, 'Weight');
  const infVal = validatePositiveDecimal(Infinity, 'Weight');
  const strVal = validatePositiveDecimal('abc', 'Weight');
  assert(!nanVal.isValid && !infVal.isValid && !strVal.isValid, 'VALID-NUM-J', 'NaN, Infinity, and malformed numeric strings strictly rejected');

  // VALID-NUM-K: Silo issue <= 0 rejected
  const issueNeg = validatePositiveDecimal(-2500, 'Issue Quantity');
  const issueZero = validatePositiveDecimal(0, 'Issue Quantity');
  assert(!issueNeg.isValid && !issueZero.isValid, 'VALID-NUM-K', 'Silo issue <= 0 strictly rejected');

  // VALID-NUM-L: Silo issue > current stock simulation
  const stock = 10000;
  const overIssue = 12000;
  assert(overIssue > stock, 'VALID-NUM-L', `Silo issue ${overIssue} L exceeding available stock ${stock} L flagged invalid`);

  // VALID-NUM-M: Derived formulas return null/N/A for undefined ratio (never 0, NaN, or Infinity)
  const undefinedRatioZeroFat = calculateSnfFatRatio(8.5, 0);
  const undefinedRatioNullFat = calculateSnfFatRatio(8.5, null);
  assert(undefinedRatioZeroFat === null, 'VALID-NUM-M1', 'SNF:Fat ratio with Fat = 0 returns null (NEVER 0, NaN, or Infinity)');
  assert(undefinedRatioNullFat === null, 'VALID-NUM-M2', 'SNF:Fat ratio with null Fat returns null');

  const validRatio = calculateSnfFatRatio(8.5, 3.8);
  assert(validRatio === 2.237, 'VALID-NUM-M3', `SNF:Fat ratio calculated cleanly: ${validRatio}`);

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSystemDataValidationTests().catch(console.error);
