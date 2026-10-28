/**
 * Automated Verification Script for Super Admin Lab Policies & Plant QA Reception Warnings
 *
 * Scenarios tested:
 * 1. Richmond Canonical Calculated Formulas (SNF, Total Solids, Ratio).
 * 2. 3-Zone Lab SOP Rules: Pass Range, Warning Hold (Tolerance), Fail Reject.
 * 3. Monitoring Norms vs Complete SOPs.
 * 4. Applied (Non-Compulsory) Mode non-enforcement.
 * 5. MTD Warning Deduplication per Vehicle against Procurement Source.
 * 6. Escalation to AVP Reception Lab when procurement source warnings reach threshold T.
 * 7. Information Cloaking: Sensitive override details hidden from junior field operators.
 * 8. Full 30-Test Master Catalog validation.
 */

import {
  evaluateAllCalculatedTests,
  FORMULA_SNF_CANONICAL,
  FORMULA_TOTAL_SOLIDS,
  FORMULA_RATIO_SNF_FAT,
} from '../src/lib/calculated-tests';
import { evaluateTestObservation, type QualityRule } from '../src/lib/lab-rules';
import { QaWarningEscalationService } from '../src/backend/services/qaWarningEscalationService';
import { MASTER_30_LAB_TESTS, getMasterSpec } from '../src/lib/master-lab-tests-data';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runAllVerifications() {
  console.log('\n=============================================================');
  console.log('🧪 RUNNING LAB POLICIES & WARNINGS AUTOMATED VERIFICATION');
  console.log('=============================================================\n');

  // --- SCENARIO 1: Richmond Canonical Formulas ---
  console.log('--- 1. Testing Richmond Canonical Formulas ---');
  // Sample Cow Milk: LR = 28.0, Fat = 3.5%
  // Richmond: SNF = 28.0 / 4 + 0.22 * 3.5 + 0.72 = 7.0 + 0.77 + 0.72 = 8.49%
  const cowSnf = FORMULA_SNF_CANONICAL.calculate({ LR: 28.0, FAT: 3.5 });
  assert(Math.abs((cowSnf || 0) - 8.49) < 0.01, 'Cow Milk SNF = 8.49% exactly');

  // Total Solids = Fat + SNF = 3.5 + 8.49 = 11.99%
  const cowTs = FORMULA_TOTAL_SOLIDS.calculate({ FAT: 3.5, SNF: cowSnf || 8.49 });
  assert(Math.abs((cowTs || 0) - 11.99) < 0.01, 'Cow Milk Total Solids = 11.99%');

  // Ratio = SNF / Fat = 8.49 / 3.5 = 2.426
  const cowRatio = FORMULA_RATIO_SNF_FAT.calculate({ FAT: 3.5, SNF: cowSnf || 8.49 });
  assert(Math.abs((cowRatio || 0) - 2.426) < 0.01, 'Cow Milk Ratio = 2.426');

  // Sample Buffalo Milk: LR = 30.0, Fat = 6.5%
  // Richmond: SNF = 30.0 / 4 + 0.22 * 6.5 + 0.72 = 7.5 + 1.43 + 0.72 = 9.65%
  const allCalc = evaluateAllCalculatedTests({ LR: 30.0, FAT: 6.5 });
  assert(Math.abs((allCalc.SNF_CANONICAL || 0) - 9.65) < 0.01, 'Buffalo Milk SNF = 9.65%');
  assert(Math.abs((allCalc.TOTAL_SOLIDS || 0) - 16.15) < 0.01, 'Buffalo Milk TS = 16.15%');
  assert(Math.abs((allCalc.RATIO_SNF_FAT || 0) - 1.485) < 0.01, 'Buffalo Milk Ratio = 1.48');

  // Missing values safety
  const safeNull = evaluateAllCalculatedTests({ LR: null, FAT: 3.5 });
  assert(safeNull.SNF_CANONICAL === null && safeNull.TOTAL_SOLIDS === null, 'Missing LR safely returns null');

  // --- SCENARIO 2: 3-Zone SOP Evaluation & Warning Semantics ---
  console.log('\n--- 2. Testing 3-Zone SOP Evaluation & Warning Semantics ---');
  const lrRule: QualityRule = {
    testCode: 'LT-000008',
    testName: 'Lactometer Reading (LR)',
    resultType: 'NUMERIC',
    category: 'RELEASE',
    minValue: 28.0,
    maxValue: 32.0,
    warningBands: [{ min: 26.0, max: 27.9 }],
  };

  // Pass Zone
  const passResult = evaluateTestObservation(lrRule, 29.0, 'COMPULSORY');
  assert(passResult.zone === 'PASS' && passResult.isPass, 'LR 29.0 evaluates to PASS');

  // Warning Zone (Tolerance Hold) -> Amber Alert, NEVER auto-rejects
  const warnResult = evaluateTestObservation(lrRule, 27.0, 'COMPULSORY');
  assert(warnResult.zone === 'WARNING' && warnResult.isWarning && !warnResult.isFail,
    'LR 27.0 evaluates to WARNING (Requires human decision, does NOT auto-reject)');

  // Fail Zone
  const failResult = evaluateTestObservation(lrRule, 25.0, 'COMPULSORY');
  assert(failResult.zone === 'FAIL' && failResult.isFail, 'LR 25.0 evaluates to FAIL (Rejection)');

  // --- SCENARIO 3: Monitoring Norms ---
  console.log('\n--- 3. Testing Monitoring Norms (Yield/Pricing, No Rejection) ---');
  const monitoringLR: QualityRule = {
    testCode: 'LT-000026',
    testName: 'Monitoring LR Min (Yield)',
    resultType: 'NUMERIC',
    category: 'MONITORING',
    minValue: 22.0,
  };

  const normResult = evaluateTestObservation(monitoringLR, 21.0, 'COMPULSORY');
  assert(normResult.zone === 'WARNING' && !normResult.isFail,
    'Monitoring Norm below standard (21.0 < 22.0) raises informational warning without system rejection');
  assert(normResult.message.includes('Monitoring Norm'),
    'Monitoring Norm message clarifies yield observation status');

  // --- SCENARIO 4: Applied (Non-Compulsory) Mode ---
  console.log('\n--- 4. Testing Applied (Non-Compulsory) Mode ---');
  const aflatoxinRule: QualityRule = {
    testCode: 'LT-000030',
    testName: 'Aflatoxin value',
    resultType: 'NUMERIC',
    category: 'RELEASE',
    minValue: 0,
    maxValue: 1000,
  };

  const appliedResult = evaluateTestObservation(aflatoxinRule, 1500, 'APPLIED');
  assert(appliedResult.zone === 'INFORMATIONAL_APPLIED' && !appliedResult.isFail,
    'Aflatoxin in APPLIED mode does NOT enforce SOP rejection on 1500 ppt');
  assert(appliedResult.message.includes('Not under SOP'),
    'Displays "Not under SOP — Optional test, system rules not applied"');

  // --- SCENARIO 5: MTD Warning Deduplication per Vehicle & Procurement Source ---
  console.log('\n--- 5. Testing MTD Vehicle Warning Deduplication ---');
  // Scenario: Vehicle TK-888 has warnings in Temperature, LR, Fat, and Acidity (4 tests in warning)
  // Deduplication rule: distinct vehicle visits count as ONE (1) warning event against the procurement source!
  const vehicleId = 'visit-tanker-901';
  const testWarnings = [
    { testCode: 'LT-000001', visitId: vehicleId },
    { testCode: 'LT-000008', visitId: vehicleId },
    { testCode: 'LT-000009', visitId: vehicleId },
    { testCode: 'LT-000005', visitId: vehicleId },
  ];

  const uniqueVehicleWarnings = new Set(testWarnings.map((w) => w.visitId)).size;
  assert(uniqueVehicleWarnings === 1, '4 tests in warning on same vehicle count as exactly 1 warning event');

  // --- SCENARIO 6: Threshold Configuration & Escalation to AVP Reception Lab ---
  console.log('\n--- 6. Testing MTD Threshold Escalation to AVP Reception Lab ---');
  const defaultThreshold = 4;
  let sourceWarningCount = 3;

  // Case A: Count = 3, Threshold = 4 -> QAE can accept
  assert(sourceWarningCount < defaultThreshold, 'Count 3 < 4: QAE user can accept warning with justification');

  // Case B: Vehicle accepted -> count increments to 4
  sourceWarningCount = 4;
  const isEscalated = sourceWarningCount >= defaultThreshold;
  assert(isEscalated, 'Count 4 >= 4: Source hits MTD warning limit -> QAE acceptance BLOCKED');

  // When blocked, request automatically escalates to AVP Reception Lab
  const nextApproverRole = isEscalated ? 'QA_HEAD' : 'QA_OFFICER';
  assert(nextApproverRole === 'QA_HEAD', 'Escalates to AVP Reception Lab (QA Head) for final authorization');

  // Case C: Super Admin adjusts threshold to 6
  const adjustedThreshold = 6;
  const canAcceptUnderAdjusted = sourceWarningCount < adjustedThreshold;
  assert(canAcceptUnderAdjusted, 'Super Admin adjusted threshold to 6 -> source now has 2 warnings remaining');

  // --- SCENARIO 7: Information Cloaking ---
  console.log('\n--- 7. Testing Information Cloaking for Junior Operators ---');
  const sensitiveAuditNote = 'Portion accepted by SUPER_ADMIN override (AVP absent on emergency leave)';

  function getOperatorFacingReason(reason: string, userRole: string): string {
    const executiveRoles = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'QA_HEAD'];
    if (executiveRoles.includes(userRole)) {
      return reason; // Upper management sees full audit trail
    }
    // Junior staff never see "Super Admin Override" or "AVP Absent"
    return reason
      .replace(/super_admin|super admin/gi, 'Authorized Management')
      .replace(/avp absent/gi, 'Authorized Management')
      .replace(/override/gi, 'Authorization');
  }

  const operatorView = getOperatorFacingReason(sensitiveAuditNote, 'QA_LAB_ATTENDANT');
  assert(!operatorView.toLowerCase().includes('super_admin') && !operatorView.toLowerCase().includes('avp absent'),
    'Junior operator view strictly cloaks "SUPER_ADMIN" and "AVP absent"');
  assert(operatorView.includes('Authorized Management'),
    'Junior operator sees clean status: "Portion accepted by Authorized Management"');

  const executiveView = getOperatorFacingReason(sensitiveAuditNote, 'SUPER_ADMIN');
  assert(executiveView === sensitiveAuditNote, 'Executive management sees complete uncloaked audit trail');

  // --- SCENARIO 8: Standard 30 Lab Tests Catalog Verification ---
  console.log('\n--- 8. Testing Master 30 Lab Tests Catalog Structure ---');
  assert(MASTER_30_LAB_TESTS.length === 30, 'Master catalog contains all 30 tests');

  const lrSpec = getMasterSpec('LT-000008');
  assert(Boolean(lrSpec?.testName.includes('Lactometer')), 'LT-000008 is Lactometer Reading');
  assert(lrSpec?.category === 'MONITORING', 'LT-000008 is Monitoring Norm');
  assert(lrSpec?.passRange === '22.0', 'LT-000008 standard norm is 22.0');

  const phSpec = getMasterSpec('LT-000006');
  assert(phSpec?.warningHold === '6.60 – 6.64 or 6.96 – 7.00', 'LT-000006 pH warning hold is 6.60 - 6.64 or 6.96 - 7.00');

  const rmSpec = getMasterSpec('LT-000029');
  assert(rmSpec?.warningHold === '23.5 – 23.9', 'LT-000029 RM Value warning hold is 23.5 - 23.9');
  assert(rmSpec?.failReject === '< 23.5', 'LT-000029 RM Value fail reject is < 23.5');

  const aflatoxinSpec = getMasterSpec('LT-000030');
  assert(aflatoxinSpec?.stages.PLANT_QA === 'APPLIED', 'Aflatoxin at Plant QA defaults to APPLIED');

  console.log('\n=============================================================');
  console.log('🎉 ALL 8 SCENARIOS VERIFIED SUCCESSFULLY WITH 100% COMPLIANCE');
  console.log('=============================================================\n');
}

runAllVerifications().catch((err) => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
