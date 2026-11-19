/**
 * Read-only: for each tanker one ZMCC dispatched, what left the tank, what was written at dispatch, and what the plant
 * measured; then per day, what the ZMCC tank received against both. Changes nothing.
 * Run on the VM from the app folder:
 *   node scripts\check-zmcc-dispatch-vs-plant.js Hasilpur 2026-11-06 2026-11-18 > dispatch-vs-plant.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const zmccArg = process.argv[2] || 'Hasilpur';
const from = process.argv[3] || '2026-11-06';
const to = process.argv[4] || '2026-11-18';
if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
  console.error('Give the days as YYYY-MM-DD');
  process.exit(1);
}

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (v) => '  ' + v.map((x, i) => String(x ?? '').padStart(i < 3 ? 0 : w[i]).padEnd(w[i])).join('  ');
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
    const t = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zmcc_tank_inventory_transaction' AND column_name = 'operational_timestamp'`);
    const hasTz = t.rows[0]?.data_type === 'timestamp with time zone';
    const pkDate = (col) => (hasTz ? `(${col} AT TIME ZONE 'Asia/Karachi')::date` : `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')::date`);

    const z = await c.query(`SELECT id, name FROM procurement_source WHERE source_type = 'ZMCC' AND (id::text = $1 OR name ILIKE '%' || $1 || '%')`, [zmccArg]);
    if (z.rows.length !== 1) throw new Error(z.rows.length ? 'More than one ZMCC matches; give its id.' : `No ZMCC matches "${zmccArg}".`);
    const zid = z.rows[0].id;
    console.log(`${z.rows[0].name}, ${from} to ${to} (Pakistan dates). Plant minus dispatch: negative means the plant measured less.`);

    await q('1. Each tanker: tank issue, dispatch test, plant test', `
      SELECT to_char(v.operational_date, 'DD Mon') AS day, v.visit_number AS visit, v.vehicle_number AS vehicle,
             ROUND(i.qty, 0) AS tank_out_l, ROUND(i.at13, 0) AS tank_out_13ts,
             ROUND(v.dispatch_gross_liters, 0) AS disp_l, v.dispatch_fat AS disp_fat, v.dispatch_lr AS disp_lr, ROUND(v.dispatch_ts, 2) AS disp_ts,
             ROUND(v.dispatch_at_13ts_liters, 0) AS disp_13ts,
             ROUND(v.plant_gross_liters, 0) AS plant_l, v.plant_fat AS plant_fat, v.plant_lr AS plant_lr, ROUND(v.plant_ts, 2) AS plant_ts,
             ROUND(v.plant_at_13ts_liters, 0) AS plant_13ts,
             ROUND(v.plant_gross_liters - v.dispatch_gross_liters, 0) AS diff_l,
             ROUND(v.plant_at_13ts_liters - v.dispatch_at_13ts_liters, 0) AS diff_13ts,
             CASE WHEN v.is_received THEN '' ELSE v.current_status END AS not_received
      FROM vw_dispatch_vs_plant_visit v
      LEFT JOIN LATERAL (
        SELECT SUM(x.quantity_liters) AS qty, SUM(x.at_13ts_liters) AS at13
        FROM zmcc_tank_inventory_transaction x
        WHERE x.transaction_type::text = 'ISSUE' AND x.reference_type = 'DISPATCH' AND x.reference_id = v.visit_id::text
      ) i ON true
      WHERE v.zmcc_id = $1 AND v.operational_date BETWEEN $2::date AND $3::date
      ORDER BY v.operational_date, v.visit_id`, [zid, from, to]);

    await q('2. Per day: ZMCC tank received, dispatched (dispatch test), plant received (plant test), in @13 TS', `
      WITH rec AS (
        SELECT ${pkDate('x.operational_timestamp')} AS day, SUM(x.quantity_liters) AS l, SUM(x.at_13ts_liters) AS at13
        FROM zmcc_tank_inventory_transaction x JOIN zmcc_tank tk ON tk.id = x.tank_id
        WHERE tk.zmcc_id = $1 AND x.transaction_type::text = 'RECEIPT'
        GROUP BY 1
      ), disp AS (
        SELECT operational_date AS day, COUNT(*) AS tankers,
               SUM(dispatch_gross_liters) AS dl, SUM(dispatch_at_13ts_liters) AS d13,
               SUM(plant_gross_liters) AS pl, SUM(plant_at_13ts_liters) AS p13
        FROM vw_dispatch_vs_plant_visit WHERE zmcc_id = $1 GROUP BY 1
      )
      SELECT to_char(d.day, 'DD Mon') AS day, d.tankers,
             ROUND(r.l, 0) AS zmcc_in_l, ROUND(r.at13, 0) AS zmcc_in_13ts,
             ROUND(d.dl, 0) AS dispatch_l, ROUND(d.d13, 0) AS dispatch_13ts,
             ROUND(d.pl, 0) AS plant_l, ROUND(d.p13, 0) AS plant_13ts,
             ROUND(d.d13 - r.at13, 0) AS dispatch_minus_zmcc_in,
             ROUND(d.p13 - r.at13, 0) AS plant_minus_zmcc_in,
             ROUND(d.p13 - d.d13, 0) AS plant_minus_dispatch
      FROM disp d LEFT JOIN rec r ON r.day = d.day
      WHERE d.day BETWEEN $2::date AND $3::date
      ORDER BY d.day`, [zid, from, to]);

    await c.query('ROLLBACK');
    console.log('\nNote: 10 Nov received @13 TS still includes the Fat 460 typo in section 2 if the ledger day is 10 Nov; the correction row is dated 18 Nov.');
    console.log('Done. Nothing was changed.');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Check failed:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
