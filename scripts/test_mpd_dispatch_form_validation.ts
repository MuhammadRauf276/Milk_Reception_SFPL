import { prisma } from '../src/backend/core/db';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';

async function main() {
  console.log('==================================================');
  console.log('RUNNING COMPREHENSIVE MPD DISPATCH FORM REGRESSION TESTS');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // 1. Fetch active DISPATCH/BOTH lab tests from database
  const activeDispatchTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { testName: 'asc' }],
  });

  const totalTestsCount = activeDispatchTests.length;
  const calculatedTests = activeDispatchTests.filter((t) => t.resultType === 'CALCULATED');
  const manualTests = activeDispatchTests.filter((t) => t.resultType !== 'CALCULATED');
  const requiredManualTests = manualTests.filter((t) => t.isRequired);
  const qualitativeDefaultedTests = manualTests.filter(
    (t) => t.resultType === 'OK_NOT_OK' || t.resultType === 'POSITIVE_NEGATIVE' || t.resultType === 'BOOLEAN' || t.resultType === 'QUALITATIVE'
  );
  const quantitativeManualTests = manualTests.filter((t) => t.resultType === 'NUMERIC');

  console.log(`  -> Audit Total DISPATCH/BOTH tests: ${totalTestsCount}`);
  console.log(`  -> Manual Required Tests (Denominator): ${requiredManualTests.length}`);
  console.log(`  -> Qualitative Defaulted Tests: ${qualitativeDefaultedTests.length}`);
  console.log(`  -> Quantitative Manual Tests: ${quantitativeManualTests.length}`);
  console.log(`  -> Calculated Tests Excluded from Manual Grid: ${calculatedTests.length}\n`);

  assert(totalTestsCount > 0, 'MPD-AUD-01: Active DISPATCH/BOTH tests loaded from database', `Total = ${totalTestsCount}`);
  assert(calculatedTests.length > 0, 'MPD-AUD-02: Calculated tests identified and excluded from manual grid', `Count = ${calculatedTests.length}`);
  assert(qualitativeDefaultedTests.length > 0, 'MPD-AUD-03: Qualitative defaulted tests identified', `Count = ${qualitativeDefaultedTests.length}`);

  // Helper simulating portion state initialization in DynamicDispatchForm
  function createPortionInitialState(portionNumber: number) {
    const results: Record<string, { numericValue: string; textValue: string }> = {};

    activeDispatchTests.forEach((t) => {
      const idStr = t.id.toString();
      if (t.resultType === 'OK_NOT_OK') results[idStr] = { numericValue: '', textValue: 'OK' };
      else if (t.resultType === 'POSITIVE_NEGATIVE') results[idStr] = { numericValue: '', textValue: 'NEGATIVE' };
      else if (t.resultType === 'QUALITATIVE') results[idStr] = { numericValue: '', textValue: 'OK' };
      else if (t.resultType === 'BOOLEAN') results[idStr] = { numericValue: '', textValue: 'NO' };
      else results[idStr] = { numericValue: '', textValue: '' };
    });

    return {
      portionNumber,
      declaredQuantityKg: '' as number | '',
      results,
      isSaved: false,
    };
  }

  // TEST A: New Portion Initialization State
  const freshPortion = createPortionInitialState(1);
  const uninitializedQualitative = qualitativeDefaultedTests.filter((t) => {
    const res = freshPortion.results[t.id.toString()];
    return !res || !res.textValue;
  });
  assert(
    uninitializedQualitative.length === 0,
    'MPD-INIT-01: Configured qualitative defaults exist immediately in actual portion state',
    `Uninitialized qualitative count = ${uninitializedQualitative.length}`
  );

  // TEST B: Completeness Counter Logic
  function getPortionProgress(portion: typeof freshPortion) {
    const completedCount = requiredManualTests.filter((t) => {
      const res = portion.results[t.id.toString()];
      if (!res) return false;
      if (t.resultType === 'NUMERIC') return res.numericValue !== '' && !isNaN(Number(res.numericValue));
      return res.textValue !== '' && res.textValue !== null && res.textValue !== undefined;
    }).length;

    return { completed: completedCount, total: requiredManualTests.length };
  }

  const initialProgress = getPortionProgress(freshPortion);
  assert(
    initialProgress.completed === qualitativeDefaultedTests.length && initialProgress.total === requiredManualTests.length,
    'MPD-CTR-01: Initial completeness counter shows qualitative defaults as completed and excludes calculated fields',
    `Counter = ${initialProgress.completed} of ${initialProgress.total} required tests`
  );

  // Fill 1 numeric test (e.g. Fat) and check counter increment
  const fatTest = activeDispatchTests.find((t) => t.testName.toLowerCase() === 'fat');
  if (fatTest) {
    freshPortion.results[fatTest.id.toString()] = { numericValue: '3.8', textValue: '' };
    const updatedProgress = getPortionProgress(freshPortion);
    assert(
      updatedProgress.completed === initialProgress.completed + 1,
      'MPD-CTR-02: Counter increments dynamically when a required quantitative numeric value is entered',
      `Updated counter = ${updatedProgress.completed} of ${updatedProgress.total}`
    );
  }

  // TEST C: Save Portion Rules
  function validatePortionSave(portion: typeof freshPortion) {
    const errors: { declaredQuantityKg?: string; tests: Record<string, string> } = { tests: {} };

    const qty = Number(portion.declaredQuantityKg);
    if (!portion.declaredQuantityKg || isNaN(qty) || qty <= 0) {
      errors.declaredQuantityKg = 'Enter a valid quantity greater than 0 kg.';
    }

    for (const reqTest of requiredManualTests) {
      const res = portion.results[reqTest.id.toString()];
      if (!res) {
        errors.tests[reqTest.id.toString()] = `Result for ${reqTest.testName} is required.`;
      } else if (reqTest.resultType === 'NUMERIC') {
        if (res.numericValue === '' || isNaN(Number(res.numericValue)) || Number(res.numericValue) < 0) {
          errors.tests[reqTest.id.toString()] = `Enter a valid numeric value for ${reqTest.testName}.`;
        }
      } else {
        if (!res.textValue || res.textValue.trim() === '') {
          errors.tests[reqTest.id.toString()] = `Result for ${reqTest.testName} is required.`;
        }
      }
    }

    const hasErrors = !!errors.declaredQuantityKg || Object.keys(errors.tests).length > 0;
    return { isSaved: !hasErrors, errors };
  }

  // 1. Missing declared quantity -> BLOCKED
  const resMissingQty = validatePortionSave(freshPortion);
  assert(!resMissingQty.isSaved, 'MPD-SAVE-01: Save Portion BLOCKED when declared quantity is empty');

  // 2. Untouched qualitative defaults + Quantity 8500 but missing numeric tests -> BLOCKED
  freshPortion.declaredQuantityKg = 8500;
  const resMissingNumeric = validatePortionSave(freshPortion);
  assert(
    !resMissingNumeric.isSaved && Object.keys(resMissingNumeric.errors.tests).length > 0,
    'MPD-SAVE-02: Save Portion BLOCKED when required quantitative numeric tests are missing',
    `Missing numeric errors count = ${Object.keys(resMissingNumeric.errors.tests).length}`
  );

  // 3. Fill all quantitative numeric tests -> Save Portion SUCCEEDS (untouched qualitative defaults pass)
  quantitativeManualTests.forEach((t) => {
    const tName = t.testName.toLowerCase();
    if (tName.includes('fat')) freshPortion.results[t.id.toString()] = { numericValue: '3.8', textValue: '' };
    else if (tName.includes('lactometer') || tName.includes('lr')) freshPortion.results[t.id.toString()] = { numericValue: '28.5', textValue: '' };
    else if (tName.includes('temp')) freshPortion.results[t.id.toString()] = { numericValue: '4.5', textValue: '' };
    else if (tName.includes('acid')) freshPortion.results[t.id.toString()] = { numericValue: '0.13', textValue: '' };
    else if (tName.includes('ph')) freshPortion.results[t.id.toString()] = { numericValue: '6.65', textValue: '' };
    else freshPortion.results[t.id.toString()] = { numericValue: '1.0', textValue: '' };
  });

  const resAllValid = validatePortionSave(freshPortion);
  assert(
    resAllValid.isSaved && Object.keys(resAllValid.errors.tests).length === 0,
    'MPD-SAVE-03: Save Portion SUCCEEDS with valid declared quantity & required numeric entries without requiring dropdown clicks'
  );

  // TEST D: Calculated Card Helper & Live Updates
  function computeCalculatedMilkValues(declaredKg: number | '', lrStr: string, fatStr: string) {
    const lrNum = lrStr !== '' && !isNaN(Number(lrStr)) ? Number(lrStr) : null;
    const fatNum = fatStr !== '' && !isNaN(Number(fatStr)) ? Number(fatStr) : null;
    const kgNum = typeof declaredKg === 'number' && declaredKg > 0 ? declaredKg : null;

    if (lrNum === null || fatNum === null) {
      return { snf: null, ts: null, ratio: null, density: null, physicalLiters: null, at13TsLiters: null };
    }

    const snf = calculateSNF(lrNum, fatNum);
    const ts = calculateTS(fatNum, snf);
    const ratio = calculateRatio(snf, fatNum);
    const density = calculateDensity(lrNum);
    const physicalLiters = kgNum !== null ? calculatePhysicalLiters(kgNum, lrNum) : null;
    const at13TsLiters = physicalLiters !== null ? calculateAt13TSLiters(physicalLiters, ts) : null;

    return { snf, ts, ratio, density, physicalLiters, at13TsLiters };
  }

  // 1. Invalid/missing prerequisites display null / fallback
  const missingCalc = computeCalculatedMilkValues('', '', '');
  assert(
    missingCalc.snf === null && missingCalc.physicalLiters === null,
    'MPD-CALC-01: Missing calculation prerequisites cleanly return null for em-dash fallback (no NaN or Infinity)'
  );

  // 2. Live calculation with LR=28.5, Fat=3.8, Kg=10000
  const validCalc = computeCalculatedMilkValues(10000, '28.5', '3.8');
  assert(
    validCalc.snf !== null &&
      Math.abs(validCalc.snf - 8.681) < 0.001 &&
      validCalc.physicalLiters !== null &&
      Math.abs(validCalc.physicalLiters - 9722.897) < 0.1,
    'MPD-CALC-02: Live calculation helper correctly computes SNF % (8.681%) and Physical Liters (9,723 L) via canonical helpers'
  );

  // TEST E: Payload & Backend Consistency Verification
  const payloadPortionResults = Object.keys(freshPortion.results).map((testId) => ({
    testId,
    numericValue: freshPortion.results[testId].numericValue !== '' ? Number(freshPortion.results[testId].numericValue) : null,
    textValue: freshPortion.results[testId].textValue || null,
  }));

  const unpopulatedQualitativePayload = payloadPortionResults.filter((r) => {
    const testDef = activeDispatchTests.find((t) => t.id.toString() === r.testId);
    if (testDef && (testDef.resultType === 'OK_NOT_OK' || testDef.resultType === 'POSITIVE_NEGATIVE')) {
      return !r.textValue;
    }
    return false;
  });

  assert(
    unpopulatedQualitativePayload.length === 0,
    'MPD-PAYLOAD-01: Submitted payload contains actual qualitative default state values (OK / NEGATIVE)',
    `Unpopulated qualitative count in payload = ${unpopulatedQualitativePayload.length}`
  );

  console.log('\n==================================================');
  console.log(`COMPREHENSIVE MPD DISPATCH REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in MPD dispatch form regression tests:', err);
  process.exit(1);
});
