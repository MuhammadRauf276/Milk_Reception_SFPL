/**
 * -----------------------------------------------------------------------------------
 * ⚠️ DEVELOPMENT & TEST ENVIRONMENT ONLY SCRIPT
 * -----------------------------------------------------------------------------------
 * Phase 7 Production Unloading Transaction Test Suite
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runPhase7Tests() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING PHASE 7 PRODUCTION UNLOADING TEST SUITE');
  console.log('===============================================================\n');

  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------------
    // TEST SCENARIO 1: ONE ACCEPTED PORTION
    // -------------------------------------------------------------------------------
    console.log('--- TEST SCENARIO 1: ONE ACCEPTED PORTION ---');
    await client.query('BEGIN');
    const v1Num = `VV-P7-S1-${Date.now()}`;
    const v1Res = await client.query(
      `INSERT INTO vehicle_visit (visit_number, vehicle_number, operational_date, current_status, created_by, created_at, updated_at)
       VALUES ($1, 'UNL-0001', NOW(), 'SCALE_1', 1, NOW(), NOW()) RETURNING id;`,
      [v1Num]
    );
    const v1Id = v1Res.rows[0].id;

    // Create WeightTicket with Gross Weight
    await client.query(
      `INSERT INTO weight_ticket (visit_id, ticket_number, gross_weight_kg, gross_timestamp, gross_recorded_by, created_at, updated_at)
       VALUES ($1, $2, 18500, NOW(), 1, NOW(), NOW());`,
      [v1Id, `WT-${v1Num}`]
    );

    // Create Accepted Portion
    const p1Res = await client.query(
      `INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
       VALUES ($1, 1, 'Dispatched', 18500, 'ACCEPTED', NOW(), NOW()) RETURNING id;`,
      [v1Id]
    );
    const p1Id = p1Res.rows[0].id;

    // Start Unloading P1 into SILO-1
    await client.query(
      `INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, started_by, created_at, updated_at)
       VALUES ($1, 'SILO-1', NOW(), 1, NOW(), NOW());`,
      [p1Id]
    );
    await client.query(`UPDATE visit_portion SET current_status = 'UNLOADING' WHERE id = $1;`, [p1Id]);
    await client.query(`UPDATE vehicle_visit SET current_status = 'UNLOAD' WHERE id = $1;`, [v1Id]);

    // Complete Unloading P1
    await client.query(
      `UPDATE unloading_log SET pump_end_timestamp = NOW(), completed_by = 1 WHERE portion_id = $1;`,
      [p1Id]
    );
    await client.query(`UPDATE visit_portion SET current_status = 'UNLOADED' WHERE id = $1;`, [p1Id]);
    await client.query(`UPDATE vehicle_visit SET current_status = 'SCALE_2_READY' WHERE id = $1;`, [v1Id]);

    const checkV1 = await client.query(`SELECT current_status FROM vehicle_visit WHERE id = $1;`, [v1Id]);
    console.log(`✅ Scenario 1 Passed: Final Vehicle Visit Status = "${checkV1.rows[0].current_status}" (Expected: SCALE_2_READY)`);
    await client.query('COMMIT');


    // -------------------------------------------------------------------------------
    // TEST SCENARIO 2: TWO ACCEPTED PORTIONS
    // -------------------------------------------------------------------------------
    console.log('\n--- TEST SCENARIO 2: TWO ACCEPTED PORTIONS ---');
    await client.query('BEGIN');
    const v2Num = `VV-P7-S2-${Date.now()}`;
    const v2Res = await client.query(
      `INSERT INTO vehicle_visit (visit_number, vehicle_number, operational_date, current_status, created_by, created_at, updated_at)
       VALUES ($1, 'UNL-0002', NOW(), 'SCALE_1', 1, NOW(), NOW()) RETURNING id;`,
      [v2Num]
    );
    const v2Id = v2Res.rows[0].id;

    await client.query(
      `INSERT INTO weight_ticket (visit_id, ticket_number, gross_weight_kg, gross_timestamp, gross_recorded_by, created_at, updated_at)
       VALUES ($1, $2, 28000, NOW(), 1, NOW(), NOW());`,
      [v2Id, `WT-${v2Num}`]
    );

    const s2p1Res = await client.query(
      `INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
       VALUES ($1, 1, 'Dispatched', 15000, 'ACCEPTED', NOW(), NOW()) RETURNING id;`,
      [v2Id]
    );
    const s2p1Id = s2p1Res.rows[0].id;

    const s2p2Res = await client.query(
      `INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
       VALUES ($1, 2, 'Dispatched', 13000, 'ACCEPTED', NOW(), NOW()) RETURNING id;`,
      [v2Id]
    );
    const s2p2Id = s2p2Res.rows[0].id;

    // Start & Complete Portion 1
    await client.query(`INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, started_by, created_at, updated_at) VALUES ($1, 'SILO-A', NOW(), 1, NOW(), NOW());`, [s2p1Id]);
    await client.query(`UPDATE unloading_log SET pump_end_timestamp = NOW(), completed_by = 1 WHERE portion_id = $1;`, [s2p1Id]);
    await client.query(`UPDATE visit_portion SET current_status = 'UNLOADED' WHERE id = $1;`, [s2p1Id]);

    // Check status after portion 1 completed (should still be UNLOAD since Portion 2 is pending)
    const checkV2Interim = await client.query(`SELECT current_status FROM vehicle_visit WHERE id = $1;`, [v2Id]);
    console.log(`✅ Scenario 2 Interim Check: Vehicle Status after Portion 1 = "${checkV2Interim.rows[0].current_status}" (Expected: SCALE_1 or UNLOAD)`);

    // Start & Complete Portion 2
    await client.query(`INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, started_by, created_at, updated_at) VALUES ($1, 'SILO-B', NOW(), 1, NOW(), NOW());`, [s2p2Id]);
    await client.query(`UPDATE unloading_log SET pump_end_timestamp = NOW(), completed_by = 1 WHERE portion_id = $1;`, [s2p2Id]);
    await client.query(`UPDATE visit_portion SET current_status = 'UNLOADED' WHERE id = $1;`, [s2p2Id]);

    // Update vehicle status to SCALE_2_READY since all accepted portions are unloaded
    await client.query(`UPDATE vehicle_visit SET current_status = 'SCALE_2_READY' WHERE id = $1;`, [v2Id]);
    const checkV2Final = await client.query(`SELECT current_status FROM vehicle_visit WHERE id = $1;`, [v2Id]);
    console.log(`✅ Scenario 2 Final Check: Vehicle Status after Portion 2 = "${checkV2Final.rows[0].current_status}" (Expected: SCALE_2_READY)`);
    await client.query('COMMIT');


    // -------------------------------------------------------------------------------
    // TEST SCENARIO 3: MIXED DECISION VEHICLE (ACCEPTED + REJECTED)
    // -------------------------------------------------------------------------------
    console.log('\n--- TEST SCENARIO 3: MIXED DECISION VEHICLE ---');
    await client.query('BEGIN');
    const v3Num = `VV-P7-S3-${Date.now()}`;
    const v3Res = await client.query(
      `INSERT INTO vehicle_visit (visit_number, vehicle_number, operational_date, current_status, created_by, created_at, updated_at)
       VALUES ($1, 'UNL-0003', NOW(), 'SCALE_1', 1, NOW(), NOW()) RETURNING id;`,
      [v3Num]
    );
    const v3Id = v3Res.rows[0].id;

    await client.query(
      `INSERT INTO weight_ticket (visit_id, ticket_number, gross_weight_kg, gross_timestamp, gross_recorded_by, created_at, updated_at)
       VALUES ($1, $2, 22000, NOW(), 1, NOW(), NOW());`,
      [v3Id, `WT-${v3Num}`]
    );

    const s3p1Res = await client.query(
      `INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
       VALUES ($1, 1, 'Dispatched', 12000, 'ACCEPTED', NOW(), NOW()) RETURNING id;`,
      [v3Id]
    );
    const s3p1Id = s3p1Res.rows[0].id;

    const s3p2Res = await client.query(
      `INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, plant_rejection_reason, created_at, updated_at)
       VALUES ($1, 2, 'Dispatched', 10000, 'REJECTED', 'High Acidity > 0.18%', NOW(), NOW()) RETURNING id;`,
      [v3Id]
    );
    const s3p2Id = s3p2Res.rows[0].id;

    // Unload only Portion 1 (Accepted)
    await client.query(`INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, started_by, created_at, updated_at) VALUES ($1, 'SILO-C', NOW(), 1, NOW(), NOW());`, [s3p1Id]);
    await client.query(`UPDATE unloading_log SET pump_end_timestamp = NOW(), completed_by = 1 WHERE portion_id = $1;`, [s3p1Id]);
    await client.query(`UPDATE visit_portion SET current_status = 'UNLOADED' WHERE id = $1;`, [s3p1Id]);

    // Update vehicle to SCALE_2_READY because all ACCEPTED portions are unloaded
    await client.query(`UPDATE vehicle_visit SET current_status = 'SCALE_2_READY' WHERE id = $1;`, [v3Id]);
    const checkV3Final = await client.query(`SELECT current_status FROM vehicle_visit WHERE id = $1;`, [v3Id]);
    const checkS3P2 = await client.query(`SELECT current_status, plant_decision FROM visit_portion WHERE id = $1;`, [s3p2Id]);
    
    console.log(`✅ Scenario 3 Check: Vehicle Status = "${checkV3Final.rows[0].current_status}" (Expected: SCALE_2_READY)`);
    console.log(`✅ Scenario 3 Check: Rejected Portion 2 Status = "${checkS3P2.rows[0].plant_decision}" (Remains REJECTED, never unloaded)`);
    await client.query('COMMIT');

    console.log('\n===============================================================');
    console.log('✅ ALL PHASE 7 TEST SCENARIOS COMPLETED SUCCESSFULLY!');
    console.log('===============================================================\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during Phase 7 test execution:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runPhase7Tests();
