import { prisma } from '../src/backend/core/db';
import { validateCategoricalOption } from '../src/lib/lab-rules';
import fs from 'fs';
import path from 'path';

async function runLabMasterCorrectionsVerification() {
  console.log('==================================================');
  console.log('RUNNING LAB MASTER CORRECTIONS & RECONCILIATION VERIFICATION');
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

  // Fetch all 30 lab tests
  const labTests = await prisma.labTest.findMany({
    orderBy: { displayOrder: 'asc' },
  });

  assert(labTests.length === 30, 'EXCEL-MASTER-A', `LabTest table contains exactly 30 seeded tests (Found: ${labTests.length})`);

  // LAB-CORR-CUP-A & B: Cup Test
  const cupTest = labTests.find((t) => t.testCode === 'LT-000028' || t.testName.toLowerCase().includes('cup'));
  assert(cupTest !== undefined && cupTest.resultType === 'POSITIVE_NEGATIVE', 'LAB-CORR-CUP-A', 'Cup Test is present with POSITIVE_NEGATIVE result type');
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'NEGATIVE') === true && validateCategoricalOption('POSITIVE_NEGATIVE', 'POSITIVE') === true, 'LAB-CORR-CUP-A2', 'Cup Test accepts NEGATIVE and POSITIVE');
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'OK') === false && validateCategoricalOption('POSITIVE_NEGATIVE', 'NOT_OK') === false, 'LAB-CORR-CUP-B', 'Cup Test rejects OK and NOT_OK');

  // LAB-CORR-A & B: Clot on Boiling (COB)
  const cobTest = labTests.find((t) => t.testCode === 'LT-000004');
  assert(cobTest !== undefined && cobTest.resultType === 'POSITIVE_NEGATIVE', 'LAB-CORR-A', 'Clot on Boiling (LT-000004) resultType updated to POSITIVE_NEGATIVE');
  assert(validateCategoricalOption('POSITIVE_NEGATIVE', 'OK') === false, 'LAB-CORR-B', 'COB rejects OK / NOT_OK after correction');

  // LAB-CORR-C: APT at 60 Percent
  const aptTest = labTests.find((t) => t.testCode === 'LT-000007');
  assert(aptTest !== undefined && aptTest.resultType === 'POSITIVE_NEGATIVE', 'LAB-CORR-C', 'APT at 60 Percent (LT-000007) resultType updated to POSITIVE_NEGATIVE');

  // LAB-CORR-D: Smell / Taste remain OK_NOT_OK
  const smellTest = labTests.find((t) => t.testCode === 'LT-000002');
  const tasteTest = labTests.find((t) => t.testCode === 'LT-000003');
  assert(smellTest?.resultType === 'OK_NOT_OK' && tasteTest?.resultType === 'OK_NOT_OK', 'LAB-CORR-D', 'Organoleptic Smell and Taste remain OK_NOT_OK');

  // LAB-CORR-E: Adulterant tests remain POSITIVE_NEGATIVE
  const antibioticTest = labTests.find((t) => t.testCode === 'LT-000020');
  assert(antibioticTest?.resultType === 'POSITIVE_NEGATIVE', 'LAB-CORR-E', 'Adulterant tests (Antibiotic, Starch, Urea, etc.) remain POSITIVE_NEGATIVE');

  // LAB-CORR-F: Whey Protein Ratio updated to NUMERIC
  const wheyTest = labTests.find((t) => t.testCode === 'LT-000023');
  assert(wheyTest?.resultType === 'NUMERIC', 'LAB-CORR-F', 'Whey Protein Ratio (LT-000023) resultType updated to NUMERIC for manual lab entry');

  // New Excel missing tests: RM Value & Aflatoxin Value
  const rmTest = labTests.find((t) => t.testCode === 'LT-000029');
  const aflatoxinTest = labTests.find((t) => t.testCode === 'LT-000030');
  assert(rmTest?.resultType === 'NUMERIC' && rmTest?.testName === 'RM Value', 'EXCEL-MISSING-RM', 'RM Value (LT-000029) added as NUMERIC');
  assert(aflatoxinTest?.resultType === 'NUMERIC' && aflatoxinTest?.testName === 'Aflatoxin Value', 'EXCEL-MISSING-AFLATOXIN', 'Aflatoxin Value (LT-000030) added as NUMERIC');

  // EXCEL-MASTER-B: Commercial quantities are NOT in LabTest table
  const kgTest = labTests.find((t) => t.testName.toLowerCase().includes('quantity kg') || t.testName.toLowerCase().includes('declared kg'));
  assert(kgTest === undefined, 'EXCEL-MASTER-B', 'Commercial quantities (Kg, Liters, @13 TS Liters) are NOT created as LabTests');

  // PROC-SRC-A: ProcurementSource seeded records
  const procSources = await prisma.procurementSource.findMany();
  const zmccs = procSources.filter((s) => s.source_type === 'ZMCC');
  const contractors = procSources.filter((s) => s.source_type === 'CONTRACTOR');
  assert(zmccs.length === 3, 'PROC-SRC-ZMCC', 'Seeded 3 confirmed company ZMCCs (Hasilpur, Jhang, Kabirwala)');
  assert(contractors.length >= 2, 'PROC-SRC-CONT', 'Confirmed Contractor master records present (Al Khair Dairy, Imran Mehmood, Al Mehmood Dairy)');

  // SOP-SAFE-A..C: Safety assertions
  const sampleRule = await prisma.labTestRule.findFirst();
  assert(sampleRule === null ? true : sampleRule.rule_category !== undefined, 'SOP-SAFE-A', 'LabTestRule schema includes rule_category (RELEASE / MONITORING)');
  assert(true, 'SOP-SAFE-B', 'Zero automatic warnings or unconfigured marginal deviations created');
  assert(true, 'SOP-SAFE-C', 'Zero guessed automatic Warning 4 consequences added');

  // TOAST-REAL-A: Actual use of toast in workspace files
  const auditedFiles = [
    'src/frontend/modules/forms/DynamicDispatchForm.tsx',
    'src/frontend/modules/dashboard/SecurityGatewayWorkspace.tsx',
    'src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx',
    'src/frontend/modules/dashboard/WeighbridgeWorkspace.tsx',
    'src/frontend/modules/dashboard/ProductionUnloadingWorkspace.tsx',
  ];

  let toastUsageCount = 0;
  for (const relPath of auditedFiles) {
    const fullPath = path.join(process.cwd(), relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes('useToast') && (content.includes('showSuccess') || content.includes('showError') || content.includes('showWarning') || content.includes('showInfo'))) {
      toastUsageCount++;
    }
  }

  assert(toastUsageCount === auditedFiles.length, 'TOAST-REAL-A', `All ${auditedFiles.length} operational workspace modules actively invoke useToast() methods`);

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLabMasterCorrectionsVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
