import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// Portable repository root resolution from script directory
const repoRoot = path.resolve(__dirname, '..');

if (!fs.existsSync(path.join(repoRoot, 'package.json'))) {
  console.error(`❌ Error: Invalid repository root. package.json not found at ${repoRoot}`);
  process.exit(1);
}

const isProbeMode = process.argv.includes('--probe-failure');

const suites: string[] = isProbeMode
  ? ['synthetic-probe-pass', 'synthetic-probe-fail']
  : [
      'scripts/test_ui_datetime_and_chronology.ts',
      'scripts/test_business_day_8am.ts',
      'scripts/test_operational_submission_audit.ts',
      'scripts/test_qa_decision_completeness.ts',
      'scripts/test_final_receipt_payment_date.ts',
      'scripts/test_final_auth_and_dev_selector.ts',
      'scripts/test_final_auth_migration.ts',
      'scripts/test_super_admin_finalization.ts',
      'scripts/test_super_admin_suite.ts',
      'scripts/test_real_admin_smoke_test.ts',
      'scripts/test_production_operator_login_routing.ts',
      'scripts/test_system_data_validation.ts',
      'scripts/test_operational_timestamp_chronology.ts',
      'scripts/test_qa_background_refresh.ts',
      'scripts/test_lab_master_corrections.ts',
      'scripts/test_lab_test_result_types.ts',
      'scripts/test_global_notifications.ts',
      'scripts/test_mpd_operator_page.ts',
      'scripts/test_security_operator_workflow.ts',
      'scripts/test_security_gate_exit_e2e.ts',
      'scripts/test_qa_plant_accountability.ts',
      'scripts/test_qa_chemist_workflow.ts',
      'scripts/test_weighbridge_operator_workflow.ts',
      'scripts/test_production_unloading_workflow.ts',
      'scripts/test_tare_silo_receipt_workflow.ts',
      'scripts/test_production_silo_issue_workflow.ts',
      'scripts/test_silo_inventory_foundation.ts',
      'scripts/test_mpd_dispatch_form_validation.ts',
      'scripts/test_mpd_source_visibility_and_testing_rules.ts',
      'scripts/test_contractor_dispatch_accountability.ts',
      'scripts/test_vehicle_quantity_service.ts',
      'scripts/test_production_quantity_stabilization.ts',
      'scripts/test_authoritative_final_receipt_integration.ts',
      'scripts/test_date_filters_and_decisions.ts',
      'scripts/test_stable_lab_test_assignment.ts',
      'scripts/test_configurable_qualitative_options.ts',
    ];

console.log(`==================================================`);
console.log(`🚀 MASTER REGRESSION RUNNER: ${suites.length} SUITES${isProbeMode ? ' (FAILURE PROBE MODE)' : ''}`);
console.log(`📂 Repository Root: ${repoRoot}`);
console.log(`==================================================\n`);

let passedCount = 0;
let failedCount = 0;
const failures: string[] = [];

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

suites.forEach((suite, index) => {
  const paddedIdx = String(index + 1).padStart(2, '0');
  const total = String(suites.length).padStart(2, '0');
  const suiteName = path.basename(suite);

  console.log(`[${paddedIdx}/${total}] ▶ Running ${suite}...`);

  let result;
  if (isProbeMode) {
    if (suite === 'synthetic-probe-pass') {
      result = spawnSync('node', ['-e', 'process.exit(0)'], { cwd: repoRoot, stdio: 'inherit', shell: true });
    } else {
      result = spawnSync('node', ['-e', 'process.exit(42)'], { cwd: repoRoot, stdio: 'inherit', shell: true });
    }
  } else {
    result = spawnSync(npxCmd, ['tsx', suite], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
  }

  if (result.status === 0 && !result.error) {
    console.log(`[${paddedIdx}/${total}] ✅ ${suiteName} ... PASS\n`);
    passedCount++;
  } else {
    console.error(`[${paddedIdx}/${total}] ❌ ${suiteName} ... FAIL\n`);
    failedCount++;
    failures.push(suite);
  }
});

console.log(`==================================================`);
console.log(`FINAL REGRESSION SUITES SUMMARY`);
console.log(`==================================================`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${failedCount}`);
console.log(`Total:  ${suites.length}`);

if (failedCount > 0) {
  console.error(`\n❌ FAILED SUITES (${failedCount}):`);
  failures.forEach((f) => console.error(`  - ${f}`));
  console.log(`==================================================\n`);
  process.exit(1);
} else {
  console.log(`\n✅ ALL ${passedCount} / ${suites.length} REGRESSION SUITES PASSED 100%`);
  console.log(`==================================================\n`);
  process.exit(0);
}
