/**
 * Read-only: recomputes SNF, TS and @13 TS from the Fat, LR and litres that were entered, for every ZMCC tank receipt,
 * every dispatch and plant result, and every Mobile Tester collection, and lists rows whose saved figures differ.
 * Formulas: SNF = LR/4 + 0.22 x Fat + 0.72;  TS = Fat + SNF;  @13 TS litres = litres x TS / 13.
 * Changes nothing.  Run on the VM:  node scripts\check-calculations.js Hasilpur > calculations.txt
 * Optional dates:                   node scripts\check-calculations.js Hasilpur 2026-11-01 2026-11-30
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const zmccArg = process.argv[2] || 'Hasilpur';
const from = process.argv[3] || '2000-01-01';
const to = process.argv[4] || '2100-01-01';

const num = (v) => (v == null ? null : Number(v));
const snfOf = (lr, fat) => lr / 4 + 0.22 * fat + 0.72;
const r2 = (v) => (v == null ? '' : Number(v).toFixed(2));
// Allowed rounding: TS 0.02, @13 TS 0.2% (at least 2 L).
const tsOff = (saved, calc) => saved != null && Math.abs(saved - calc) > 0.02;
const at13Off = (saved, calc) => saved != null && Math.abs(saved - calc) > Math.max(2, Math.abs(calc) * 0.002);

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
    const t = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zmcc_tank_receipt' AND column_name = 'received_at'`);
    const hasTz = t.rows[0]?.data_type === 'timestamp with time zone';
    const pk = (col) => (hasTz ? `(${col} AT TIME ZONE 'Asia/Karachi')` : `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`);

    const z = await c.query(`SELECT id, name FROM procurement_source WHERE source_type = 'ZMCC' AND (id::text = $1 OR name ILIKE '%' || $1 || '%')`, [zmccArg]);
    if (z.rows.length !== 1) throw new Error(z.rows.length ? 'More than one ZMCC matches; give its id.' : `No ZMCC matches "${zmccArg}".`);
    const zid = z.rows[0].id;
    console.log(`${z.rows[0].name}: calculation check (Pakistan dates ${from === '2000-01-01' ? 'all' : `${from} to ${to}`}).`);
    console.log('SNF = LR/4 + 0.22 x Fat + 0.72;  TS = Fat + SNF;  @13 TS = litres x TS / 13.');

    // 1. ZMCC tank receipts, and the @13 TS the tank ledger added for each.
    const rec = (await c.query(`
      SELECT tr.id, to_char(${pk('tr.received_at')}, 'DD Mon HH24:MI') AS at, tr.arrival_type AS kind,
             tr.gross_liters, tr.fat, tr.lr, tr.snf, tr.ts,
             (SELECT SUM(x.at_13ts_liters) FROM zmcc_tank_inventory_transaction x
               WHERE x.tank_receipt_id = tr.id AND x.transaction_type::text = 'RECEIPT') AS ledger_13ts
      FROM zmcc_tank_receipt tr
      WHERE tr.zmcc_id = $1 AND ${pk('tr.received_at')}::date BETWEEN $2::date AND $3::date
      ORDER BY tr.received_at`, [zid, from, to])).rows;
    const recBad = [];
    for (const r of rec) {
      const L = num(r.gross_liters), fat = num(r.fat), lr = num(r.lr);
      const ts = fat + snfOf(lr, fat);
      const at13 = (L * ts) / 13;
      const savedTs = num(r.ts), ledger = num(r.ledger_13ts);
      if (tsOff(savedTs, ts) || at13Off(ledger, (L * (savedTs ?? ts)) / 13) || at13Off(ledger, at13)) {
        recBad.push({ receipt: r.id, at: r.at, kind: r.kind, litres: r2(L), fat: r.fat, lr: r.lr, saved_ts: r2(savedTs), calc_ts: r2(ts), ledger_13ts: r2(ledger), calc_13ts: r2(at13) });
      }
    }
    console.log(`\n== 1. ZMCC tank receipts: ${rec.length} checked, ${recBad.length} differ\n${table(recBad)}`);

    // 2. Dispatches and plant results.
    const vis = (await c.query(`
      SELECT to_char(operational_date, 'DD Mon YYYY') AS day, visit_number, vehicle_number,
             dispatch_gross_liters, dispatch_fat, dispatch_lr, dispatch_ts, dispatch_at_13ts_liters,
             plant_gross_liters, plant_fat, plant_lr, plant_ts, plant_at_13ts_liters
      FROM vw_dispatch_vs_plant_visit
      WHERE zmcc_id = $1 AND operational_date BETWEEN $2::date AND $3::date
      ORDER BY operational_date, visit_id`, [zid, from, to])).rows;
    const dispBad = [];
    const plantBad = [];
    for (const v of vis) {
      const dL = num(v.dispatch_gross_liters), dF = num(v.dispatch_fat), dLr = num(v.dispatch_lr);
      if (dL != null && dF != null && dLr != null) {
        const ts = dF + snfOf(dLr, dF), at13 = (dL * ts) / 13;
        if (tsOff(num(v.dispatch_ts), ts) || at13Off(num(v.dispatch_at_13ts_liters), at13)) {
          dispBad.push({ day: v.day, visit: v.visit_number, vehicle: v.vehicle_number, litres: r2(dL), fat: v.dispatch_fat, lr: v.dispatch_lr, saved_ts: r2(v.dispatch_ts), calc_ts: r2(ts), saved_13ts: r2(v.dispatch_at_13ts_liters), calc_13ts: r2(at13) });
        }
      }
      const pL = num(v.plant_gross_liters), pF = num(v.plant_fat), pLr = num(v.plant_lr);
      if (pL != null && pF != null && pLr != null) {
        const ts = pF + snfOf(pLr, pF), at13 = (pL * ts) / 13;
        if (tsOff(num(v.plant_ts), ts) || at13Off(num(v.plant_at_13ts_liters), at13)) {
          plantBad.push({ day: v.day, visit: v.visit_number, vehicle: v.vehicle_number, litres: r2(pL), fat: v.plant_fat, lr: v.plant_lr, saved_ts: r2(v.plant_ts), calc_ts: r2(ts), saved_13ts: r2(v.plant_at_13ts_liters), calc_13ts: r2(at13) });
        }
      }
    }
    console.log(`\n== 2. Dispatch tests: ${vis.length} tankers checked, ${dispBad.length} differ\n${table(dispBad)}`);
    console.log(`\n== 3. Plant results: ${vis.filter((v) => v.plant_fat != null).length} tankers checked, ${plantBad.length} differ`);
    console.log('   (a tanker with several portions uses averaged Fat and LR here, so small differences are normal)');
    console.log(table(plantBad));

    // 4. Mobile Tester shop collections.
    const col = (await c.query(`
      SELECT collection_number, to_char(operational_date, 'DD Mon YYYY') AS day, gross_liters, fat, lr, snf, ts, at_13ts_liters
      FROM mot_shop_collection
      WHERE zmcc_id = $1 AND operational_date BETWEEN $2::date AND $3::date AND gross_liters IS NOT NULL AND fat IS NOT NULL AND lr IS NOT NULL
      ORDER BY id`, [zid, from, to])).rows;
    const colBad = [];
    for (const r of col) {
      const L = num(r.gross_liters), fat = num(r.fat), lr = num(r.lr);
      const ts = fat + snfOf(lr, fat), at13 = (L * ts) / 13;
      if (tsOff(num(r.ts), ts) || at13Off(num(r.at_13ts_liters), at13)) {
        colBad.push({ collection: r.collection_number, day: r.day, litres: r2(L), fat: r.fat, lr: r.lr, saved_ts: r2(r.ts), calc_ts: r2(ts), saved_13ts: r2(r.at_13ts_liters), calc_13ts: r2(at13) });
      }
    }
    console.log(`\n== 4. Mobile Tester collections: ${col.length} checked, ${colBad.length} differ\n${table(colBad)}`);

    // 5. Values outside what milk can be (typing mistakes like Fat 460).
    const odd = (await c.query(`
      SELECT 'ZMCC receipt' AS what, tr.id::text AS ref, to_char(${pk('tr.received_at')}, 'DD Mon YYYY') AS day, tr.fat, tr.lr
      FROM zmcc_tank_receipt tr WHERE tr.zmcc_id = $1 AND (tr.fat NOT BETWEEN 1 AND 12 OR tr.lr NOT BETWEEN 18 AND 40)
      UNION ALL
      SELECT 'Dispatch', visit_number, to_char(operational_date, 'DD Mon YYYY'), dispatch_fat, dispatch_lr
      FROM vw_dispatch_vs_plant_visit WHERE zmcc_id = $1 AND (dispatch_fat NOT BETWEEN 1 AND 12 OR dispatch_lr NOT BETWEEN 18 AND 40)
      UNION ALL
      SELECT 'Plant', visit_number, to_char(operational_date, 'DD Mon YYYY'), plant_fat, plant_lr
      FROM vw_dispatch_vs_plant_visit WHERE zmcc_id = $1 AND (plant_fat NOT BETWEEN 1 AND 12 OR plant_lr NOT BETWEEN 18 AND 40)
      UNION ALL
      SELECT 'Shop collection', collection_number, to_char(operational_date, 'DD Mon YYYY'), fat, lr
      FROM mot_shop_collection WHERE zmcc_id = $1 AND (fat NOT BETWEEN 1 AND 12 OR lr NOT BETWEEN 18 AND 40)`, [zid])).rows;
    console.log(`\n== 5. Fat outside 1-12 or LR outside 18-40 (all dates): ${odd.length}\n${table(odd)}`);

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
