import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// Portable repository root resolution from script directory
const repoRoot = path.resolve(__dirname, '..');

if (!fs.existsSync(path.join(repoRoot, 'package.json'))) {
  console.error(`❌ Error: Invalid repository root. package.json not found at ${repoRoot}`);
  process.exit(1);
}

// Load .env for DEV_DATABASE_URL
const devEnvPath = path.join(repoRoot, '.env');
if (fs.existsSync(devEnvPath)) {
  const envContent = fs.readFileSync(devEnvPath, 'utf8');
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
        if (key === 'DATABASE_URL' && !process.env.DEV_DATABASE_URL) {
          process.env.DEV_DATABASE_URL = val;
        }
      }
    }
  }
}

// Load .env.test.local for test runner
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
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
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
      'scripts/test_canonical_architecture.ts',
      'scripts/test_zmcc_authority_contracts.ts',
      'scripts/test_stable_lab_test_assignment.ts',
      'scripts/test_configurable_qualitative_options.ts',
      'scripts/test_4f_plant_contractor_manager_contracts.ts',
      'scripts/test_stage6d_mot_collection_offline_gps.ts',
      'scripts/test_stage6e_phe_arrivals.ts',
      'scripts/test_stage6f_zmcc_lab.ts',
      'scripts/test_stage6ga_test_policy.ts',
      'scripts/test_stage6gb_mot_journey_summary.ts',
      'scripts/test_stage6gc_zmcc_final_milk_metrics.ts',
      'scripts/test_stage6gd_zmcc_tank_receipt.ts',
      'scripts/test_stage6gd1_contractor_rmr_single_tank.ts',
      'scripts/test_stage6gd2_user_email_foundation.ts',
      'scripts/test_stage6gd3_local_supplier_onboarding.ts',
      'scripts/test_stage6gd4a_retrieval_scalability.ts',
    ];

console.log(`==================================================`);
console.log(`🚀 MASTER REGRESSION RUNNER: ${suites.length} SUITES${isProbeMode ? ' (FAILURE PROBE MODE)' : ''}`);
console.log(`📂 Repository Root: ${repoRoot}`);
console.log(`==================================================\n`);

let passedCount = 0;
let failedCount = 0;
const failures: string[] = [];

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

async function ensureCleanTestState(dbUrl: string) {
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const res = await client.query('SELECT id FROM procurement_source WHERE id > 6');
      if (res.rows.length > 0) {
        console.log(`🧹 Cleaning up ${res.rows.length} non-canonical test procurement sources...`);
        const ids = res.rows.map((r: any) => r.id);
        await client.query('DELETE FROM zmcc_tank_inventory_transaction WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_tank_receipt WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_contractor_arrival WHERE zmcc_id = ANY($1) OR contractor_source_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_mot_arrival WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_lab_session WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM mot_shop_collection WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM mot_journey WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM mot_vehicle WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM mot_profile WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_milk_source WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_route WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM zmcc_tank WHERE zmcc_id = ANY($1)', [ids]);
        await client.query('DELETE FROM dispatch_quantity_policy_snapshot WHERE procurement_source_id = ANY($1)', [ids]);
        await client.query('DELETE FROM qa_warning WHERE procurement_source_id = ANY($1)', [ids]);
        await client.query('DELETE FROM vehicle_visit WHERE procurement_source_id = ANY($1)', [ids]);
        await client.query('UPDATE users SET procurement_source_id = NULL WHERE procurement_source_id = ANY($1)', [ids]);
        await client.query('DELETE FROM procurement_source WHERE id = ANY($1)', [ids]);
        console.log('✅ Non-canonical test sources cleaned successfully.\n');
      }

      // Ensure Hasilpur tank has adequate stock for heavy sequential dispatch runs
      await client.query(`
        UPDATE zmcc_tank_inventory_transaction 
        SET quantity_liters = 350000.00, at_13ts_liters = 332661.54 
        WHERE idempotency_key = 'ZMCC_TANK_RECEIPT:OPENING_STOCK:1'
      `);
    } finally {
      await client.end().catch(() => {});
    }
  } catch (err) {
    console.warn('⚠️ Warning: Pre-flight test state maintenance encountered an error:', err);
  }
}

async function runAll() {
  if (!isProbeMode && process.env.DATABASE_URL) {
    await ensureCleanTestState(process.env.DATABASE_URL);
  }

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
}

runAll().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
