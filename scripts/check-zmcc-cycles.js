/**
 * Read-only: one ZMCC's tank, cycle by cycle. A cycle is the milk taken in since the last dispatch plus the
 * dispatch(es) that followed. For each: intake, dispatch slip, plant received (from the weighbridge ticket and plant
 * test), what stayed in the tank, and loss/gain at each step. Changes nothing.
 * Corrected values are used (receipts and dispatches as they are now); plant litres come from the weighbridge ticket.
 *   node scripts\check-zmcc-cycles.js Hasilpur 2026-11-06 > cycles.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const zmccArg = process.argv[2] || 'Hasilpur';
const from = process.argv[3] || '2000-01-01';
const n = (v) => (v == null ? null : Number(v));
const f0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const f2 = (v) => (v == null ? '—' : v.toFixed(2));
const sgn = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`);
const snfOf = (lr, fat) => lr / 4 + 0.22 * fat + 0.72;

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (v) => '  ' + v.map((x, i) => (i < 2 ? String(x ?? '').padEnd(w[i]) : String(x ?? '').padStart(w[i]))).join('  ');
  return [line(cols), line(w.map((x) => '-'.repeat(x))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const t = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zmcc_tank_inventory_transaction' AND column_name = 'operational_timestamp'`);
    const hasTz = t.rows[0]?.data_type === 'timestamp with time zone';
    const pkDay = (col) => (hasTz ? `to_char(${col} AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')` : `to_char(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')`);

    const z = await c.query(`SELECT id, name FROM procurement_source WHERE source_type = 'ZMCC' AND (id::text = $1 OR name ILIKE '%' || $1 || '%')`, [zmccArg]);
    if (z.rows.length !== 1) throw new Error(z.rows.length ? 'More than one ZMCC matches; give its id.' : `No ZMCC matches "${zmccArg}".`);
    const zid = z.rows[0].id;

    // Every ledger row in the order it was entered, with current (corrected) receipt and dispatch values,
    // and the plant figures from the weighbridge ticket and the plant test.
    const { rows } = await c.query(`
      SELECT x.id, x.tank_id, tk.tank_code, x.transaction_type::text AS type, x.reference_type, x.reference_id,
             x.quantity_liters, x.at_13ts_liters, ${pkDay('x.operational_timestamp')} AS day,
             -- A receipt poured into two tanks has a row per tank: each row gets its own part of the receipt.
             tr.gross_liters * x.quantity_liters
               / NULLIF(SUM(x.quantity_liters) FILTER (WHERE x.transaction_type::text = 'RECEIPT') OVER (PARTITION BY x.tank_receipt_id), 0) AS r_l,
             tr.ts AS r_ts,
             v.visit_number, v.vehicle_number, v.vehicle_dispatch_gross_liters AS d_l, v.vehicle_dispatch_ts AS d_ts,
             v.vehicle_dispatch_at_13ts_liters AS d_13,
             (wt.gross_weight_kg - wt.tare_weight_kg) AS p_net_kg, sr.lr AS p_lr, sr.ts AS p_ts
      FROM zmcc_tank_inventory_transaction x
      JOIN zmcc_tank tk ON tk.id = x.tank_id
      LEFT JOIN zmcc_tank_receipt tr ON tr.id = x.tank_receipt_id
      LEFT JOIN vehicle_visit v ON x.transaction_type::text = 'ISSUE' AND x.reference_type = 'DISPATCH' AND v.id::text = x.reference_id
      LEFT JOIN weight_ticket wt ON wt.visit_id = v.id
      LEFT JOIN LATERAL (
        SELECT MAX(s.plant_composite_lr) AS lr, MAX(s.plant_ts) AS ts FROM silo_inventory_transaction s
        WHERE s.visit_id = v.id AND s.transaction_type::text = 'RECEIPT'
      ) sr ON true
      WHERE tk.zmcc_id = $1
      ORDER BY x.tank_id, x.id`, [zid]);

    const cycles = [];
    const stock = new Map(); // tank -> { l, a13 }
    let cur = null;
    const begin = (r, s) => ({ tankId: r.tank_id, tank: r.tank_code, day: r.day, openL: s.l, open13: s.a13, inL: 0, in13: 0, adjL: 0, adj13: 0, tankers: [], dL: 0, d13: 0, pL: 0, p13: 0, plantKnown: true });
    const finish = () => {
      if (cur && cur.tankers.length) {
        const s = stock.get(cur.tankId);
        cur.closeL = s.l; cur.close13 = s.a13;
        cycles.push(cur);
      }
    };
    for (const r of rows) {
      const s = stock.get(r.tank_id) ?? { l: 0, a13: 0 };
      stock.set(r.tank_id, s);
      // A new cycle starts with the first non-dispatch row after a dispatch, or on another tank.
      if (!cur || cur.tankId !== r.tank_id || (cur.tankers.length > 0 && r.type !== 'ISSUE')) {
        finish();
        cur = begin(r, s);
      }
      const q = n(r.quantity_liters), a = n(r.at_13ts_liters);
      if (r.type === 'RECEIPT') {
        const L = r.r_l != null ? n(r.r_l) : q;
        const A = r.r_l != null && r.r_ts != null ? (n(r.r_l) * n(r.r_ts)) / 13 : a;
        cur.inL += L; cur.in13 += A; s.l += L; s.a13 += A;
      } else if (r.type === 'ISSUE') {
        const L = r.d_l != null ? n(r.d_l) : q;
        const A = r.d_13 != null ? n(r.d_13) : a;
        cur.dL += L; cur.d13 += A; s.l -= L; s.a13 -= A;
        let pL = null, p13 = null;
        if (r.p_net_kg != null && r.p_lr != null && r.p_ts != null) {
          pL = n(r.p_net_kg) / (1 + n(r.p_lr) / 1000);
          p13 = (pL * n(r.p_ts)) / 13;
          cur.pL += pL; cur.p13 += p13;
        } else cur.plantKnown = false;
        cur.tankers.push({ vehicle: r.vehicle_number });
        cur.lastDay = r.day;
      } else if (r.reference_type === 'ZMCC_LAB_SESSION_CORRECTION' || /DISPATCH_CORRECTION/.test(r.reference_type || '')) {
        // Already counted: receipts and dispatches above use their corrected values.
      } else {
        const sign = r.type === 'ADJUSTMENT_IN' ? 1 : -1;
        cur.adjL += sign * q; cur.adj13 += sign * a; s.l += sign * q; s.a13 += sign * a;
      }
    }
    finish();

    const shown = cycles.filter((cy) => (cy.lastDay || cy.day) >= from);
    const out = [];
    const tot = { inL: 0, in13: 0, dL: 0, d13: 0, pL: 0, p13: 0, true13: 0, n: 0, dispHigh: 0, plantNearIntake: 0 };
    for (const cy of shown) {
      const inTs = cy.inL > 0 ? (cy.in13 * 13) / cy.inL : null;
      const dTs = cy.dL > 0 ? (cy.d13 * 13) / cy.dL : null;
      const pTs = cy.plantKnown && cy.pL > 0 ? (cy.p13 * 13) / cy.pL : null;
      // What the dispatched litres hold at the intake quality (milk in the tank is the intake milk).
      const truth13 = inTs != null ? (cy.dL * inTs) / 13 : null;
      out.push({
        day: (cy.lastDay || cy.day).slice(5),
        tankers: cy.tankers.map((t) => t.vehicle).join(' + '),
        open_l: f0(cy.openL),
        intake_l: f0(cy.inL),
        dispatch_l: f0(cy.dL),
        plant_l: cy.plantKnown ? f0(cy.pL) : '—',
        left_in_tank_l: f0(cy.closeL),
        intake_ts: f2(inTs),
        dispatch_ts: f2(dTs),
        plant_ts: f2(pTs),
        intake_13ts: f0(cy.in13),
        dispatch_13ts: f0(cy.d13),
        plant_13ts: cy.plantKnown ? f0(cy.p13) : '—',
        slip_vs_true_13ts: truth13 != null ? sgn(cy.d13 - truth13) : '—',
        transit_l: cy.plantKnown ? sgn(cy.pL - cy.dL) : '—',
        transit_13ts: cy.plantKnown ? sgn(cy.p13 - cy.d13) : '—',
      });
      if (cy.plantKnown && inTs != null && dTs != null && pTs != null) {
        tot.n++;
        if (dTs > inTs + 0.02) tot.dispHigh++;
        if (Math.abs(pTs - inTs) < Math.abs(dTs - inTs)) tot.plantNearIntake++;
        tot.inL += cy.inL; tot.in13 += cy.in13; tot.dL += cy.dL; tot.d13 += cy.d13; tot.pL += cy.pL; tot.p13 += cy.p13; tot.true13 += truth13;
      }
    }

    console.log(`${z.rows[0].name}: tank cycles from ${from === '2000-01-01' ? 'the start' : from} (Pakistan dates). Corrected values; plant from the weighbridge ticket.`);
    console.log('slip_vs_true_13ts = dispatch slip @13 TS minus the same litres at the intake quality (+ means the slip claims more).');
    console.log('transit = plant minus dispatch slip.\n');
    console.log(table(out));
    if (tot.n) {
      const ts = (a, l) => ((a * 13) / l).toFixed(2);
      console.log(`\nCycles with intake, dispatch and plant figures: ${tot.n}`);
      console.log(`  Dispatch slip TS higher than intake TS:              ${tot.dispHigh} of ${tot.n}`);
      console.log(`  Plant TS closer to intake TS than the slip is:       ${tot.plantNearIntake} of ${tot.n}`);
      console.log(`  Average TS   intake ${ts(tot.in13, tot.inL)}   dispatch slip ${ts(tot.d13, tot.dL)}   plant ${ts(tot.p13, tot.pL)}`);
      console.log(`  Litres       intake ${f0(tot.inL)}   dispatched ${f0(tot.dL)}   plant ${f0(tot.pL)}   (transit ${sgn(tot.pL - tot.dL)} L)`);
      console.log(`  @13 TS       intake ${f0(tot.in13)}   dispatch slip ${f0(tot.d13)}   plant ${f0(tot.p13)}`);
      console.log(`  Dispatch slip claimed more @13 TS than the milk held (slip minus true): ${sgn(tot.d13 - tot.true13)} L @13 TS`);
      console.log(`  Transit, plant minus slip:  ${sgn(tot.pL - tot.dL)} L, ${sgn(tot.p13 - tot.d13)} L @13 TS`);
      console.log(`  Transit, plant minus true:  ${sgn(tot.pL - tot.dL)} L, ${sgn(tot.p13 - tot.true13)} L @13 TS  (the real loss/gain on the road)`);
      console.log('  Milk still in the tank is not a loss: see left_in_tank_l.');
    }
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
