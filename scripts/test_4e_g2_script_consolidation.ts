import fs from 'fs';
import path from 'path';

async function run4EG2Tests() {
  console.log('================================================================================');
  console.log('STAGE 4E-G2: SCRIPT CONSOLIDATION & CALCULATION RETIREMENT TEST SUITE');
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

  // G2-1: operationalCalculations.ts is physically absent on disk
  const opCalcPath = path.join(__dirname, '../src/backend/services/operationalCalculations.ts');
  assert(!fs.existsSync(opCalcPath), 'G2-1: operationalCalculations.ts is physically absent on disk');

  // G2-2: Zero runtime sources in src/ or tests in tests/ import operationalCalculations
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

  const srcAndTestFiles = walk(path.join(__dirname, '../src')).concat(walk(path.join(__dirname, '../tests')));
  const opCalcConsumers = srcAndTestFiles.filter((f) => {
    const content = fs.readFileSync(f, 'utf8');
    return content.includes('operationalCalculations');
  });
  assert(
    opCalcConsumers.length === 0,
    'G2-2: Zero runtime sources in src/ or tests in tests/ import operationalCalculations'
  );

  // G2-3: Durable canonical architecture suite exists
  const canonicalArchPath = path.join(__dirname, '../scripts/test_canonical_architecture.ts');
  assert(
    fs.existsSync(canonicalArchPath),
    'G2-3: Durable canonical architecture regression test (scripts/test_canonical_architecture.ts) exists on disk'
  );

  // G2-4: Master regression runner includes test_date_filters_and_decisions.ts
  const runnerPath = path.join(__dirname, '../scripts/run_all_regressions.ts');
  const runnerSrc = fs.existsSync(runnerPath) ? fs.readFileSync(runnerPath, 'utf8') : '';
  assert(
    runnerSrc.includes('scripts/test_date_filters_and_decisions.ts') &&
    !runnerSrc.includes('scripts/test_legacy_calculation_migration.ts'),
    'G2-4: run_all_regressions.ts includes test_date_filters_and_decisions.ts and excludes retired test_legacy_calculation_migration.ts'
  );

  // G2-5: Deleted obsolete one-off and transitional scripts are absent
  const deletedScripts = [
    'audit_keys_and_apis.js',
    'find_all_keys.js',
    'find_auth_session.js',
    'find_mpd_files.ts',
    'find_mpd_refs.ts',
    'find_status_strings.ts',
    'find_system_key.ts',
    'find_zonal_components.js',
    'find_zonal_usages.js',
    'trace_zmcc_views.js',
    'verify_all_zmcc_keys.js',
    'verify_zonal_keys.js',
    'inspect_api_responses.js',
    'inspect_last_visit.js',
    'inspect_zonal_api_rows.js',
    'inspect_disposable_schema.ts',
    'inspect_visit_numbers.ts',
    'inspect_db_silo_tx.ts',
    'delete_test_visit.js',
    'drop_system_key_column.ts',
    'migrate_lab_test_system_key.ts',
    'migrate_workflow_statuses.ts',
    'fix_postgres_sequences.js',
    'backfill_reception_numbers.ts',
    'test_legacy_calculation_migration.ts',
    'test_4e_a_canonical_boundaries.ts',
    'test_4e_b_role_route_canonicalization.ts',
    'test_4e_c_dead_code_removal.ts',
    'test_4e_d_legacy_management_retirement.ts',
    'test_4e_e_audit_fleet_cleanup.ts',
    'test_4e_f_admin_api_consolidation.ts',
    'test_4e_g1_repository_cleanup.ts',
  ];

  const allDeletedAbsent = deletedScripts.every((s) => !fs.existsSync(path.join(__dirname, '../scripts', s)));
  assert(allDeletedAbsent, `G2-5: All ${deletedScripts.length} retired transitional and obsolete scripts are physically absent on disk`);

  // G2-6: package.json references no deleted scripts
  const pkgPath = path.join(__dirname, '../package.json');
  const pkgSrc = fs.readFileSync(pkgPath, 'utf8');
  let pkgHasDeleted = false;
  deletedScripts.forEach((s) => {
    if (pkgSrc.includes(s)) {
      pkgHasDeleted = true;
      console.error(`package.json contains deleted script reference: ${s}`);
    }
  });
  assert(!pkgHasDeleted, 'G2-6: package.json contains zero references to deleted script files');

  // G2-7: CI workflow references no deleted scripts
  const ciPath = path.join(__dirname, '../.github/workflows/ci.yml');
  const ciSrc = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf8') : '';
  let ciHasDeleted = false;
  deletedScripts.forEach((s) => {
    if (ciSrc.includes(s)) {
      ciHasDeleted = true;
      console.error(`ci.yml contains deleted script reference: ${s}`);
    }
  });
  assert(!ciHasDeleted, 'G2-7: .github/workflows/ci.yml contains zero references to deleted script files');

  // G2-8: CANONICAL-CODE-MAP.md reflects Stage 4E-G2 retirements
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  const mapSrc = fs.readFileSync(mapPath, 'utf8');
  assert(
    mapSrc.includes('Stage 4E-G2 Script & Test Consolidation') &&
    mapSrc.includes('operationalCalculations.ts') &&
    mapSrc.includes('DELETED (4E-G2)'),
    'G2-8: CANONICAL-CODE-MAP.md accurately documents Stage 4E-G2 retirements'
  );

  // G2-9: test_date_filters_and_decisions.ts has zero legacy calculation imports
  const dateFilterScriptPath = path.join(__dirname, '../scripts/test_date_filters_and_decisions.ts');
  const dateFilterScriptSrc = fs.readFileSync(dateFilterScriptPath, 'utf8');
  assert(
    !dateFilterScriptSrc.includes('operationalCalculations') &&
    !dateFilterScriptSrc.includes('computeVehicleDecisionSummary'),
    'G2-9: test_date_filters_and_decisions.ts contains zero legacy calculation imports'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EG2Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
