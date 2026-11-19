/**
 * Read-only: finds tankers whose saved plant receipt (silo receipt and reconciliation) does not match their weighbridge
 * ticket, for example after a weight correction made before 11 Nov, when corrections did not update the receipt.
 * Changes nothing.  Run on the VM:  node scripts\check-stale-receipts.js > stale-receipts.txt
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
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const { rows } = await c.query(`
      WITH rcpt AS (
        SELECT visit_id, SUM(quantity_kg) AS kg, SUM(quantity_liters) AS liters, SUM(plant_final_at_13ts_liters) AS at13,
               MAX(plant_composite_lr) AS lr
        FROM silo_inventory_transaction WHERE transaction_type::text = 'RECEIPT' AND visit_id IS NOT NULL GROUP BY visit_id
      )
      SELECT to_char(v.operational_date, 'DD Mon YYYY') AS day, v.visit_number AS visit, v.vehicle_number AS vehicle,
             COALESCE(ps.name, '') AS source,
             wt.gross_weight_kg AS first_kg, wt.tare_weight_kg AS second_kg,
             (wt.gross_weight_kg - wt.tare_weight_kg) AS ticket_net_kg,
             ROUND(r.kg, 2) AS receipt_kg,
             ROUND((wt.gross_weight_kg - wt.tare_weight_kg) - r.kg, 2) AS kg_off,
             ROUND(r.liters, 0) AS receipt_l,
             ROUND((wt.gross_weight_kg - wt.tare_weight_kg) / (1 + r.lr / 1000), 0) AS ticket_l,
             ROUND(fdr.received_gross_liters, 0) AS report_l,
             v.correction_count AS corrections
      FROM vehicle_visit v
      JOIN weight_ticket wt ON wt.visit_id = v.id
      JOIN rcpt r ON r.visit_id = v.id
      LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id
      LEFT JOIN procurement_source ps ON ps.id = v.procurement_source_id
      WHERE wt.gross_weight_kg IS NOT NULL AND wt.tare_weight_kg IS NOT NULL
        AND ABS((wt.gross_weight_kg - wt.tare_weight_kg) - r.kg) > 5
      ORDER BY v.operational_date, v.id`);
    const all = await c.query(`SELECT COUNT(DISTINCT visit_id)::int AS n FROM silo_inventory_transaction WHERE transaction_type::text = 'RECEIPT' AND visit_id IS NOT NULL`);
    console.log(`Tankers with a plant receipt: ${all.rows[0].n}. Receipt weight differs from the weighbridge ticket by more than 5 kg: ${rows.length}`);
    console.log('ticket_l = what the plant really received by the ticket; receipt_l / report_l = what reports show now.\n');
    console.log(table(rows));
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
