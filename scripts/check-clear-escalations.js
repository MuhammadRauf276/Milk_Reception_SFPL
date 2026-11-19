/**
 * Read-only: finds records sent to a senior even though the system result and the person's decision agreed.
 * Changes nothing.  Run on the VM:  node scripts\check-clear-escalations.js > clear-escalations.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (v) => '  ' + v.map((x, i) => String(x ?? '').padEnd(w[i])).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (title, sql) => {
    const { rows } = await c.query(sql);
    console.log(`\n== ${title}\n${table(rows)}`);
  };
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');

    // 1. Dispatch: system PASS, person ACCEPT, no exception, yet sent for approval.
    await q('1. Dispatches with system PASS and person ACCEPT that still went for approval (by month and source)', `
      SELECT to_char(v.operational_date, 'YYYY-MM') AS month, ps.name AS source, v.approval_status,
             COUNT(*) AS dispatches
      FROM vehicle_visit v JOIN procurement_source ps ON ps.id = v.procurement_source_id
      WHERE v.dispatch_system_outcome = 'PASS' AND COALESCE(v.dispatch_person_decision, 'ACCEPT') = 'ACCEPT'
        AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(v.dispatch_exception_reasons) = 'array' THEN v.dispatch_exception_reasons END), 0) = 0
        AND v.approval_status IN ('PENDING', 'APPROVED', 'RETURNED')
      GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`);

    await q('   All dispatches with a decision, for comparison', `
      SELECT v.dispatch_system_outcome AS system, COALESCE(v.dispatch_person_decision, '-') AS person, v.approval_status, COUNT(*) AS dispatches
      FROM vehicle_visit v WHERE v.dispatch_system_outcome IS NOT NULL
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);

    // 2. Plant QA: the QAE rejected and the only reasons were a missing test or a seal mismatch (system also says reject).
    await q('2. Plant QA portions the QAE rejected that went up only for a missing test or seal mismatch', `
      SELECT p.id AS portion, v.visit_number, v.vehicle_number, p.manager_review_status AS review,
             p.manager_requested_decision AS qae_decision, p.exception_reasons::text AS reasons
      FROM visit_portion p JOIN vehicle_visit v ON v.id = p.visit_id
      WHERE p.manager_review_status IN ('PENDING', 'APPROVED', 'REJECTED')
        AND p.manager_requested_decision = 'REJECTED'
        AND jsonb_typeof(p.exception_reasons) = 'array'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(p.exception_reasons) r
          WHERE r NOT IN ('MISSING_FIELD', 'SEAL_MISMATCH') AND r NOT LIKE 'RULE_FAIL:%'
        )
      ORDER BY p.id DESC LIMIT 50`);

    // 3. Plant QA: accepted on warning, sent up only because the month's warning limit was reached.
    await q('3. Plant QA portions the QAE accepted that went up only for the monthly warning limit', `
      SELECT p.id AS portion, v.visit_number, v.vehicle_number, p.manager_review_status AS review, p.exception_reasons::text AS reasons
      FROM visit_portion p JOIN vehicle_visit v ON v.id = p.visit_id
      WHERE p.manager_review_status IN ('PENDING', 'APPROVED', 'REJECTED')
        AND p.manager_requested_decision = 'ACCEPTED'
        AND jsonb_typeof(p.exception_reasons) = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.exception_reasons) r WHERE r LIKE 'MTD_WARNING_LIMIT_REACHED%')
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(p.exception_reasons) r
          WHERE r NOT LIKE 'MTD_WARNING_LIMIT_REACHED%' AND r NOT LIKE 'RULE_FAIL:%'
        )
      ORDER BY p.id DESC LIMIT 50`);

    // 4. Mobile Tester shop: everything clear except the phone was away from the shop.
    await q('4. Shop collections sent up only because the phone was away from the shop', `
      SELECT c.collection_number, to_char(c.operational_date, 'YYYY-MM-DD') AS day, c.person_decision, c.system_outcome, c.review_status
      FROM mot_shop_collection c
      WHERE c.review_status IN ('PENDING', 'APPROVED', 'REJECTED')
        AND jsonb_typeof(c.exception_reasons) = 'array'
        AND c.exception_reasons::jsonb = '["AWAY_FROM_SHOP"]'::jsonb
      ORDER BY c.id DESC LIMIT 50`);

    await c.query('ROLLBACK');
    console.log('\nDone. Nothing was changed.');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Check failed:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
