import { execSync } from 'child_process';

const scripts = [
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
  'scripts/test_qa_chemist_workflow.ts',
  'scripts/test_weighbridge_operator_workflow.ts',
  'scripts/test_production_unloading_workflow.ts',
  'scripts/test_tare_silo_receipt_workflow.ts',
  'scripts/test_production_silo_issue_workflow.ts',
  'scripts/test_silo_inventory_foundation.ts',
  'scripts/test_mpd_dispatch_form_validation.ts',
];

console.log('🚀 RUNNING ALL MANDATED REGRESSION SUITES...\n');
let passedCount = 0;

for (const script of scripts) {
  try {
    console.log(`▶ Running ${script}...`);
    execSync(`npx tsx ${script}`, { stdio: 'inherit', cwd: 'D:/MilkReceptionApp' });
    console.log(`✅ ${script} PASSED!\n`);
    passedCount++;
  } catch {
    console.error(`❌ ${script} FAILED!`);
    process.exit(1);
  }
}

console.log(`========================================`);
console.log(`ALL REGRESSION SUITES SUMMARY: ${passedCount} / ${scripts.length} PASSED 100%`);
console.log(`========================================\n`);
