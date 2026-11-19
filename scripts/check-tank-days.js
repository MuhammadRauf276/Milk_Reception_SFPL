/**
 * Read-only day-by-day balance of one ZMCC tank, in litres and @13 TS. Changes nothing.
 * A correction is counted on the day of the record it corrected (a Fat typo on 10 Nov fixed on 18 Nov counts on 10 Nov).
 * Run on the VM from the app folder:   node scripts\check-tank-days.js TANK-01 > tank-days.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const code = process.argv[2] || 'TANK-01';
const n = (v) => Number(v || 0);
const f = (v) => (Math.abs(v) < 0.005 ? '0' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const t = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zmcc_tank_inventory_transaction' AND column_name = 'operational_timestamp'`);
    const hasTz = t.rows[0]?.data_type === 'timestamp with time zone';
    const pkDate = (col) => (hasTz ? `(${col} AT TIME ZONE 'Asia/Karachi')::date` : `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')::date`);

    const tank = await c.query(`SELECT id, tank_code FROM zmcc_tank WHERE tank_code = $1`, [code]);
    if (!tank.rows.length) throw new Error(`No tank with code ${code}`);
    const tankId = tank.rows[0].id;

    // Each row's day; a lab correction row takes the day of the receipt of the portion it corrected.
    const { rows } = await c.query(`
      SELECT x.id, x.transaction_type::text AS type, x.quantity_liters, x.at_13ts_liters, x.reference_type, x.reference_id,
             to_char(COALESCE(
               CASE WHEN x.reference_type = 'ZMCC_LAB_SESSION_CORRECTION' AND x.reference_id ~ ':P[0-9]+:' THEN
                 (SELECT ${pkDate('tr.received_at')} FROM zmcc_tank_receipt tr
                  WHERE tr.portion_id = substring(x.reference_id from ':P([0-9]+):')::bigint ORDER BY tr.id LIMIT 1)
               END,
               ${pkDate('x.operational_timestamp')}
             ), 'YYYY-MM-DD') AS day
      FROM zmcc_tank_inventory_transaction x
      WHERE x.tank_id = $1
      ORDER BY x.id`, [tankId]);

    const days = new Map();
    for (const r of rows) {
      const d = days.get(r.day) ?? { inL: 0, in13: 0, outL: 0, out13: 0, adjL: 0, adj13: 0, receipts: 0, dispatches: 0, notes: new Set() };
      const q = n(r.quantity_liters);
      const a = n(r.at_13ts_liters);
      if (r.type === 'RECEIPT') { d.inL += q; d.in13 += a; d.receipts++; }
      else if (r.type === 'ISSUE') { d.outL += q; d.out13 += a; d.dispatches++; }
      else if (r.type === 'ADJUSTMENT_IN') { d.adjL += q; d.adj13 += a; d.notes.add(r.reference_type); }
      else if (r.type === 'ADJUSTMENT_OUT') { d.adjL -= q; d.adj13 -= a; d.notes.add(r.reference_type); }
      days.set(r.day, d);
    }

    const out = [];
    let gross = 0;
    let at13 = 0;
    for (const day of [...days.keys()].sort()) {
      const d = days.get(day);
      const open = gross;
      gross += d.inL - d.outL + d.adjL;
      at13 += d.in13 - d.out13 + d.adj13;
      out.push({
        day,
        receipts: d.receipts,
        received_l: f(d.inL),
        received_13ts: f(d.in13),
        dispatches: d.dispatches,
        dispatched_l: f(d.outL),
        dispatched_13ts: f(d.out13),
        adjust_l: f(d.adjL),
        adjust_13ts: f(d.adj13),
        day_13ts_diff: f(d.in13 - d.out13 + d.adj13),
        opening_l: f(open),
        closing_l: f(gross),
        closing_13ts: f(at13),
        adjustments: [...d.notes].join(' ').replace(/SUPER_ADMIN_MANUAL_/g, 'MANUAL_').replace(/ZMCC_LAB_SESSION_CORRECTION/g, 'LAB_CORRECTION'),
      });
    }

    const cols = Object.keys(out[0] ?? { none: '' });
    const w = cols.map((k) => Math.max(k.length, ...out.map((r) => String(r[k]).length)));
    const line = (v) => '  ' + v.map((x, i) => (i === 0 || i === cols.length - 1 ? String(x).padEnd(w[i]) : String(x).padStart(w[i]))).join('  ');
    console.log(`Tank ${code}: day by day (Pakistan dates). A correction counts on the day of the record it corrected.\n`);
    console.log(line(cols));
    console.log(line(w.map((x) => '-'.repeat(x))));
    out.forEach((r) => console.log(line(cols.map((k) => r[k]))));
    console.log(`\nNow: ${f(gross)} L, ${f(at13)} L @13 TS.`);
    console.log('day_13ts_diff = received @13 TS - dispatched @13 TS + adjustments, for that day.');
    console.log('On a day the tank ends near 0 L, closing_13ts shows how far @13 TS has drifted from the litres.');

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
