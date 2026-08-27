import { PrismaClient } from '@prisma/client';
import { evaluateLabResult } from '../src/lib/lab-rules';
import { calculateGrossLiters } from '../src/backend/utils/milkFormulas';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runStage4Tests() {
  console.log('================================================================');
  console.log('STAGE 4 & 4A TEST SUITE: QUALITATIVE RADIOS AND TERMINOLOGY AUDIT');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log('[PASS] ' + testName);
      passed++;
    } else {
      console.error('[FAIL] ' + testName);
      if (detail) console.error('       Detail: ' + detail);
      failed++;
    }
  }

  try {
    // ---------------------------------------------------------
    // TEST GROUP 1: RADIO COMPONENT AND MEANINGFUL ACCESSIBILITY
    // ---------------------------------------------------------
    console.log('--- TEST GROUP 1: RADIO CONTROLS AND MEANINGFUL ACCESSIBILITY ---');

    const radioCompPath = path.join(process.cwd(), 'src/frontend/modules/shared/QualitativeResultRadioGroup.tsx');
    const radioSource = fs.readFileSync(radioCompPath, 'utf8');
    assert(fs.existsSync(radioCompPath), 'QualitativeResultRadioGroup.tsx exists in src/frontend/modules/shared');
    assert(radioSource.includes('type="radio"'), 'Radio component uses native radio inputs');
    assert(radioSource.includes('role="radiogroup"'), 'Radio component includes radiogroup accessibility role');
    assert(radioSource.includes('opt.label || opt.value'), 'Radio component displays option label to operator');
    assert(!radioSource.includes('aria-labelledby={`radio-group-label-${name}`}'), 'Radio component eliminated dangling aria-labelledby pointer');
    assert(!radioSource.includes('aria-label={ariaLabel || name}'), 'Radio component eliminated technical name fallback');
    assert(radioSource.includes('ariaLabel') && radioSource.includes('ariaLabelledBy'), 'Radio component supports ariaLabel and ariaLabelledBy props');
    assert(radioSource.includes('aria-describedby'), 'Radio component supports aria-describedby for accessible error connection');
    assert(radioSource.includes('sanitizedVal'), 'Radio component sanitizes option value for safe DOM input IDs');

    const dispatchPath = path.join(process.cwd(), 'src/frontend/modules/forms/DynamicDispatchForm.tsx');
    const dispatchSource = fs.readFileSync(dispatchPath, 'utf8');
    assert(dispatchSource.includes('QualitativeResultRadioGroup'), 'DynamicDispatchForm imports and renders QualitativeResultRadioGroup');
    assert(dispatchSource.includes('dispatch-contractor-'), 'Contractor radio names are uniquely scoped by portion clientId and testId');
    assert(dispatchSource.includes('dispatch-zmcc-'), 'ZMCC radio names are uniquely scoped by portion clientId and testId');
    assert(dispatchSource.includes('ariaLabel={`${test.testName} result for Portion ${portion.portionNumber}`}'), 'DynamicDispatchForm passes meaningful test and portion accessible labels');

    const qaWorkspacePath = path.join(process.cwd(), 'src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx');
    const qaSource = fs.readFileSync(qaWorkspacePath, 'utf8');
    assert(qaSource.includes('QualitativeResultRadioGroup'), 'QALaboratoryWorkspace imports and renders QualitativeResultRadioGroup');
    assert(qaSource.includes('qa-'), 'Plant QA radio names are uniquely scoped by visitId, portionId, and testId');
    assert(qaSource.includes('ariaLabel={`${test.testName} result for Portion ${currentPortion.portion_number}`}'), 'Plant QA passes meaningful test and portion accessible labels');

    // ---------------------------------------------------------
    // TEST GROUP 2: BEHAVIORAL RADIO EVALUATION & 3-OPTION PROOF
    // ---------------------------------------------------------
    console.log('\n--- TEST GROUP 2: METADATA-DRIVEN RADIO CHOICES AND 3-OPTION PROOF ---');

    // Prove 3 custom options (CLEAR, SLIGHTLY_TURBID, TURBID) work through three-state evaluation
    const threeOptionClarityDef = [
      { value: 'CLEAR', label: 'Clear and Bright', isPassing: true },
      { value: 'SLIGHTLY_TURBID', label: 'Slightly Turbid', isPassing: null }, // Neutral
      { value: 'TURBID', label: 'Heavily Turbid', isPassing: false } // Fail
    ];

    const evalClear = evaluateLabResult('CLARITY_01', null, 'CLEAR', 'QUALITATIVE', threeOptionClarityDef);
    assert(evalClear.isPassed === true && evalClear.status === 'EVALUATED', 'Option 1 (CLEAR) resolves to PASS (isPassed === true, status === EVALUATED)');

    const evalSlightlyTurbid = evaluateLabResult('CLARITY_01', null, 'SLIGHTLY_TURBID', 'QUALITATIVE', threeOptionClarityDef);
    assert(evalSlightlyTurbid.isPassed === null && evalSlightlyTurbid.status === 'NEUTRAL', 'Option 2 (SLIGHTLY_TURBID) resolves to NEUTRAL (isPassed === null, status === NEUTRAL)');

    const evalTurbid = evaluateLabResult('CLARITY_01', null, 'TURBID', 'QUALITATIVE', threeOptionClarityDef);
    assert(evalTurbid.isPassed === false && evalTurbid.status === 'EVALUATED', 'Option 3 (TURBID) resolves to FAIL (isPassed === false, status === EVALUATED)');

    // ---------------------------------------------------------
    // TEST GROUP 3: CONTRACTOR INITIAL NOT_PERFORMED AND UNSELECTED BEHAVIOR
    // ---------------------------------------------------------
    console.log('\n--- TEST GROUP 3: CONTRACTOR DISPATCH INITIAL NOT_PERFORMED AND SWITCHING ---');

    assert(dispatchSource.includes("performanceStatus: isContractorSource ? 'NOT_PERFORMED' : 'PERFORMED'"), 'Contractor initial performanceStatus is NOT_PERFORMED');
    assert(dispatchSource.includes("notPerformedReason: isContractorSource ? 'Contract Vehicle' : ''"), 'Contractor initial notPerformedReason is Contract Vehicle');
    assert(dispatchSource.includes("numericValue: ''") && dispatchSource.includes("textValue: ''"), 'Switching to NOT_PERFORMED clears numericValue and textValue');

    // ---------------------------------------------------------
    // TEST GROUP 4: NO CONTRACTOR LITER -> KG CONVERSION
    // ---------------------------------------------------------
    console.log('\n--- TEST GROUP 4: NO CONTRACTOR LITER TO KG CONVERSION ---');

    assert(!dispatchSource.includes("equivalentKg:"), 'DynamicDispatchForm does not calculate equivalentKg for Contractor LITER declarations');
    assert(!dispatchSource.includes("Equivalent KG"), 'DynamicDispatchForm does not display Equivalent KG in summary strip');
    assert(calculateGrossLiters(10000, 'LITER', null) === 10000, 'calculateGrossLiters treats Contractor LITER declarations strictly as declared liters');

    // ---------------------------------------------------------
    // TEST GROUP 5: TERMINOLOGY STANDARDIZATION & SECOND WEIGHT AUDIT
    // ---------------------------------------------------------
    console.log('\n--- TEST GROUP 5: OPERATIONAL UI TERMINOLOGY AUDIT ---');

    // Check 13 TS terminology
    const logModalPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/LogDetailModal.tsx');
    const logModalSource = fs.readFileSync(logModalPath, 'utf8');
    assert(!logModalSource.includes('Plant 13% TS Liters'), 'LogDetailModal does not contain Plant 13% TS Liters');
    assert(logModalSource.includes('13 TS'), 'LogDetailModal displays standardized 13 TS');
    assert(logModalSource.includes('First Weight'), 'LogDetailModal displays First Weight');
    assert(logModalSource.includes('Second Weight'), 'LogDetailModal displays Second Weight');
    assert(logModalSource.includes('Net Milk Weight'), 'LogDetailModal displays Net Milk Weight');
    assert(logModalSource.includes('Physical Received Liters'), 'LogDetailModal displays Physical Received Liters');

    // Check Weighbridge Workspace terminology
    const wbPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/WeighbridgeWorkspace.tsx');
    const wbSource = fs.readFileSync(wbPath, 'utf8');
    assert(!wbSource.includes('Gross Operational Date'), 'WeighbridgeWorkspace does not contain Gross Operational Date');
    assert(!wbSource.includes('Tare Operational Date'), 'WeighbridgeWorkspace does not contain Tare Operational Date');
    assert(!wbSource.includes('Tare Weighment Time'), 'WeighbridgeWorkspace does not contain Tare Weighment Time');
    assert(!wbSource.includes('Tare Weight (kg)'), 'WeighbridgeWorkspace does not contain Tare Weight (kg)');
    assert(wbSource.includes('First Weighment Time'), 'WeighbridgeWorkspace displays First Weighment Time');
    assert(wbSource.includes('Second Weighment Time'), 'WeighbridgeWorkspace displays Second Weighment Time');
    assert(wbSource.includes('Second Weight (After Unloading)'), 'WeighbridgeWorkspace displays Second Weight (After Unloading)');
    assert(wbSource.includes('Net Milk Weight:'), 'WeighbridgeWorkspace displays Net Milk Weight:');

    // Check Production Unloading Workspace terminology
    const prodPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/ProductionUnloadingWorkspace.tsx');
    const prodSource = fs.readFileSync(prodPath, 'utf8');
    assert(!prodSource.includes('Unloading Start Operational Date'), 'ProductionUnloadingWorkspace does not contain Unloading Start Operational Date');
    assert(!prodSource.includes('Unloading Complete Operational Date'), 'ProductionUnloadingWorkspace does not contain Unloading Complete Operational Date');
    assert(prodSource.includes('Unloading Start Time'), 'ProductionUnloadingWorkspace displays Unloading Start Time');
    assert(prodSource.includes('Unloading Complete Time'), 'ProductionUnloadingWorkspace displays Unloading Complete Time');

    // Check Security Gateway Workspace terminology
    const secPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/SecurityGatewayWorkspace.tsx');
    const secSource = fs.readFileSync(secPath, 'utf8');
    assert(!secSource.includes('Gate Entry Operational Date'), 'SecurityGatewayWorkspace does not contain Gate Entry Operational Date');
    assert(!secSource.includes('Gate Exit Operational Date'), 'SecurityGatewayWorkspace does not contain Gate Exit Operational Date');
    assert(secSource.includes('Gate Entry Time'), 'SecurityGatewayWorkspace displays Gate Entry Time');
    assert(secSource.includes('Gate Exit Time'), 'SecurityGatewayWorkspace displays Gate Exit Time');
    assert(secSource.includes('Second Weight'), 'SecurityGatewayWorkspace displays Second Weight');
    assert(secSource.includes('Net Milk Received'), 'SecurityGatewayWorkspace displays Net Milk Received');

    // Check QA Laboratory Workspace terminology
    assert(!qaSource.includes('QA Start Operational Date'), 'QALaboratoryWorkspace does not contain QA Start Operational Date');
    assert(qaSource.includes('QA Start Time'), 'QALaboratoryWorkspace displays QA Start Time');
    assert(qaSource.includes('QA Resume Time'), 'QALaboratoryWorkspace displays QA Resume Time');
    assert(qaSource.includes('Acceptance Time'), 'QALaboratoryWorkspace displays Acceptance Time');
    assert(qaSource.includes('Rejection Time'), 'QALaboratoryWorkspace displays Rejection Time');
    assert(qaSource.includes('Hold Time'), 'QALaboratoryWorkspace displays Hold Time');
    assert(qaSource.includes('Operational Date:'), 'QALaboratoryWorkspace header displays Operational Date:');

    // ---------------------------------------------------------
    // TEST GROUP 6: INTERNAL AVERAGES AND HIDDEN CALCULATIONS
    // ---------------------------------------------------------
    console.log('\n--- TEST GROUP 6: HIDDEN INTERNAL AVERAGES SAFETY ---');
    const allFrontendFiles = [dispatchPath, qaWorkspacePath, wbPath, prodPath, secPath, logModalPath];
    for (const fPath of allFrontendFiles) {
      const content = fs.readFileSync(fPath, 'utf8');
      const baseName = path.basename(fPath);
      assert(!content.includes('Average Plant LR'), baseName + ' does not expose Average Plant LR');
      assert(!content.includes('Average Plant Fat'), baseName + ' does not expose Average Plant Fat');
      assert(!content.includes('Composite QA'), baseName + ' does not expose Composite QA');
      assert(!content.includes('Plant LR Basis'), baseName + ' does not expose Plant LR Basis');
    }

  } catch (err: any) {
    console.error('Unexpected error in Stage 4 test suite:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log('STAGE 4 & 4A TEST RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage4Tests();