const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:rauf@localhost:5432/milk_reception_db'
});

const tables = [
  'vehicle_visit',
  'visit_portion',
  'dispatch_info',
  'gate_log',
  'lab_test',
  'dispatch_lab_result',
  'plant_lab_result',
  'weight_ticket',
  'unloading_log',
  'audit_log',
  'users'
];

async function fixSequences() {
  console.log('Fixing PostgreSQL auto-increment sequences for all ERD tables...');
  const client = await pool.connect();

  try {
    for (const table of tables) {
      const sql = `
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1,
          false
        );
      `;
      const res = await client.query(sql);
      console.log(`Updated sequence for table "${table}": NEXT ID = ${res.rows[0].setval}`);
    }
    console.log('✅ All PostgreSQL sequences reset successfully!');
  } catch (err) {
    console.error('Error resetting sequences:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixSequences();
