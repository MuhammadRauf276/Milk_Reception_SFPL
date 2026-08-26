import fs from 'fs';
import path from 'path';

async function run4ECTests() {
  console.log('================================================================================');
  console.log('STAGE 4E-C: HIGH-CONFIDENCE DEAD-CODE REMOVAL TEST SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // C1: Deleted files no longer exist on disk
  const deletedFiles = [
    'src/frontend/modules/forms/DynamicQALabForm.tsx',
    'src/frontend/modules/shared/StageTimeline.tsx',
    'src/backend/controllers/auditController.ts',
    'src/lib/validations/production.ts',
  ];

  deletedFiles.forEach((f, idx) => {
    const full = path.join(__dirname, '..', f);
    assert(!fs.existsSync(full), `C1.${idx + 1}: ${f} no longer exists on disk`);
  });

  // C2: No import/reference to the deleted module paths remains in src/
  const deletedModulePaths = [
    'DynamicQALabForm',
    'StageTimeline',
    'auditController',
    'validations/production',
  ];

  function searchSrcForMatches(query: string): string[] {
    const matches: string[] = [];
    function walk(dir: string) {
      fs.readdirSync(dir).forEach((file) => {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) {
          if (file !== 'node_modules' && file !== '.git' && file !== '.next') walk(full);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes(query)) {
            matches.push(full);
          }
        }
      });
    }
    walk(path.join(__dirname, '../src'));
    return matches;
  }

  deletedModulePaths.forEach((mod, idx) => {
    const matches = searchSrcForMatches(mod);
    assert(
      matches.length === 0,
      `C2.${idx + 1}: Zero imports or references to ${mod} in src/`,
      matches.length > 0 ? `Found in: ${matches.join(', ')}` : undefined
    );
  });

  // C3: Retained candidate logActions.ts remains on disk
  const logActionsPath = path.join(__dirname, '../src/backend/actions/logActions.ts');
  assert(fs.existsSync(logActionsPath), 'C3: Retained candidate logActions.ts exists on disk');

  // C4: Canonical QA workspace still exists
  const qaWorkspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx');
  assert(fs.existsSync(qaWorkspacePath), 'C4: Canonical QA workspace (QALaboratoryWorkspace.tsx) exists');

  // C5: Canonical Production workspace and services still exist
  const prodWorkspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/ProductionUnloadingWorkspace.tsx');
  const siloServicePath = path.join(__dirname, '../src/backend/services/siloInventoryService.ts');
  assert(
    fs.existsSync(prodWorkspacePath) && fs.existsSync(siloServicePath),
    'C5: Canonical Production workspace (ProductionUnloadingWorkspace.tsx) and service (siloInventoryService.ts) exist'
  );

  // C6: Canonical Super Admin audit routes and pages still exist
  const auditApiPath = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  const auditPagePath = path.join(__dirname, '../src/app/super-admin/audit/page.tsx');
  assert(
    fs.existsSync(auditApiPath) && fs.existsSync(auditPagePath),
    'C6: Canonical Super Admin audit API and page exist'
  );

  // C7: Current ZMCC workspace and visit detail modal exist and remain legacy-free
  const zmccWorkspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx');
  const zmccModalPath = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerVisitDetailModal.tsx');
  assert(
    fs.existsSync(zmccWorkspacePath) && fs.existsSync(zmccModalPath),
    'C7: ZMCC workspace and ZMCCManagerVisitDetailModal exist'
  );

  // C8: CANONICAL-CODE-MAP documents Stage 4E-C Retired Dead Code
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  const mapSrc = fs.readFileSync(mapPath, 'utf8');
  assert(
    mapSrc.includes('Stage 4E-C Retired Dead Code') &&
    mapSrc.includes('DynamicQALabForm.tsx') &&
    mapSrc.includes('StageTimeline.tsx') &&
    mapSrc.includes('auditController.ts') &&
    mapSrc.includes('validations/production.ts') &&
    mapSrc.includes('logActions.ts') &&
    mapSrc.includes('RETAINED'),
    'C8: CANONICAL-CODE-MAP documents 4E-C retired dead code and retained candidate'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4ECTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
