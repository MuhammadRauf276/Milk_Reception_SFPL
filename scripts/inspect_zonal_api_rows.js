const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function test() {
  console.log('Querying PostgreSQL vehicle_visit JOIN visit_portion...\n');
  const res = await pool.query(`
    SELECT 
      vv.id AS visit_id,
      vv.visit_number,
      vv.vehicle_number,
      vp.id AS portion_id,
      vp.portion_number,
      vp.declared_quantity_kg
    FROM vehicle_visit vv
    JOIN visit_portion vp ON vv.id = vp.visit_id
    ORDER BY vv.id DESC, vp.portion_number ASC;
  `);

  console.log(`Total rows returned by SQL join: ${res.rows.length}\n`);

  const visitCounts = new Map();
  for (const row of res.rows) {
    const vId = String(row.visit_id);
    if (!visitCounts.has(vId)) visitCounts.set(vId, []);
    visitCounts.get(vId).push(row);
  }

  for (const [visitId, rows] of visitCounts.entries()) {
    console.log(`Visit ID: ${visitId} (${rows[0].visit_number}, Vehicle: ${rows[0].vehicle_number}) -> ${rows.length} Portion Row(s):`);
    for (const r of rows) {
      console.log(`  - Portion ID: ${r.portion_id}, Portion Number: ${r.portion_number}, Quantity: ${r.declared_quantity_kg} kg`);
    }
  }
}

test().catch(console.error).finally(() => pool.end());
