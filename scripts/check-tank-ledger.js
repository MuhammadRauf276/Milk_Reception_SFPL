/**
 * Read-only check of one ZMCC tank's stock ledger. Changes nothing.
 * Run on the VM from the app folder:   node scripts\check-tank-ledger.js TANK-01 > tank-check.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const code = process.argv[2] || 'TANK-01';

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.min(60, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))));
  const line = (v) => '  ' + v.map((x, i) => String(x ?? '').slice(0, 60).padEnd(w[i])).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (title, sql, params) => {
    const { rows } = await c.query(sql, params);
    console.log(`\n== ${title}\n${table(rows)}`);
    return rows;
  };
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const tanks = await q('1. Tank', `
      SELECT t.id, t.tank_code, s.name AS zmcc, t.capacity_liters
      FROM zmcc_tank t JOIN procurement_source s ON s.id = t.zmcc_id
      WHERE t.tank_code = $1`, [code]);
    if (!tanks.length) throw new Error(`No tank with code ${code}`);
    const ids = tanks.map((t) => t.id);

    await q('2. Stock from the ledger', `
      SELECT tank_id,
        SUM(CASE WHEN transaction_type::text IN ('RECEIPT','ADJUSTMENT_IN') THEN quantity_liters ELSE -quantity_liters END)::numeric(14,2) AS gross,
        SUM(CASE WHEN transaction_type::text IN ('RECEIPT','ADJUSTMENT_IN') THEN at_13ts_liters ELSE -at_13ts_liters END)::numeric(14,2) AS at13,
        COUNT(*) AS rows, COUNT(*) FILTER (WHERE at_13ts_liters IS NULL) AS rows_without_at13
      FROM zmcc_tank_inventory_transaction WHERE tank_id = ANY($1::bigint[]) GROUP BY tank_id`, [ids]);

    await q('3. Rows whose @13 TS is far from their litres (more than double, or above 20,000 L)', `
      SELECT id, transaction_type::text AS type, quantity_liters AS litres, at_13ts_liters AS at13, reference_type, reference_id,
             to_char(operational_timestamp AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI') AS at_pk, left(notes, 60) AS notes
      FROM zmcc_tank_inventory_transaction
      WHERE tank_id = ANY($1::bigint[])
        AND (at_13ts_liters > 20000 OR (quantity_liters > 0.01 AND at_13ts_liters > 2 * quantity_liters))
      ORDER BY id`, [ids]);

    await q('4. Last 40 ledger rows with running totals', `
      SELECT * FROM (
        SELECT id, transaction_type::text AS type, quantity_liters AS litres, at_13ts_liters AS at13,
               reference_type, reference_id,
               to_char(operational_timestamp AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI') AS at_pk,
               SUM(CASE WHEN transaction_type::text IN ('RECEIPT','ADJUSTMENT_IN') THEN quantity_liters ELSE -quantity_liters END)
                 OVER (ORDER BY operational_timestamp, id)::numeric(14,2) AS gross_after,
               SUM(CASE WHEN transaction_type::text IN ('RECEIPT','ADJUSTMENT_IN') THEN at_13ts_liters ELSE -at_13ts_liters END)
                 OVER (ORDER BY operational_timestamp, id)::numeric(14,2) AS at13_after
        FROM zmcc_tank_inventory_transaction WHERE tank_id = ANY($1::bigint[])
      ) x ORDER BY at_pk IS NULL, id DESC LIMIT 40`, [ids]);

    await q('5. Corrections that wrote adjustment rows (and the record they changed)', `
      SELECT x.id, x.transaction_type::text AS type, x.quantity_liters AS litres, x.at_13ts_liters AS at13,
             x.reference_type, x.reference_id, left(x.notes, 80) AS notes,
             to_char(x.created_at AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI:SS') AS written_pk
      FROM zmcc_tank_inventory_transaction x
      WHERE x.tank_id = ANY($1::bigint[]) AND x.transaction_type::text LIKE 'ADJUSTMENT%'
      ORDER BY x.id DESC LIMIT 20`, [ids]);

    await q('6. Audit rows written within 2 minutes of each large adjustment', `
      SELECT a.id, a.table_name, a.record_id, a.action,
             to_char(a.created_at AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI:SS') AS at_pk,
             left(a.old_values::text, 300) AS old_values, left(a.new_values::text, 300) AS new_values
      FROM audit_log a
      WHERE EXISTS (
        SELECT 1 FROM zmcc_tank_inventory_transaction x
        WHERE x.tank_id = ANY($1::bigint[]) AND x.transaction_type::text LIKE 'ADJUSTMENT%' AND x.at_13ts_liters > 1000
          AND a.created_at BETWEEN x.created_at - interval '2 minutes' AND x.created_at + interval '2 minutes'
      )
      ORDER BY a.id`, [ids]);

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
