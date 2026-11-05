// READ ONLY. Runs inside a read-only transaction, so it cannot change anything.
const path = require('path');
const fs = require('fs');
const app = path.join(__dirname, '..');
const { Client } = require(path.join(app, 'node_modules', 'pg'));
for (const name of ['.env.production', '.env']) {
  const file = path.join(app, name);
  if (!fs.existsSync(file) || process.env.DATABASE_URL) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/);
    if (m) process.env.DATABASE_URL = m[1];
  }
}
const QUERIES = [
  ['1. TANK BALANCE BY KIND OF ENTRY (ts = @13 x 13 / gross; normal is 11 to 15)', `
    SELECT t.tank_code, x.transaction_type AS type, x.reference_type AS ref, COUNT(*) AS n,
      SUM(x.quantity_liters) AS gross, SUM(x.at_13ts_liters) AS at13,
      ROUND(SUM(x.at_13ts_liters) * 13 / NULLIF(SUM(x.quantity_liters), 0), 2) AS ts,
      COUNT(*) FILTER (WHERE x.at_13ts_liters IS NULL) AS no_at13
    FROM zmcc_tank_inventory_transaction x JOIN zmcc_tank t ON t.id = x.tank_id
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`],
  ['2. TANK TOTAL (what the screens show)', `
    SELECT t.tank_code,
      SUM(CASE WHEN x.transaction_type IN ('RECEIPT','ADJUSTMENT_IN') THEN x.quantity_liters ELSE -x.quantity_liters END) AS gross_stock,
      SUM(CASE WHEN x.transaction_type IN ('RECEIPT','ADJUSTMENT_IN') THEN x.at_13ts_liters ELSE -x.at_13ts_liters END) AS at13_stock
    FROM zmcc_tank_inventory_transaction x JOIN zmcc_tank t ON t.id = x.tank_id GROUP BY 1 ORDER BY 1`],
  ['3. ENTRIES WITH IMPOSSIBLE @13 (TS not between 9 and 18)', `
    SELECT x.id, t.tank_code, x.transaction_type AS type, x.reference_type AS ref, x.quantity_liters AS gross, x.at_13ts_liters AS at13,
      ROUND(x.at_13ts_liters * 13 / NULLIF(x.quantity_liters, 0), 2) AS ts, x.operational_timestamp AS at,
      v.visit_number, v.vehicle_number, v.vehicle_dispatch_lr AS disp_lr, v.vehicle_dispatch_fat AS disp_fat
    FROM zmcc_tank_inventory_transaction x JOIN zmcc_tank t ON t.id = x.tank_id
    LEFT JOIN vehicle_visit v ON v.id = x.dispatch_id
    WHERE x.at_13ts_liters IS NULL OR x.at_13ts_liters * 13 / NULLIF(x.quantity_liters, 0) NOT BETWEEN 9 AND 18
    ORDER BY x.id DESC LIMIT 40`],
  ['4. LATEST WEIGHED PORTIONS AND WHAT WENT INTO THE TANK', `
    SELECT p.id AS portion, p.net_weight_kg AS net_kg, p.lr, p.fat, p.ts, p.density, x.quantity_liters AS tank_gross, x.at_13ts_liters AS tank_at13,
      ROUND(p.net_weight_kg / NULLIF(p.density, 0), 2) AS expect_gross,
      ROUND(p.net_weight_kg / NULLIF(p.density, 0) * p.ts / 13, 2) AS expect_at13, x.operational_timestamp AS at
    FROM zmcc_tank_inventory_transaction x JOIN zmcc_lab_portion p ON x.reference_id = p.id::text
    WHERE x.reference_type = 'ZMCC_LAB_PORTION' ORDER BY x.id DESC LIMIT 15`],
  ['5. WEIGHED PORTIONS NOT IN THE TANK', `
    SELECT p.id AS portion, p.status, p.final_decision, p.net_weight_kg AS net_kg, p.ts
    FROM zmcc_lab_portion p
    LEFT JOIN zmcc_tank_inventory_transaction x ON x.reference_type = 'ZMCC_LAB_PORTION' AND x.reference_id = p.id::text
    LEFT JOIN zmcc_tank_receipt rc ON rc.lab_session_id = p.lab_session_id
    WHERE p.status = 'WEIGHED' AND x.id IS NULL AND rc.id IS NULL ORDER BY p.id DESC LIMIT 20`],
  ['6. COLLECTING JOURNEYS: ROUTE SHOPS MISSING FROM THE JOURNEY', `
    SELECT j.journey_number, r.name AS route, s.shop_code, s.shop_name, s.created_at
    FROM mot_journey j JOIN zmcc_route r ON r.id = j.route_id
    JOIN zmcc_shop s ON s.route_id = j.route_id AND s.is_active AND s.approval_status = 'ACTIVE'
    LEFT JOIN mot_journey_stop st ON st.journey_id = j.id AND st.shop_id = s.id
    WHERE j.status = 'COLLECTING' AND st.id IS NULL ORDER BY j.id DESC, s.id LIMIT 40`],
  ['7. LATEST SHOP REQUESTS', `
    SELECT s.id, s.shop_code, s.shop_name, s.approval_status, s.is_active, r.name AS route, u.role AS asked_by, s.created_at
    FROM zmcc_shop s LEFT JOIN zmcc_route r ON r.id = s.route_id LEFT JOIN users u ON u.id = s.created_by
    WHERE s.approval_status <> 'ACTIVE' OR s.created_at > now() - interval '7 days' ORDER BY s.id DESC LIMIT 25`],
  ['8. WHO WAS TOLD ABOUT SHOP REQUESTS', `
    SELECT u.role, COUNT(*) AS told, COUNT(*) FILTER (WHERE n.read_at IS NULL) AS still_open
    FROM notification n JOIN users u ON u.id = n.recipient_user_id
    WHERE n.event_key = 'NEW_SHOP_PENDING' GROUP BY 1 ORDER BY 1`],
  ['9. APP VERSION ON THIS SERVER', `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3`],
];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  for (const [title, sql] of QUERIES) {
    console.log('\n=== ' + title);
    try {
      const { rows } = await c.query(sql);
      if (rows.length === 0) console.log('(none)');
      else console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 16) : v]))));
    } catch (e) {
      console.log('could not read: ' + e.message);
      await c.query('ROLLBACK');
      await c.query('BEGIN READ ONLY');
    }
  }
  await c.query('ROLLBACK');
  await c.end();
})().catch((e) => console.log('ERROR: ' + e.message));
