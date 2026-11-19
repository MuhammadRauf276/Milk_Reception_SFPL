/**
 * Read-only check before switching time columns to "timestamp with time zone".
 * Changes nothing: everything runs inside a READ ONLY transaction that is rolled back.
 *
 * Run on the VM from the app folder:   node scripts\check-timestamps.js > timestamps-check.txt
 * It reads DATABASE_URL from the app's .env, like the other scripts.
 */
require('dotenv').config();
const { Client } = require('pg');

function table(rows) {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.min(48, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))));
  const line = (vals) => '  ' + vals.map((v, i) => String(v ?? '').slice(0, 48).padEnd(width[i])).join('  ');
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const q = async (title, sql) => {
    const { rows } = await client.query(sql);
    console.log(`\n== ${title}\n${table(rows)}`);
    return rows;
  };

  try {
    await client.query('BEGIN TRANSACTION READ ONLY');

    await q('1. Database and clocks', `
      SELECT version() AS postgres,
             current_setting('TimeZone') AS db_time_zone,
             now()::text AS db_now,
             (now() AT TIME ZONE 'UTC')::text AS utc_now,
             (now() AT TIME ZONE 'Asia/Karachi')::text AS pakistan_now`);

    await q('2. Time columns by type', `
      SELECT data_type, COUNT(*) AS columns, COUNT(DISTINCT table_name) AS tables
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date')
      GROUP BY data_type ORDER BY data_type`);

    const naive = await q('3. Columns without time zone (to convert)', `
      SELECT c.table_name, string_agg(c.column_name, ', ' ORDER BY c.ordinal_position) AS columns, COUNT(*) AS n
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp without time zone'
      GROUP BY c.table_name ORDER BY c.table_name`);

    await q('4. Views that use those columns (must be rebuilt around the change)', `
      SELECT DISTINCT u.view_name, v.table_type
      FROM information_schema.view_column_usage u
      JOIN information_schema.columns c
        ON c.table_schema = u.table_schema AND c.table_name = u.table_name AND c.column_name = u.column_name
      JOIN information_schema.tables v ON v.table_schema = u.view_schema AND v.table_name = u.view_name
      WHERE u.view_schema = 'public' AND c.data_type = 'timestamp without time zone'
      ORDER BY u.view_name`);

    await q('5. Materialized views (also block a column type change)', `
      SELECT matviewname FROM pg_matviews WHERE schemaname = 'public' ORDER BY 1`);

    await q('6. Column defaults on those columns', `
      SELECT column_default, COUNT(*) AS columns
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp without time zone'
        AND column_default IS NOT NULL
      GROUP BY column_default ORDER BY columns DESC`);

    await q('7. updated_at triggers by function', `
      SELECT p.proname AS function, COUNT(*) AS tables
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      JOIN pg_class cl ON cl.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = 'public' AND tg.tgname = 'trg_set_updated_at'
      GROUP BY p.proname`);

    await q('8. Other functions that mention now() or time zones', `
      SELECT p.proname AS function
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND (p.prosrc ILIKE '%now()%' OR p.prosrc ILIKE '%time zone%' OR p.prosrc ILIKE '%current_timestamp%')
      ORDER BY 1`);

    // 9. Values that look like Pakistan time stored where UTC is expected: more than 10 minutes ahead of UTC now.
    const ahead = [];
    for (const t of naive) {
      for (const col of String(t.columns).split(', ')) {
        // Columns meant to hold future times.
        if (['catch_up_until', 'expires_at', 'effective_to'].includes(col)) continue;
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS n, MAX(${JSON.stringify(col)})::text AS latest FROM ${JSON.stringify(t.table_name)}
           WHERE ${JSON.stringify(col)} > (now() AT TIME ZONE 'UTC') + interval '10 minutes'`
        );
        if (rows[0].n > 0) ahead.push({ table: t.table_name, column: col, rows_ahead: rows[0].n, latest: rows[0].latest });
      }
    }
    console.log(`\n== 9. Values ahead of UTC now (stored as Pakistan time, or entered in the future)\n${table(ahead)}`);

    await q('10. Table sizes (rows) for the biggest tables with such columns', `
      SELECT relname AS table_name, n_live_tup AS rows
      FROM pg_stat_user_tables
      WHERE relname IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'timestamp without time zone')
      ORDER BY n_live_tup DESC LIMIT 15`);

    await client.query('ROLLBACK');
    console.log('\nDone. Nothing was changed.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Check failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
