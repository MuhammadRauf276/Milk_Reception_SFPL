/**
 * -----------------------------------------------------------------------------------
 * ⚠️ DEVELOPMENT & TEST ENVIRONMENT ONLY SCRIPT
 * -----------------------------------------------------------------------------------
 * Inspects recent vehicle visits in PostgreSQL database.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function inspectVisits() {
  console.log('\n===============================================================');
  console.log('⚠️ DEVELOPMENT / TEST ENVIRONMENT READ-ONLY INSPECTION SCRIPT');
  console.log('===============================================================\n');

  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT 
        vv.id, 
        vv.visit_number, 
        vv.vehicle_number, 
        vv.current_status, 
        vv.created_at,
        (SELECT COUNT(*) FROM visit_portion vp WHERE vp.visit_id = vv.id) as portion_count,
        (SELECT COUNT(*) FROM dispatch_lab_result dlr WHERE dlr.visit_id = vv.id) as dispatch_result_count
      FROM vehicle_visit vv
      ORDER BY vv.id DESC
      LIMIT 10;
    `);

    console.log('Most recent 10 vehicle visits in PostgreSQL:');
    console.table(res.rows);
  } catch (err) {
    console.error('Error querying visits:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

inspectVisits();
