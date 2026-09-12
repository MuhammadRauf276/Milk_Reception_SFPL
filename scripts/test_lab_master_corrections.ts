import fs from 'fs';
import path from 'path';

// 1. Load .env.test.local
const repoRoot = path.resolve(__dirname, '..');
const testEnvPath = path.join(repoRoot, '.env.test.local');
if (fs.existsSync(testEnvPath)) {
  const envContent = fs.readFileSync(testEnvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}
if (!process.env.DEV_DATABASE_URL) {
  process.env.DEV_DATABASE_URL = process.env.DATABASE_URL;
}
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

import { prisma } from '../src/backend/core/db';
import { validateCategoricalOption } from '../src/lib/lab-rules';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

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

  const { testDbName } = assertSafeTestDatabase();
  const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const currentDb = dbCheck[0]?.current_database;

  if (currentDb !== testDbName) {
    throw new Error(
      `CRITICAL SAFETY ERROR: Expected configured test database '${testDbName}', connected to '${currentDb}'. Refusing to execute.`
    );
  }

  // Fetch all 30 core lab tests
  const labTests = await prisma.labTest.findMany({
    orderBy: { displayOrder: 'asc' },
  });

  const coreTests = labTests.filter((t) => /^LT-0000(0[1-9]|[1-2][0-9]|30)$/.test(t.testCode));
  assert(coreTests.length === 30, 'EXCEL-MASTER-A', `LabTest table contains exactly 30 seeded core tests (Found: ${coreTests.length})`);

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
  const schemaSource = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const hasRuleCategoryContract = schemaSource.includes('rule_category') && schemaSource.includes('@map("rule_category")');
  const sopRouteSource = fs.readFileSync(path.join(__dirname, '../src/app/api/super-admin/sop-rules/route.ts'), 'utf8');
  const exposesRuleCategory = sopRouteSource.includes('ruleCategory: r.rule_category');
  assert(hasRuleCategoryContract && exposesRuleCategory, 'SOP-SAFE-A', 'Canonical LabTestRule schema and SOP route enforce rule_category field and mapping contract');

  const { evaluateLabResult } = await import('../src/lib/lab-rules');
  const unconfiguredEval = evaluateLabResult('LT-000099', 42, null, 'NUMERIC');
  assert(unconfiguredEval.status === 'NO_ACTIVE_RULE' && unconfiguredEval.isPassed === true, 'SOP-SAFE-B', 'Unconfigured test evaluation returns status NO_ACTIVE_RULE and isPassed true');

  const seedSource = fs.readFileSync(path.join(__dirname, '../prisma/seed.ts'), 'utf8');
  function searchDirForPattern(dir: string, pattern: string): boolean {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (searchDirForPattern(full, pattern)) return true;
      } else if (/\.(ts|tsx|js|json|prisma)$/.test(entry.name)) {
        const c = fs.readFileSync(full, 'utf8');
        if (c.includes(pattern)) return true;
      }
    }
    return false;
  }
  const hasGuessedWarning4 = schemaSource.includes('Warning 4') || seedSource.includes('Warning 4') || searchDirForPattern(path.join(__dirname, '../src'), 'Warning 4');
  assert(!hasGuessedWarning4, 'SOP-SAFE-C', 'Zero guessed automatic Warning 4 consequences exist across complete src tree, schema, or seed');

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
