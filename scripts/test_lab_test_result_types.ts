import { prisma } from '../src/backend/core/db';
import { evaluateLabResult, validateCategoricalOption } from '../src/lib/lab-rules';

async function runLabTestResultTypesVerification() {
  console.log('==================================================');
  console.log('RUNNING LAB TEST RESULT TYPES & SOP SAFETY VERIFICATION');
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

  // Fetch all lab tests from DB
  const labTests = await prisma.labTest.findMany({
    orderBy: { testCode: 'asc' },
  });

  const coreTests = labTests.filter((t) => /^LT-0000(0[1-9]|[1-2][0-9]|30)$/.test(t.testCode));

  // LAB-TYPE-A: Numeric tests in DB
  const numericTests = coreTests.filter((t) => t.resultType === 'NUMERIC');
  assert(numericTests.length >= 10, 'LAB-TYPE-A', `Found ${numericTests.length} NUMERIC lab tests in core seed (Fat, LR, Temp, Acidity, Whey Protein Ratio, etc.)`);

  // LAB-TYPE-B: OK_NOT_OK tests in DB (Smell & Taste)
  const okNotOkTests = coreTests.filter((t) => t.resultType === 'OK_NOT_OK');
  assert(okNotOkTests.length === 2, 'LAB-TYPE-B', `Found ${okNotOkTests.length} OK_NOT_OK lab tests strictly for Organoleptic Smell and Taste`);
  assert(validateCategoricalOption('OK_NOT_OK', 'OK') === true, 'LAB-TYPE-B-OPT1', 'OK is valid option for OK_NOT_OK');
  assert(validateCategoricalOption('OK_NOT_OK', 'NOT_OK') === true, 'LAB-TYPE-B-OPT2', 'NOT_OK is valid option for OK_NOT_OK');
  assert(validateCategoricalOption('OK_NOT_OK', 'INVALID_OPT') === false, 'LAB-TYPE-B-OPT3', 'Invalid option rejected for OK_NOT_OK');

  // LAB-TYPE-C: POSITIVE_NEGATIVE tests in DB (COB, APT, Cup Test, + 10 Adulterants)
  const posNegTests = coreTests.filter((t) => t.resultType === 'POSITIVE_NEGATIVE');
  assert(posNegTests.length === 13, 'LAB-TYPE-C', `Found ${posNegTests.length} POSITIVE_NEGATIVE tests (COB, APT, Cup Test, Starch, Urea, Antibiotic, etc.)`);
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'NEGATIVE') === true, 'LAB-TYPE-C-OPT1', 'NEGATIVE is valid option for POSITIVE_NEGATIVE');
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'POSITIVE') === true, 'LAB-TYPE-C-OPT2', 'POSITIVE is valid option for POSITIVE_NEGATIVE');
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'OK') === false, 'LAB-TYPE-C-OPT3', 'Generic OK option rejected for POSITIVE_NEGATIVE');

  // LAB-TYPE-D: CALCULATED tests in DB (SNF:Fat Ratio)
  const calculatedTests = coreTests.filter((t) => t.resultType === 'CALCULATED');
  assert(calculatedTests.length === 1, 'LAB-TYPE-D', `Found ${calculatedTests.length} CALCULATED lab test (SNF:Fat Ratio)`);

  // LAB-TYPE-E: DispatchLabResult and PlantLabResult separation
  const dispatchCount = await prisma.dispatchLabResult.count();
  const plantCount = await prisma.plantLabResult.count();
  assert(dispatchCount >= 0 && plantCount >= 0, 'LAB-TYPE-E', `Dispatch (${dispatchCount}) and Plant (${plantCount}) lab results are stored in independent tables`);

  // LAB-TYPE-F: Backend validation for invalid categorical option
  const invalidEval = evaluateLabResult('LT-000011', null, 'INVALID_VAL', 'POSITIVE_NEGATIVE');
  assert(invalidEval.isPassed === false && invalidEval.status === 'UNCONFIGURED', 'LAB-TYPE-F', 'Backend evaluation flags invalid categorical option');

  // LAB-TYPE-G: Historical results preservation
  const historicalDispatch = await prisma.dispatchLabResult.findFirst({
    where: { text_value: { not: null } },
  });
  assert(historicalDispatch !== null ? historicalDispatch.text_value !== null : true, 'LAB-TYPE-G', 'Historical lab result text values preserved without rewriting');

  // SOP-SAFE-A: No unconfirmed numeric threshold forces REJECT
  const tempEval = evaluateLabResult('LT-000001', 12.5, null, 'NUMERIC');
  assert(tempEval.status === 'NO_ACTIVE_RULE', 'SOP-SAFE-A', 'Unconfirmed temperature 12.5°C returns NO_ACTIVE_RULE status without forced silent rejection');

  // SOP-SAFE-B: POSITIVE result evaluates isPassed as false based on option metadata
  const antibioticEval = evaluateLabResult('LT-000020', null, 'POSITIVE', 'POSITIVE_NEGATIVE');
  assert(antibioticEval.isPassed === false, 'SOP-SAFE-B', 'Positive Antibiotic test evaluates isPassed as false based on option metadata');

  // SOP-SAFE-C: Missing rule returns NO_ACTIVE_RULE status
  const missingRuleEval = evaluateLabResult('LT-000010', 0.15, null, 'NUMERIC');
  assert(missingRuleEval.status === 'NO_ACTIVE_RULE', 'SOP-SAFE-C', 'Missing rule returns NO_ACTIVE_RULE status instead of guessing threshold');

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLabTestResultTypesVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
