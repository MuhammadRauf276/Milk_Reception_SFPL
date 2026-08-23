const { Client } = require('pg');

async function seedDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL milk_reception_db successfully.');

    // 1. Truncate existing tables clean
    console.log('Truncating tables...');
    await client.query(`
      TRUNCATE TABLE 
        audit_log, 
        unloading_log, 
        weight_ticket, 
        plant_lab_result, 
        dispatch_lab_result, 
        lab_test, 
        gate_log, 
        dispatch_info, 
        visit_portion, 
        vehicle_visit, 
        users 
      RESTART IDENTITY CASCADE;
    `);

    // 2. Insert Users
    console.log('Inserting Users...');
    const userInsertQuery = `
      INSERT INTO users (id, full_name, username, password_hash, role, is_active, created_at, updated_at)
      VALUES 
        (1, 'ZMCC Field Operator', 'zmcc.operator', 'mpd123', 'MPD_Operator', true, NOW(), NOW()),
        (2, 'ZMCC Minor Manager (Northern Zone)', 'zmcc.manager.north', 'zone123', 'MPD_Zone_Manager', true, NOW(), NOW()),
        (3, 'Security Gate Operator', 'security.gate', 'security123', 'Security_Operator', true, NOW(), NOW()),
        (4, 'Security Admin Manager (Head)', 'security.head', 'sechead123', 'Security_Manager', true, NOW(), NOW()),
        (5, 'QA Lab Testing Chemist', 'qa.chemist', 'qa123', 'QA_Operator', true, NOW(), NOW()),
        (6, 'QA Department Manager', 'qa.head', 'qahead123', 'QA_Manager', true, NOW(), NOW()),
        (7, 'Production Operations Officer', 'production.operator', 'production123', 'Production_Operator', true, NOW(), NOW()),
        (8, 'Production Department Manager', 'production.head', 'prodhead123', 'Production_Manager', true, NOW(), NOW()),
        (9, 'General Plant Manager', 'general.plant.manager', 'plantmanager123', 'General_Plant_Manager', true, NOW(), NOW()),
        (10, 'Dedicated Data Correction Officer', 'correction.officer', 'correct123', 'Correction_Officer', true, NOW(), NOW()),
        (11, 'System Administrator', 'admin.superuser', 'admin123', 'Admin', true, NOW(), NOW());
    `;
    await client.query(userInsertQuery);

    // 3. Insert Lab Tests
    console.log('Inserting Lab Tests...');
    const labTestQuery = `
      INSERT INTO lab_test (id, test_code, test_name, result_type, unit, test_scope, is_required, is_active, created_at, updated_at)
      VALUES
        (1, 'FAT', 'Fat Percentage', 'numeric', '%', 'both', true, true, NOW(), NOW()),
        (2, 'LR', 'Lactometer Reading', 'numeric', 'deg', 'both', true, true, NOW(), NOW()),
        (3, 'SNF', 'Solids-Not-Fat', 'numeric', '%', 'both', true, true, NOW(), NOW()),
        (4, 'MBRT', 'Methylene Blue Reduction Test', 'numeric', 'mins', 'plant', true, true, NOW(), NOW()),
        (5, 'COB', 'Clot On Boiling', 'text', 'boolean', 'both', true, true, NOW(), NOW()),
        (6, 'ALCOHOL', 'Alcohol Stability Test', 'text', 'boolean', 'both', true, true, NOW(), NOW()),
        (7, 'ACIDITY', 'Titratable Acidity', 'numeric', '%', 'plant', false, true, NOW(), NOW());
    `;
    await client.query(labTestQuery);

    // 4. Generate 15 Days of Seed Dispatches
    console.log('Inserting Vehicle Visits & Portions...');
    const zones = [
      'Northern Dairy Logistics',
      'Central Milk Suppliers',
      'Indus Valley Dairy Co-op',
      'Punjab Green Farms',
    ];

    const vehicles = [
      'KBL-8492', 'LHR-3341', 'ISL-9910', 'KBL-1029', 'SKT-8812',
      'KBL-7741', 'LHR-9901', 'KBL-4011', 'KBL-9001', 'SKT-2201',
      'ISL-4412', 'LHR-8820', 'KBL-3309', 'SKT-1190', 'ISL-5521'
    ];

    const baseDate = new Date('2026-07-29T12:00:00Z');
    let visitIdCounter = 1;
    let portionIdCounter = 1;

    for (let dayOffset = 14; dayOffset >= 0; dayOffset--) {
      const logDate = new Date(baseDate.getTime() - dayOffset * 86400000);
      const dateStr = logDate.toISOString().split('T')[0];

      for (let idx = 0; idx < 3; idx++) {
        const vNum = vehicles[(dayOffset * 3 + idx) % vehicles.length];
        const zName = zones[(dayOffset + idx) % zones.length];
        const portionNum = idx + 1;

        let status = 'Completed';
        let plantDecision = 'Accepted';
        let rejectionReason = null;

        if (dayOffset === 0) {
          if (idx === 0) status = 'Dispatched';
          else if (idx === 1) status = 'Sampling';
          else status = 'First Weight';
        } else if (dayOffset === 1 && idx === 0) {
          status = 'Silo Reception';
        } else if (dayOffset === 2 && idx === 1) {
          status = 'Second Weight';
        }

        if (dayOffset === 4 && idx === 1) {
          plantDecision = 'Rejected';
          rejectionReason = 'High Water Adulteration (SNF 7.42% below 8.5% spec) and Failed MBRT (45 mins).';
        } else if (dayOffset === 9 && idx === 2) {
          plantDecision = 'Rejected';
          rejectionReason = 'High Acidity (COB Positive & Alcohol Test Failed at 70%).';
        }

        const visitNum = `VISIT-2026-${String(visitIdCounter).padStart(4, '0')}`;
        const tokenNum = status === 'Dispatched' ? null : `TK-${9000 + visitIdCounter}`;

        const grossKg = 12000 + (dayOffset * 350 + idx * 800) % 7000;

        // Insert Vehicle Visit
        await client.query(`
          INSERT INTO vehicle_visit (
            id, visit_number, vehicle_number, token_number, operational_date, current_status, created_by,
            vehicle_dispatch_quantity_value, vehicle_dispatch_quantity_unit, vehicle_dispatch_quantity_basis, vehicle_dispatch_measurement_method,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'KG', 'MEASURED', 'WEIGHING', $8, $9);
        `, [visitIdCounter, visitNum, vNum, tokenNum, dateStr, status, grossKg, logDate, logDate]);

        // Insert Visit Portion
        await client.query(`
          INSERT INTO visit_portion (
            id, visit_id, portion_number, current_status,
            dispatch_quantity_value, dispatch_quantity_unit, dispatch_quantity_basis, dispatch_measurement_method,
            plant_decision, plant_rejection_reason, plant_decided_by, plant_decided_at, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 'KG', 'MEASURED', 'WEIGHING', $6, $7, $8, $9, $10, $11);
        `, [portionIdCounter, visitIdCounter, portionNum, status, grossKg, plantDecision, rejectionReason, plantDecision === 'Rejected' ? 5 : 5, logDate, logDate, logDate]);

        // Insert Dispatch Info
        const dispatchNum = `DISP-${zName.substring(0, 3).toUpperCase()}-${dateStr.replace(/-/g, '')}-${idx + 1}`;
        await client.query(`
          INSERT INTO dispatch_info (id, portion_id, dispatch_number, dispatch_timestamp, recorded_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 1, $5, $6);
        `, [portionIdCounter, portionIdCounter, dispatchNum, logDate, logDate, logDate]);

        // Insert Gate Log if passed token stage
        if (status !== 'Dispatched') {
          const entryTime = new Date(logDate.getTime() + 3600000);
          const exitTime = status === 'Completed' ? new Date(logDate.getTime() + 7200000) : null;
          await client.query(`
            INSERT INTO gate_log (id, visit_id, entry_timestamp, exit_timestamp, entry_guard_id, exit_guard_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 3, $5, $6, $7);
          `, [visitIdCounter, visitIdCounter, entryTime, exitTime, exitTime ? 3 : null, logDate, logDate]);
        }

        // Insert Dispatch Lab Results
        const fatVal = 3.6 + ((dayOffset + idx) % 7) * 0.1;
        const lrVal = 27.8 + ((dayOffset * 2 + idx) % 15) * 0.1;
        const snfVal = Number(((lrVal / 4) + (0.22 * fatVal) + 0.72).toFixed(2));

        await client.query(`
          INSERT INTO dispatch_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, text_value, is_passed, tested_by, created_at, updated_at)
          VALUES 
            ($1, $2, 1, $3, $3, $4, NULL, true, 1, $3, $3),
            ($1, $2, 2, $3, $3, $5, NULL, true, 1, $3, $3),
            ($1, $2, 3, $3, $3, $6, NULL, true, 1, $3, $3);
        `, [visitIdCounter, portionIdCounter, logDate, fatVal.toFixed(2), lrVal.toFixed(1), snfVal.toFixed(2)]);

        // Insert Plant Lab Results if sampled
        if (status !== 'Dispatched' && status !== 'Token Issued') {
          const plantFat = Number((fatVal + 0.05).toFixed(2));
          const plantLr = Number((lrVal + 0.1).toFixed(1));
          const plantSnf = Number(((plantLr / 4) + (0.22 * plantFat) + 0.72).toFixed(2));
          const mbrtMins = plantDecision === 'Rejected' ? 45 : 210 + (idx * 30);

          await client.query(`
            INSERT INTO plant_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, text_value, is_passed, tested_by, created_at, updated_at)
            VALUES 
              ($1, $2, 1, $3, $3, $4, NULL, true, 5, $3, $3),
              ($1, $2, 2, $3, $3, $5, NULL, true, 5, $3, $3),
              ($1, $2, 3, $3, $3, $6, NULL, true, 5, $3, $3),
              ($1, $2, 4, $3, $3, $7, NULL, $8, 5, $3, $3);
          `, [visitIdCounter, portionIdCounter, logDate, plantFat.toFixed(2), plantLr.toFixed(1), plantSnf.toFixed(2), mbrtMins, plantDecision !== 'Rejected']);
        }

        // Insert Weight Ticket if 1st weight recorded
        if (status !== 'Dispatched' && status !== 'Token Issued' && status !== 'Sampling') {
          const grossW = 28000 + (grossKg % 6000);
          const tareW = (status === 'Completed' || status === 'Second Weight') ? grossW - grossKg : null;
          const netW = tareW ? grossW - tareW : null;
          const ticketNum = `WT-2026-${String(visitIdCounter).padStart(4, '0')}`;

          await client.query(`
            INSERT INTO weight_ticket (visit_id, ticket_number, gross_weight_kg, gross_timestamp, gross_recorded_by, tare_weight_kg, tare_timestamp, tare_recorded_by, net_weight_kg, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 7, $5, $6, $7, $8, $4, $4);
          `, [visitIdCounter, ticketNum, grossW, logDate, tareW, tareW ? logDate : null, tareW ? 7 : null, netW]);
        }

        // Insert Unloading Log if in silo
        if (status === 'Silo Reception' || status === 'Completed') {
          const siloId = `Silo #${(idx % 4) + 1} / Tank ${String.fromCharCode(65 + idx)}`;
          const pumpStart = new Date(logDate.getTime() + 5400000);
          const pumpEnd = status === 'Completed' ? new Date(logDate.getTime() + 6900000) : null;

          await client.query(`
            INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, pump_end_timestamp, started_by, completed_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 7, $5, $6, $6);
          `, [portionIdCounter, siloId, pumpStart, pumpEnd, pumpEnd ? 7 : null, logDate]);
        }

        visitIdCounter++;
        portionIdCounter++;
      }
    }

    // Insert Audit Logs
    console.log('Inserting Audit Logs...');
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, created_at)
      VALUES 
        ('visit_portion', 14, 'UPDATE', '{"plant_decision": "Pending"}'::jsonb, '{"plant_decision": "Rejected"}'::jsonb, 5, NOW() - INTERVAL '3 hours'),
        ('weight_ticket', 12, 'UPDATE', '{"gross_weight_kg": 28400}'::jsonb, '{"gross_weight_kg": 28450}'::jsonb, 7, NOW() - INTERVAL '1 day');
    `);

    console.log('✅ DATABASE SUCCESSFULLY SEEDED WITH COMPLETE ERD DUMMY DATA!');
  } catch (err) {
    console.error('Error seeding database:', err);
  } finally {
    await client.end();
  }
}

seedDatabase();
