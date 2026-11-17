// Read-only check of saved drafts before an update. It changes nothing.
// Run from the app folder:  node scripts\check-drafts.mjs
// It reads DATABASE_URL from .env.production, .env.local or .env (first one that has it).
import fs from 'node:fs';
import pg from 'pg';

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.production', '.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error('DATABASE_URL not found in .env.production, .env.local or .env');
}

const CHECKS = [
  {
    title: 'All saved drafts by form',
    sql: `SELECT form_type, COUNT(*)::int AS drafts, MIN(updated_at) AS oldest, MAX(updated_at) AS newest
          FROM form_draft GROUP BY form_type ORDER BY form_type`,
  },
  {
    title: 'Drafts older than 7 days (the app drops these on its next draft save or read)',
    sql: `SELECT d.id, d.form_type, d.scope_id, d.portion_key, u.username, d.updated_at
          FROM form_draft d JOIN users u ON u.id = d.user_id
          WHERE d.updated_at < (now() AT TIME ZONE 'UTC') - interval '7 days' ORDER BY d.updated_at`,
  },
  {
    title: 'Plant QA drafts whose vehicle is gone or already past QA',
    sql: `SELECT d.id, d.scope_id AS visit_id, v.vehicle_number, COALESCE(v.current_status, 'VISIT DELETED') AS visit_status, u.username, d.updated_at
          FROM form_draft d JOIN users u ON u.id = d.user_id
          LEFT JOIN vehicle_visit v ON v.id = d.scope_id
          WHERE d.form_type = 'PLANT_QA'
            AND (v.id IS NULL OR v.current_status IN ('READY_FOR_GROSS','WEIGHED_IN','UNLOADING','UNLOADED','READY_FOR_TARE',
                 'TARE_WEIGHED','READY_FOR_GATE_EXIT','COMPLETED','GATE_OUT','CANCELLED','REJECTED'))
          ORDER BY d.updated_at`,
  },
  {
    title: 'ZMCC lab drafts whose lab session is gone or already completed',
    sql: `SELECT d.id, d.form_type, d.scope_id AS lab_session_id, COALESCE(s.status, 'SESSION DELETED') AS session_status, u.username, d.updated_at
          FROM form_draft d JOIN users u ON u.id = d.user_id
          LEFT JOIN zmcc_lab_session s ON s.id = d.scope_id
          WHERE d.form_type IN ('ZMCC_LAB_MC','ZMCC_LAB_HC') AND (s.id IS NULL OR s.status = 'COMPLETED')
          ORDER BY d.updated_at`,
  },
  {
    title: 'Drafts of users who are no longer active',
    sql: `SELECT d.id, d.form_type, d.scope_id, u.username, d.updated_at
          FROM form_draft d JOIN users u ON u.id = d.user_id
          WHERE u.is_active = false ORDER BY d.updated_at`,
  },
  {
    title: 'Dispatches still saved as draft (older than 1 day)',
    sql: `SELECT v.id, v.visit_number, v.vehicle_number, s.name AS source, v.created_at
          FROM vehicle_visit v LEFT JOIN procurement_source s ON s.id = v.procurement_source_id
          WHERE v.current_status = 'DRAFT_DISPATCH' AND v.created_at < (now() AT TIME ZONE 'UTC') - interval '1 day'
          ORDER BY v.created_at`,
  },
];

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  for (const check of CHECKS) {
    const { rows } = await client.query(check.sql);
    console.log(`\n== ${check.title}: ${rows.length} row(s)`);
    if (rows.length) console.table(rows.slice(0, 50));
    if (rows.length > 50) console.log(`... and ${rows.length - 50} more`);
  }

  // Key health: every id counter (sequence) must be ahead of the highest id in its table, or the next insert fails
  // with "duplicate key". Gaps in ids are normal and are not listed.
  const { rows: seqs } = await client.query(`
    SELECT d.refobjid::regclass::text AS tbl, a.attname AS col, d.objid::regclass::text AS seq
    FROM pg_depend d
    JOIN pg_class sc ON sc.oid = d.objid AND sc.relkind = 'S'
    JOIN pg_class tc ON tc.oid = d.refobjid AND tc.relnamespace = 'public'::regnamespace
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass
    ORDER BY 1`);
  const behind = [];
  for (const s of seqs) {
    const { rows: [m] } = await client.query(`SELECT COALESCE(MAX("${s.col}"), 0)::text AS max_id, COUNT(*)::int AS row_count FROM ${s.tbl}`);
    const { rows: [q] } = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${s.seq}`);
    const nextId = BigInt(q.last_value) + (q.is_called ? 1n : 0n);
    if (nextId <= BigInt(m.max_id)) behind.push({ table: s.tbl, max_id: m.max_id, next_id: nextId.toString(), rows: m.row_count });
  }
  console.log(`\n== Id counters behind their table (next insert would fail): ${behind.length} of ${seqs.length} table(s)`);
  if (behind.length) console.table(behind);
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
console.log('\nNothing was changed.');
