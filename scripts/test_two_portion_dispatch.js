/**
 * -----------------------------------------------------------------------------------
 * ⚠️ DEVELOPMENT & TEST ENVIRONMENT ONLY SCRIPT
 * -----------------------------------------------------------------------------------
 * Test script for verifying two-portion ZMCC dispatch creation in PostgreSQL.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runTwoPortionTest() {
  console.log('\n===============================================================');
  console.log('⚠️ DEVELOPMENT / TEST ENVIRONMENT DISPATCH VERIFICATION SCRIPT');
  console.log('===============================================================\n');

  console.log('Testing two-portion ZMCC dispatch creation (Vehicle: KBL-8492, Portions: 1 and 2)...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const vehicleNumber = 'KBL-8492';
    const opDate = new Date();
    const visitNumber = `VV-TEST-${Date.now()}`;

    // 1. Create VehicleVisit
    const visitRes = await client.query(`
      INSERT INTO vehicle_visit (visit_number, vehicle_number, operational_date, current_status, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, 'DISPATCHED', 1, NOW(), NOW())
      RETURNING id, visit_number, vehicle_number, current_status;
    `, [visitNumber, vehicleNumber, opDate]);

    const visit = visitRes.rows[0];
    const visitId = visit.id;

    // 2. Fetch active dispatch tests (27 tests)
    const testRes = await client.query(`
      SELECT id, test_code, result_type FROM lab_test WHERE is_active = true AND test_scope IN ('DISPATCH', 'BOTH') ORDER BY display_order ASC;
    `);
    const activeTests = testRes.rows;

    const portion1Res = await client.query(`
      INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
      VALUES ($1, 1, 'DISPATCHED', 15000, 'PENDING', NOW(), NOW())
      RETURNING id, portion_number;
    `, [visitId]);
    const portion1 = portion1Res.rows[0];

    const portion2Res = await client.query(`
      INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
      VALUES ($1, 2, 'DISPATCHED', 12000, 'PENDING', NOW(), NOW())
      RETURNING id, portion_number;
    `, [visitId]);
    const portion2 = portion2Res.rows[0];

    // Create DispatchInfo for portion 1 and portion 2
    await client.query(`
      INSERT INTO dispatch_info (portion_id, dispatch_number, dispatch_timestamp, recorded_by, created_at, updated_at)
      VALUES ($1, $2, NOW(), 1, NOW(), NOW());
    `, [portion1.id, `DISP-${visitNumber}-P1`]);

    await client.query(`
      INSERT INTO dispatch_info (portion_id, dispatch_number, dispatch_timestamp, recorded_by, created_at, updated_at)
      VALUES ($1, $2, NOW(), 1, NOW(), NOW());
    `, [portion2.id, `DISP-${visitNumber}-P2`]);

    // Insert 27 DispatchLabResult rows for Portion 1
    for (const t of activeTests) {
      const fatVal = t.test_code === 'FAT' ? 3.8 : null;
      const lrVal = t.test_code === 'LR' || t.test_code === 'LR_20C' ? 28.5 : null;
      await client.query(`
        INSERT INTO dispatch_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, text_value, is_passed, tested_by, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, true, 1, NOW(), NOW());
      `, [visitId, portion1.id, t.id, fatVal || lrVal, t.result_type !== 'NUMERIC' ? 'OK' : null]);
    }

    // Insert 27 DispatchLabResult rows for Portion 2
    for (const t of activeTests) {
      const fatVal = t.test_code === 'FAT' ? 4.2 : null;
      const lrVal = t.test_code === 'LR' || t.test_code === 'LR_20C' ? 29.0 : null;
      await client.query(`
        INSERT INTO dispatch_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, text_value, is_passed, tested_by, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, true, 1, NOW(), NOW());
      `, [visitId, portion2.id, t.id, fatVal || lrVal, t.result_type !== 'NUMERIC' ? 'OK' : null]);
    }

    await client.query('COMMIT');

    // Verify created rows in database
    const verifyVisits = await client.query('SELECT id, visit_number, vehicle_number FROM vehicle_visit WHERE id = $1', [visitId]);
    const verifyPortions = await client.query('SELECT id, portion_number, declared_quantity_kg FROM visit_portion WHERE visit_id = $1 ORDER BY portion_number ASC', [visitId]);
    const verifyResultsP1 = await client.query('SELECT COUNT(*) FROM dispatch_lab_result WHERE portion_id = $1', [portion1.id]);
    const verifyResultsP2 = await client.query('SELECT COUNT(*) FROM dispatch_lab_result WHERE portion_id = $1', [portion2.id]);

    console.log('✅ DATABASE VERIFICATION RESULTS:');
    console.log('VehicleVisit Created:', verifyVisits.rows[0]);
    console.log('VisitPortion Rows Created:', verifyPortions.rows);
    console.log(`DispatchLabResult Count for Portion #1 (ID ${portion1.id}):`, verifyResultsP1.rows[0].count);
    console.log(`DispatchLabResult Count for Portion #2 (ID ${portion2.id}):`, verifyResultsP2.rows[0].count);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during two-portion test:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runTwoPortionTest();
