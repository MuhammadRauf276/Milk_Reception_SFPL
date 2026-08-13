/**
 * -----------------------------------------------------------------------------------
 * ⚠️ DEVELOPMENT & TEST ENVIRONMENT ONLY SCRIPT
 * -----------------------------------------------------------------------------------
 * Safely deletes a specific vehicle visit by its exact visit_number string.
 *
 * Usage:
 *   node scripts/delete_test_visit.js <VISIT_NUMBER>
 *
 * Example:
 *   node scripts/delete_test_visit.js VV-TEST-1785931002667
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function deleteSpecificVisit() {
  const targetVisitNumber = process.argv[2];

  console.log('\n===============================================================');
  console.log('⚠️ DEVELOPMENT / TEST ENVIRONMENT MAINTENANCE SCRIPT');
  console.log('===============================================================\n');

  if (!targetVisitNumber || targetVisitNumber.trim() === '') {
    console.error('❌ Error: Explicit visit_number argument is required.');
    console.error('Usage: node scripts/delete_test_visit.js <VISIT_NUMBER>');
    console.error('Example: node scripts/delete_test_visit.js VV-TEST-1785931002667\n');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch visit details by explicit visit_number
    const visitRes = await client.query('SELECT * FROM vehicle_visit WHERE visit_number = $1', [targetVisitNumber]);
    if (visitRes.rows.length === 0) {
      console.log(`⚠️ No vehicle visit found with visit_number "${targetVisitNumber}".`);
      await client.query('ROLLBACK');
      return;
    }

    const visit = visitRes.rows[0];
    const visitId = visit.id;

    console.log(`Target Visit Found: ID = ${visit.id}, Visit # = ${visit.visit_number}, Vehicle # = ${visit.vehicle_number}`);

    // 2. Fetch portion IDs for this visit
    const portionRes = await client.query('SELECT id FROM visit_portion WHERE visit_id = $1', [visitId]);
    const portionIds = portionRes.rows.map(r => r.id);

    if (portionIds.length > 0) {
      // Delete child records of visit_portion
      await client.query('DELETE FROM dispatch_lab_result WHERE portion_id = ANY($1::bigint[])', [portionIds]);
      await client.query('DELETE FROM plant_lab_result WHERE portion_id = ANY($1::bigint[])', [portionIds]);
      await client.query('DELETE FROM dispatch_info WHERE portion_id = ANY($1::bigint[])', [portionIds]);
      await client.query('DELETE FROM unloading_log WHERE portion_id = ANY($1::bigint[])', [portionIds]);
    }

    // Delete child records of vehicle_visit
    await client.query('DELETE FROM dispatch_lab_result WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM plant_lab_result WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM gate_log WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM weight_ticket WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM visit_portion WHERE visit_id = $1', [visitId]);

    // Delete parent vehicle_visit row
    await client.query('DELETE FROM vehicle_visit WHERE id = $1', [visitId]);

    // Reset sequence safely
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('vehicle_visit', 'id'),
        COALESCE((SELECT MAX(id) FROM vehicle_visit), 0) + 1,
        false
      );
    `);

    await client.query('COMMIT');
    console.log(`✅ Successfully deleted visit "${visit.visit_number}" (${visit.vehicle_number})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error executing delete transaction:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

deleteSpecificVisit();
