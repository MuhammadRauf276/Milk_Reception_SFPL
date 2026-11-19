/**
 * Read-only list of what one ZMCC received on one Pakistan day. Changes nothing.
 * Run on the VM from the app folder:   node scripts\check-zmcc-day.js Hasilpur 2026-11-17 > zmcc-day.txt
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const zmccArg = process.argv[2] || 'Hasilpur';
const day = process.argv[3] || '2026-11-17';
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error('Give the day as YYYY-MM-DD, for example 2026-11-17');
  process.exit(1);
}

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))));
  const line = (v) => '  ' + v.map((x, i) => String(x ?? '').slice(0, 40).padEnd(w[i])).join('  ');
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

    // Times are stored as UTC without a zone today, and with a zone after the planned update: show Pakistan time either way.
    const t = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zmcc_tank_receipt' AND column_name = 'received_at'`);
    const hasTz = t.rows[0]?.data_type === 'timestamp with time zone';
    const pk = (col) => (hasTz ? `(${col} AT TIME ZONE 'Asia/Karachi')` : `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`);
    const hm = (col) => `to_char(${pk(col)}, 'HH24:MI')`;

    const z = await q('ZMCC', `
      SELECT id, name FROM procurement_source
      WHERE source_type = 'ZMCC' AND (id::text = $1 OR name ILIKE '%' || $1 || '%') ORDER BY id`, [zmccArg]);
    if (z.length !== 1) throw new Error(z.length ? 'More than one ZMCC matches; give its id instead.' : `No ZMCC matches "${zmccArg}".`);
    const zid = z[0].id;
    console.log(`\nDay: ${day} (Pakistan date)`);

    await q('1. Mobile Tester journeys of the day: collected vs received at the ZMCC', `
      SELECT j.journey_number AS journey, p.name AS tester, v.vehicle_number AS vehicle, r.name AS route, j.status,
             (SELECT COUNT(*) FROM mot_journey_stop s WHERE s.journey_id = j.id) AS shops_planned,
             (SELECT COUNT(*) FROM mot_shop_collection sc WHERE sc.journey_id = j.id) AS shops_collected,
             (SELECT ROUND(SUM(sc.gross_liters), 0) FROM mot_shop_collection sc WHERE sc.journey_id = j.id AND sc.final_decision = 'ACCEPTED') AS collected_l,
             (SELECT ROUND(SUM(sc.at_13ts_liters), 0) FROM mot_shop_collection sc WHERE sc.journey_id = j.id AND sc.final_decision = 'ACCEPTED') AS collected_13ts,
             a.zmcc_token AS token, ${hm('a.arrival_timestamp')} AS arrived,
             ls.final_decision AS lab, ls.exit_outcome AS outcome,
             (SELECT ROUND(SUM(tr.gross_liters), 0) FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id) AS received_l,
             (SELECT ROUND(SUM(tr.gross_liters * tr.ts / 13), 0) FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id) AS received_13ts
      FROM mot_journey j
      JOIN mot_profile p ON p.id = j.mot_profile_id
      LEFT JOIN mot_vehicle v ON v.id = j.mot_vehicle_id
      LEFT JOIN zmcc_route r ON r.id = j.route_id
      LEFT JOIN zmcc_mot_arrival a ON a.journey_id = j.id
      LEFT JOIN zmcc_lab_session ls ON ls.mot_arrival_id = a.id
      WHERE j.zmcc_id = $1 AND j.operational_date = $2::date
      ORDER BY j.id`, [zid, day]);

    await q('2. HC (direct supplier) arrivals of the day', `
      SELECT a.zmcc_token AS token, s.name AS supplier, a.vehicle_number AS vehicle, ${hm('a.arrival_timestamp')} AS arrived,
             ls.status AS lab_status, ls.final_decision AS lab, ls.exit_outcome AS outcome, ${hm('a.exit_timestamp')} AS gate_exit,
             (SELECT ROUND(SUM(tr.gross_liters), 0) FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id) AS received_l,
             (SELECT ROUND(SUM(tr.gross_liters * tr.ts / 13), 0) FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id) AS received_13ts
      FROM zmcc_local_supplier_arrival a
      JOIN zmcc_local_supplier s ON s.id = a.local_supplier_id
      LEFT JOIN zmcc_lab_session ls ON ls.local_supplier_arrival_id = a.id
      WHERE a.zmcc_id = $1 AND a.arrival_date = $2::date
      ORDER BY a.arrival_timestamp`, [zid, day]);

    await q('3. Arrived that day but nothing went into a tank (check these with the team)', `
      SELECT 'Mobile Tester' AS kind, a.zmcc_token AS token, v.vehicle_number AS vehicle, ${hm('a.arrival_timestamp')} AS arrived,
             COALESCE(ls.status, 'NO LAB TEST') AS lab_status, ls.final_decision AS lab, ls.exit_outcome AS outcome,
             left(COALESCE(ls.exit_remarks, ls.rejection_reason, ls.remarks, ''), 40) AS note
      FROM zmcc_mot_arrival a
      JOIN mot_journey j ON j.id = a.journey_id LEFT JOIN mot_vehicle v ON v.id = j.mot_vehicle_id
      LEFT JOIN zmcc_lab_session ls ON ls.mot_arrival_id = a.id
      WHERE a.zmcc_id = $1 AND a.arrival_date = $2::date
        AND NOT EXISTS (SELECT 1 FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id)
      UNION ALL
      SELECT 'HC', a.zmcc_token, a.vehicle_number, ${hm('a.arrival_timestamp')},
             COALESCE(ls.status, 'NO LAB TEST'), ls.final_decision, ls.exit_outcome,
             left(COALESCE(ls.exit_remarks, ls.rejection_reason, ls.remarks, ''), 40)
      FROM zmcc_local_supplier_arrival a
      LEFT JOIN zmcc_lab_session ls ON ls.local_supplier_arrival_id = a.id
      WHERE a.zmcc_id = $1 AND a.arrival_date = $2::date
        AND NOT EXISTS (SELECT 1 FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id)
      ORDER BY 4`, [zid, day]);

    await q('4. Tank receipts during the day (by the time milk went into the tank)', `
      SELECT tk.tank_code AS tank, tr.arrival_type AS kind, ${hm('tr.received_at')} AS at,
             ROUND(tr.gross_liters, 2) AS litres, tr.fat, tr.lr, ROUND(tr.ts, 2) AS ts,
             ROUND(tr.gross_liters * tr.ts / 13, 2) AS at13ts, u.full_name AS received_by
      FROM zmcc_tank_receipt tr
      JOIN zmcc_tank tk ON tk.id = tr.tank_id LEFT JOIN users u ON u.id = tr.received_by_user_id
      WHERE tr.zmcc_id = $1 AND ${pk('tr.received_at')}::date = $2::date
      ORDER BY tr.received_at`, [zid, day]);

    await q('5. Day totals per tank (ledger)', `
      SELECT tk.tank_code AS tank,
             COUNT(*) FILTER (WHERE x.transaction_type::text = 'RECEIPT') AS receipts,
             ROUND(SUM(x.quantity_liters) FILTER (WHERE x.transaction_type::text = 'RECEIPT'), 2) AS received_l,
             ROUND(SUM(x.at_13ts_liters) FILTER (WHERE x.transaction_type::text = 'RECEIPT'), 2) AS received_13ts,
             COUNT(*) FILTER (WHERE x.transaction_type::text = 'ISSUE') AS dispatches,
             ROUND(SUM(x.quantity_liters) FILTER (WHERE x.transaction_type::text = 'ISSUE'), 2) AS dispatched_l,
             ROUND(SUM(x.at_13ts_liters) FILTER (WHERE x.transaction_type::text = 'ISSUE'), 2) AS dispatched_13ts
      FROM zmcc_tank_inventory_transaction x JOIN zmcc_tank tk ON tk.id = x.tank_id
      WHERE tk.zmcc_id = $1 AND ${pk('x.operational_timestamp')}::date = $2::date
      GROUP BY tk.tank_code ORDER BY 1`, [zid, day]);

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
