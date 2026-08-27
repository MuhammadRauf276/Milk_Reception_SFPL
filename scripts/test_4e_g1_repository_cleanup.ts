import fs from 'fs';
import path from 'path';

async function run4EG1Tests() {
  console.log('================================================================================');
  console.log('STAGE 4E-G1: REPOSITORY CLEANUP & PROVEN LEFTOVER REMOVAL TEST SUITE');
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

  // G1: next.config.js exists and next.config.mjs is absent
  const nextConfigJs = path.join(__dirname, '../next.config.js');
  const nextConfigMjs = path.join(__dirname, '../next.config.mjs');
  assert(
    fs.existsSync(nextConfigJs) && !fs.existsSync(nextConfigMjs),
    'G1: next.config.js exists and redundant next.config.mjs is physically absent'
  );

  // G2: Proven dead source files are physically absent
  const durationsPath = path.join(__dirname, '../src/backend/core/durations.ts');
  const secWorkforcePath = path.join(__dirname, '../src/frontend/modules/dashboard/SecurityWorkforceTable.tsx');
  const isometricIconPath = path.join(__dirname, '../src/frontend/modules/shared/IsometricIcon.tsx');
  const keyUtilsPath = path.join(__dirname, '../src/lib/key-utils.ts');
  assert(
    !fs.existsSync(durationsPath) &&
    !fs.existsSync(secWorkforcePath) &&
    !fs.existsSync(isometricIconPath) &&
    !fs.existsSync(keyUtilsPath),
    'G2: Proven dead source files (durations, SecurityWorkforceTable, IsometricIcon, key-utils) are physically absent'
  );

  // G3: Zero runtime sources in src/ import or reference deleted files
  function walk(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'node_modules' && item.name !== '.next' && item.name !== '.git') {
          results = results.concat(walk(full));
        }
      } else if (item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }

  const srcFiles = walk(path.join(__dirname, '../src'));
  const deletedReferences = srcFiles.filter((f) => {
    const content = fs.readFileSync(f, 'utf8');
    return (
      content.includes('SecurityWorkforceTable') ||
      content.includes('IsometricIcon') ||
      content.includes('calculateStageDurations') ||
      content.includes('warnDuplicateKeys')
    );
  });
  assert(
    deletedReferences.length === 0,
    'G3: Zero runtime sources in src/ import or reference deleted components or helpers'
  );

  // G4: Deleted scratch files do not exist
  const scratchAuditBl = path.join(__dirname, '../scratch/audit_bl.ts');
  const scratchCheckLhr = path.join(__dirname, '../scratch/check_lhr.js');
  assert(
    !fs.existsSync(scratchAuditBl) && !fs.existsSync(scratchCheckLhr),
    'G4: Tracked scratch investigative files are removed'
  );

  // G5: Draft ADR is physically absent
  const draftAdrPath = path.join(__dirname, '../docs/architecture/ADR-DRAFT-dispatch-quantity-measurement.md');
  assert(
    !fs.existsSync(draftAdrPath),
    'G5: Non-authoritative draft ADR (ADR-DRAFT-dispatch-quantity-measurement.md) is physically absent'
  );

  // G6: docs/architecture/README.md contains no broken links to deleted draft ADR
  const readmePath = path.join(__dirname, '../docs/architecture/README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  assert(
    !readmeContent.includes('ADR-DRAFT-dispatch-quantity-measurement.md'),
    'G6: docs/architecture/README.md contains no broken links to deleted draft ADR'
  );

  // G7: operationalCalculations.ts is retained for transitional script support with 0 runtime consumers
  const opCalcPath = path.join(__dirname, '../src/backend/services/operationalCalculations.ts');
  const opCalcSrcConsumers = srcFiles.filter((f) => {
    if (f === opCalcPath) return false;
    const c = fs.readFileSync(f, 'utf8');
    return c.includes('operationalCalculations');
  });
  assert(
    fs.existsSync(opCalcPath) && opCalcSrcConsumers.length === 0,
    'G7: operationalCalculations.ts is retained on disk with zero runtime src/ consumers'
  );

  // G8: Retained compatibility routes exist and redirect properly
  const adminPagePath = path.join(__dirname, '../src/app/admin/lab-tests/page.tsx');
  const weighbridgePagePath = path.join(__dirname, '../src/app/weighbridge/page.tsx');
  assert(
    fs.existsSync(adminPagePath) && fs.existsSync(weighbridgePagePath),
    'G8: Retained compatibility routes (/admin/lab-tests and /weighbridge) exist on disk'
  );

  // G9: CANONICAL-CODE-MAP reflects Stage 4E-G1 cleanup
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  const mapContent = fs.readFileSync(mapPath, 'utf8');
  assert(
    mapContent.includes('Stage 4E-G1 Repository-Wide Cleanup') &&
    mapContent.includes('durations.ts') &&
    mapContent.includes('SecurityWorkforceTable.tsx'),
    'G9: CANONICAL-CODE-MAP documents Stage 4E-G1 cleanup'
  );

  // G10: Canonical authority invariants preserved
  const vehicleQtyPath = path.join(__dirname, '../src/backend/services/vehicleQuantityService.ts');
  const vehicleQtySrc = fs.existsSync(vehicleQtyPath) ? fs.readFileSync(vehicleQtyPath, 'utf8') : '';
  assert(
    vehicleQtySrc.includes('LT-000008') && vehicleQtySrc.includes('LT-000026'),
    'G10: Plant LR (LT-000008) and Plant Fat (LT-000026) authority strictly preserved'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EG1Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
