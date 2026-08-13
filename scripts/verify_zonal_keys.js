const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:rauf@localhost:5432/milk_reception_db',
});

async function test() {
  console.log('Testing composite key generation for ZonalHistoryTable across all PostgreSQL records...\n');
  const res = await pool.query(`
    SELECT 
      vv.id AS visit_id,
      vp.id AS portion_id,
      vp.portion_number
    FROM vehicle_visit vv
    JOIN visit_portion vp ON vv.id = vp.visit_id
    ORDER BY vv.id DESC, vp.portion_number ASC;
  `);

  const generatedKeys = res.rows.map((row) => {
    const portionKey = row.portion_id ? String(row.portion_id) : `P-${String(row.portion_number).padStart(2, '0')}`;
    return `zonal-history-log-${String(row.visit_id)}-${portionKey}`;
  });

  const uniqueKeys = new Set(generatedKeys);
  console.log(`Total Rows: ${generatedKeys.length}`);
  console.log(`Unique Keys Generated: ${uniqueKeys.size}`);

  if (generatedKeys.length === uniqueKeys.size) {
    console.log('\n SUCCESS: 0 Duplicate Keys Found! All portion keys are 100% unique and stable.');
  } else {
    console.error('\n FAILURE: Duplicate keys detected!');
    const seen = new Set();
    for (const key of generatedKeys) {
      if (seen.has(key)) console.error(`Duplicate Key: ${key}`);
      seen.add(key);
    }
  }
}

test().catch(console.error).finally(() => pool.end());
