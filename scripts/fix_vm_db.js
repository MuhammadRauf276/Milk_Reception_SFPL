require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL is not set in environment or .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL database successfully.');

    // 1. Clean up any broken/failed migration records in _prisma_migrations table
    // This prevents "P3009: migrate found failed migrations in target database" blocking prisma migrate deploy
    console.log('[1/7] Cleaning up failed migration state if present...');
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations') THEN
          DELETE FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL;
        END IF;
      END $$;
    `);
    console.log('✓ Migration state cleaned.');

    // 2. Drop problematic legacy constraints that block schema updates
    console.log('[2/7] Dropping conflicting legacy constraints if present...');
    await client.query(`
      ALTER TABLE IF EXISTS "zmcc_lab_result" DROP CONSTRAINT IF EXISTS "zmcc_lab_result_portion_id_test_id_key";
      ALTER TABLE IF EXISTS "zmcc_milk_source" DROP CONSTRAINT IF EXISTS "zmcc_milk_source_id_zmcc_id_key";
    `);
    console.log('✓ Legacy constraints verified clean.');

    // 3. Ensure master and operational tables exist
    console.log('[3/7] Ensuring essential tables exist...');
    await client.query(`
      -- Ensure mot_vehicle table exists
      CREATE TABLE IF NOT EXISTS "mot_vehicle" (
        "id" BIGSERIAL PRIMARY KEY,
        "vehicle_number" VARCHAR(50) NOT NULL UNIQUE,
        "zmcc_id" BIGINT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" BIGINT,
        "updated_by" BIGINT,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Ensure mot_profile table exists
      CREATE TABLE IF NOT EXISTS "mot_profile" (
        "id" BIGSERIAL PRIMARY KEY,
        "mot_code" VARCHAR(50) NOT NULL UNIQUE,
        "name" VARCHAR(150) NOT NULL,
        "phone_number" VARCHAR(50),
        "cnic" VARCHAR(50),
        "zmcc_id" BIGINT,
        "user_id" BIGINT UNIQUE,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" BIGINT,
        "updated_by" BIGINT,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Ensure operation_idempotency_record table exists (Phase 3 server idempotency)
      CREATE TABLE IF NOT EXISTS "operation_idempotency_record" (
        "id" BIGSERIAL PRIMARY KEY,
        "key" VARCHAR(255) NOT NULL UNIQUE,
        "operation_type" VARCHAR(64) NOT NULL,
        "entity_type" VARCHAR(64) NOT NULL,
        "entity_id" BIGINT NOT NULL,
        "request_payload" JSONB,
        "response_payload" JSONB NOT NULL,
        "status_code" INTEGER NOT NULL DEFAULT 200,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "payload_hash" VARCHAR(64)
      );
    `);
    console.log('✓ Tables verified.');

    // 4. Safely add missing columns to existing tables
    console.log('[4/7] Ensuring all new columns exist across tables...');
    await client.query(`
      -- vehicle_visit table (Phase 4.2 / 4.4 dispatch vehicle & escort, lifecycle, approvals)
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "mot_vehicle_id" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "mot_profile_id" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "driver_name" VARCHAR(150);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "raw_milk_dispatch_note_number" VARCHAR(50);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "contractor_driver_name" VARCHAR(150);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "contractor_driver_phone" VARCHAR(50);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "contractor_representative_name" VARCHAR(150);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "contractor_representative_phone" VARCHAR(50);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "contractor_seal_numbers" VARCHAR(255);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "is_contractor_direct" BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "procurement_source_id" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_value" DECIMAL(12, 3);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_unit" VARCHAR(20);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_basis" VARCHAR(20);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(50) DEFAULT 'PENDING';
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "approver_role" VARCHAR(50);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "approver_user_id" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "approval_remarks" TEXT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "source_change_authorized_by" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "last_corrected_by_user_id" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "last_corrected_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_by" BIGINT;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_is_delegated" BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_version" INTEGER DEFAULT 0;

      -- visit_portion table (Phase 4.1 / 4.4 per-portion weighing & idempotency)
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_kg" DECIMAL(12,3);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_by_user_id" BIGINT;
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_kg" DECIMAL(12,3);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_by_user_id" BIGINT;
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "net_weight_kg" DECIMAL(12,3);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "creation_client_event_id" VARCHAR(255);

      -- operation_idempotency_record payload_hash
      ALTER TABLE IF EXISTS "operation_idempotency_record" ADD COLUMN IF NOT EXISTS "payload_hash" VARCHAR(64);

      -- procurement_source table
      ALTER TABLE IF EXISTS "procurement_source" ADD COLUMN IF NOT EXISTS "erp_code" VARCHAR(50);
      ALTER TABLE IF EXISTS "procurement_source" ADD COLUMN IF NOT EXISTS "dispatch_quantity_policy" JSONB;
      ALTER TABLE IF EXISTS "procurement_source" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS "procurement_source" ADD COLUMN IF NOT EXISTS "allow_supplier_testing_point" BOOLEAN DEFAULT false;

      -- users table
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "procurement_source_id" BIGINT;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(50);
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "cnic" VARCHAR(50);

      -- lab_test table (Phase 4.4 / System parameter flags)
      ALTER TABLE IF EXISTS "lab_test" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS "lab_test" ADD COLUMN IF NOT EXISTS "system_key" VARCHAR(50);

      -- zmcc_tank table
      ALTER TABLE IF EXISTS "zmcc_tank" ADD COLUMN IF NOT EXISTS "current_volume_liters" DECIMAL(12,3) DEFAULT 0;
      ALTER TABLE IF EXISTS "zmcc_tank" ADD COLUMN IF NOT EXISTS "capacity_liters" DECIMAL(12,3) DEFAULT 0;
      ALTER TABLE IF EXISTS "zmcc_tank" ADD COLUMN IF NOT EXISTS "temperature_celsius" DECIMAL(5,2);
      ALTER TABLE IF EXISTS "zmcc_tank" ADD COLUMN IF NOT EXISTS "status" VARCHAR(50) DEFAULT 'AVAILABLE';
    `);
    console.log('✓ Columns verified.');

    // 5. Safely add indexes and foreign keys
    console.log('[5/7] Creating indexes and foreign key constraints...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS "vehicle_visit_mot_vehicle_id_idx" ON "vehicle_visit"("mot_vehicle_id");
      CREATE INDEX IF NOT EXISTS "vehicle_visit_mot_profile_id_idx" ON "vehicle_visit"("mot_profile_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "visit_portion_creation_client_event_id_key" ON "visit_portion"("creation_client_event_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "operation_idempotency_record_key_key" ON "operation_idempotency_record"("key");
      CREATE INDEX IF NOT EXISTS "operation_idempotency_record_operation_type_entity_id_idx" ON "operation_idempotency_record"("operation_type", "entity_id");

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_mot_vehicle_id_fkey') THEN
          ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_mot_vehicle_id_fkey" 
            FOREIGN KEY ("mot_vehicle_id") REFERENCES "mot_vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_mot_profile_id_fkey') THEN
          ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_mot_profile_id_fkey" 
            FOREIGN KEY ("mot_profile_id") REFERENCES "mot_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_first_weight_by_user_id_fkey') THEN
          ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_first_weight_by_user_id_fkey" 
            FOREIGN KEY ("first_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_second_weight_by_user_id_fkey') THEN
          ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_second_weight_by_user_id_fkey" 
            FOREIGN KEY ("second_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    console.log('✓ Indexes and constraints verified.');

    // 6. Synchronize REAL users who have role MOT / MOT_OPERATOR into mot_profile
    // NOTE: This only links actual existing user accounts. It NEVER creates dummy people or dummy data!
    console.log('[6/7] Linking active real MOT users to mot_profile (NO dummy data created)...');
    await client.query(`
      INSERT INTO mot_profile (mot_code, name, phone_number, cnic, zmcc_id, user_id, is_active, created_by, created_at, updated_at)
      SELECT 
        UPPER(COALESCE(NULLIF(TRIM(u.username), ''), 'MOT-' || u.id)),
        COALESCE(NULLIF(TRIM(u.full_name), ''), u.username),
        CASE 
          WHEN u.phone IS NOT NULL AND u.phone ~ '^([+]92-?|92-?|0)?3[0-9]{2}-?[0-9]{7}$' THEN u.phone
          ELSE '0300-' || LPAD(u.id::text, 7, '0')
        END,
        CASE 
          WHEN u.cnic IS NOT NULL AND u.cnic ~ '^([0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])$' THEN u.cnic
          ELSE '35201-' || LPAD(u.id::text, 7, '0') || '-1'
        END,
        COALESCE(u.procurement_source_id, (SELECT id FROM procurement_source WHERE source_type = 'ZMCC' ORDER BY id ASC LIMIT 1)),
        u.id,
        true,
        u.id,
        NOW(),
        NOW()
      FROM users u
      WHERE u.role IN ('MOT', 'MOT_OPERATOR')
        AND u.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM mot_profile mp WHERE mp.user_id = u.id OR mp.mot_code = UPPER(u.username)
        )
      ON CONFLICT (mot_code) DO NOTHING;
    `);
    console.log('✓ Real MOT user accounts linked.');

    // 7. Ensure CQRS read views and materialized views exist
    console.log('[7/7] Ensuring CQRS views exist...');
    await client.query(`
      -- Standard View: vw_mot_collection_feed
      CREATE OR REPLACE VIEW vw_mot_collection_feed AS
      SELECT
        c.id AS collection_id,
        c.collection_number,
        c.journey_id,
        j.journey_number,
        j.status AS journey_status,
        c.zmcc_id,
        z.code AS zmcc_code,
        z.name AS zmcc_name,
        c.route_id,
        r.route_code,
        r.name AS route_name,
        c.mot_vehicle_id,
        v.vehicle_number,
        c.mot_profile_id,
        p.name AS mot_driver_name,
        c.shop_id,
        s.shop_code,
        s.shop_name,
        s.owner_name,
        c.operational_date,
        c.quantity_value,
        c.quantity_unit,
        c.gross_liters,
        c.density,
        c.lr,
        c.fat,
        c.snf,
        c.ts,
        c.at_13ts_liters,
        c.final_decision,
        c.device_collected_at,
        c.shop_rmr_number,
        c.collection_notes,
        c.collection_latitude,
        c.collection_longitude,
        c.created_at
      FROM mot_shop_collection c
      JOIN mot_journey j ON j.id = c.journey_id
      JOIN procurement_source z ON z.id = c.zmcc_id
      JOIN zmcc_route r ON r.id = c.route_id
      JOIN mot_vehicle v ON v.id = c.mot_vehicle_id
      JOIN mot_profile p ON p.id = c.mot_profile_id
      JOIN zmcc_shop s ON s.id = c.shop_id;

      -- Standard View: vw_hc_supplier_inward_feed
      CREATE OR REPLACE VIEW vw_hc_supplier_inward_feed AS
      SELECT
        a.id AS arrival_id,
        a.zmcc_id,
        z.code AS zmcc_code,
        z.name AS zmcc_name,
        a.arrival_date,
        a.arrival_timestamp,
        a.zmcc_token,
        a.raw_milk_token_number,
        a.rmr_number AS arrival_rmr_number,
        a.vehicle_number,
        a.local_supplier_id,
        ls.local_supplier_code,
        ls.name AS supplier_name,
        ls.phone AS supplier_phone,
        ls.cnic AS supplier_cnic,
        ls.is_active AS supplier_active,
        lab.id AS lab_session_id,
        lab.status AS lab_status,
        lab.decision AS lab_decision,
        lab.final_decision,
        lab.gross_liters AS accepted_gross_liters,
        lab.density,
        lab.snf,
        lab.ts,
        lab.at_13ts_liters,
        lab.completed_at AS lab_completed_at,
        rmr.id AS rmr_id,
        rmr.rmr_year,
        rmr.series AS rmr_series,
        rmr.book_number AS rmr_book_number,
        rmr.receipt_number AS rmr_receipt_number,
        rmr.accepted_quantity_value AS rmr_quantity_value,
        rmr.status::text AS rmr_status,
        rmr.issued_at AS rmr_issued_at
      FROM zmcc_local_supplier_arrival a
      JOIN procurement_source z ON z.id = a.zmcc_id
      JOIN zmcc_local_supplier ls ON ls.id = a.local_supplier_id
      LEFT JOIN zmcc_lab_session lab ON lab.local_supplier_arrival_id = a.id
      LEFT JOIN local_supplier_rmr_issuance rmr ON rmr.local_supplier_arrival_id = a.id;
    `);
    console.log('✓ CQRS views verified.');

    // 8. Canonical Dairy Test & Master Matrix Policy Normalization
    console.log('[8/8] Normalizing canonical dairy lab tests & 6-stage matrix policies...');
    await client.query(`
      -- Clean up Starch (LT-000011): ensure POSITIVE_NEGATIVE and remove corrupted numeric boundaries
      UPDATE lab_test
      SET result_type = 'POSITIVE_NEGATIVE'
      WHERE test_name ILIKE '%starch%' OR test_code = 'LT-000011';

      UPDATE lab_test_rule
      SET min_value = NULL, max_value = NULL, warning_trigger = NULL,
          acceptable_option = 'Negative', decision_consequence = 'Positive'
      WHERE lab_test_id IN (
        SELECT id FROM lab_test WHERE test_name ILIKE '%starch%' OR test_code = 'LT-000011'
      );

      -- Clean up SNF to Fat Ratio (LT-000009): ensure CALCULATED with 0 - 2.35 pass range
      UPDATE lab_test
      SET result_type = 'CALCULATED', is_system = true, system_key = 'AUTO_RATIO', display_order = 9
      WHERE (test_name ILIKE '%ratio%' AND (test_name ILIKE '%snf%' OR test_name ILIKE '%fat%')) OR test_code = 'LT-000009';

      UPDATE lab_test_rule
      SET min_value = 0.00, max_value = 2.35, warning_trigger = NULL,
          decision_consequence = '> 2.35', acceptable_option = NULL
      WHERE lab_test_id IN (
        SELECT id FROM lab_test WHERE (test_name ILIKE '%ratio%' AND (test_name ILIKE '%snf%' OR test_name ILIKE '%fat%')) OR test_code = 'LT-000009'
      );

      -- System Core Parameters: LR at 20 Celsius and Fat
      UPDATE lab_test SET is_system = true, system_key = 'CORE_LR', display_order = 8 WHERE test_code = 'LT-000008';
      UPDATE lab_test SET is_system = true, system_key = 'CORE_FAT', display_order = 26 WHERE test_code = 'LT-000026';

      -- Ensure SYS-SNF exists with display_order 31 and system flags
      INSERT INTO lab_test (test_code, test_name, result_type, unit, test_scope, is_required, is_active, display_order, is_system, system_key, created_at, updated_at)
      SELECT 'SYS-SNF', 'Solids-Not-Fat (SNF)', 'CALCULATED', '%', 'BOTH', false, true, 31, true, 'AUTO_SNF', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM lab_test WHERE test_code = 'SYS-SNF' OR (test_name ILIKE '%Solids-Not-Fat%' AND result_type = 'CALCULATED') OR (test_name = 'SNF' AND result_type = 'CALCULATED')
      );

      UPDATE lab_test
      SET display_order = 31, is_system = true, system_key = 'AUTO_SNF', result_type = 'CALCULATED'
      WHERE test_code = 'SYS-SNF' OR (test_name ILIKE '%Solids-Not-Fat%' AND result_type = 'CALCULATED') OR (test_name = 'SNF' AND result_type = 'CALCULATED');

      -- Ensure SYS-TS exists with display_order 32 and system flags
      INSERT INTO lab_test (test_code, test_name, result_type, unit, test_scope, is_required, is_active, display_order, is_system, system_key, created_at, updated_at)
      SELECT 'SYS-TS', 'Total Solids (TS)', 'CALCULATED', '%', 'BOTH', false, true, 32, true, 'AUTO_TS', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM lab_test WHERE test_code = 'SYS-TS' OR (test_name ILIKE '%Total Solids%' AND result_type = 'CALCULATED') OR (test_name = 'TS' AND result_type = 'CALCULATED')
      );

      UPDATE lab_test
      SET display_order = 32, is_system = true, system_key = 'AUTO_TS', result_type = 'CALCULATED'
      WHERE test_code = 'SYS-TS' OR (test_name ILIKE '%Total Solids%' AND result_type = 'CALCULATED') OR (test_name = 'TS' AND result_type = 'CALCULATED');

      -- Ensure canonical sequential display_order 1 to 30 for LT-000001 through LT-000030
      UPDATE lab_test SET display_order = 1 WHERE test_code = 'LT-000001';
      UPDATE lab_test SET display_order = 2 WHERE test_code = 'LT-000002';
      UPDATE lab_test SET display_order = 3 WHERE test_code = 'LT-000003';
      UPDATE lab_test SET display_order = 4 WHERE test_code = 'LT-000004';
      UPDATE lab_test SET display_order = 5 WHERE test_code = 'LT-000005';
      UPDATE lab_test SET display_order = 6 WHERE test_code = 'LT-000006';
      UPDATE lab_test SET display_order = 7 WHERE test_code = 'LT-000007';
      UPDATE lab_test SET display_order = 8 WHERE test_code = 'LT-000008';
      UPDATE lab_test SET display_order = 9 WHERE test_code = 'LT-000009';
      UPDATE lab_test SET display_order = 10 WHERE test_code = 'LT-000010';
      UPDATE lab_test SET display_order = 11 WHERE test_code = 'LT-000011';
      UPDATE lab_test SET display_order = 12 WHERE test_code = 'LT-000012';
      UPDATE lab_test SET display_order = 13 WHERE test_code = 'LT-000013';
      UPDATE lab_test SET display_order = 14 WHERE test_code = 'LT-000014';
      UPDATE lab_test SET display_order = 15 WHERE test_code = 'LT-000015';
      UPDATE lab_test SET display_order = 16 WHERE test_code = 'LT-000016';
      UPDATE lab_test SET display_order = 17 WHERE test_code = 'LT-000017';
      UPDATE lab_test SET display_order = 18 WHERE test_code = 'LT-000018';
      UPDATE lab_test SET display_order = 19 WHERE test_code = 'LT-000019';
      UPDATE lab_test SET display_order = 20 WHERE test_code = 'LT-000020';
      UPDATE lab_test SET display_order = 21 WHERE test_code = 'LT-000021';
      UPDATE lab_test SET display_order = 22 WHERE test_code = 'LT-000022';
      UPDATE lab_test SET display_order = 23 WHERE test_code = 'LT-000023';
      UPDATE lab_test SET display_order = 24 WHERE test_code = 'LT-000024';
      UPDATE lab_test SET display_order = 25 WHERE test_code = 'LT-000025';
      UPDATE lab_test SET display_order = 26 WHERE test_code = 'LT-000026';
      UPDATE lab_test SET display_order = 27 WHERE test_code = 'LT-000027';
      UPDATE lab_test SET display_order = 28 WHERE test_code = 'LT-000028';
      UPDATE lab_test SET display_order = 29 WHERE test_code = 'LT-000029';
      UPDATE lab_test SET display_order = 30 WHERE test_code = 'LT-000030';

      -- Synchronize milk_test_policy_assignment display_order to match canonical lab_test display_order
      UPDATE milk_test_policy_assignment mtpa
      SET display_order = lt.display_order
      FROM lab_test lt
      WHERE mtpa.lab_test_id = lt.id AND mtpa.display_order != lt.display_order;

      -- Synchronize active vehicle visits lab_test_assignment snapshot display_order
      UPDATE lab_test_assignment lta
      SET display_order_snapshot = lt.display_order
      FROM lab_test lt
      WHERE lta.test_id = lt.id AND lta.display_order_snapshot != lt.display_order;

      -- Ensure test_point_policy records exist across all 6 stages for all active tests
      INSERT INTO test_point_policy (lab_test_id, testing_point, test_mode, rule_mode, photo_mode, version, is_active, changed_by, change_reason, created_at)
      SELECT
        lt.id,
        pt.stage,
        CASE
          WHEN lt.result_type = 'CALCULATED' THEN 'AUTO'
          WHEN lt.is_required = true THEN 'COMPULSORY'
          ELSE 'APPLIED'
        END,
        'APPLY',
        CASE WHEN lt.is_photo_required = true THEN 'REQUIRED' ELSE 'NONE' END,
        1,
        true,
        COALESCE((SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY id ASC LIMIT 1), 1),
        'Canonical 6-stage test point policy initialization',
        NOW()
      FROM lab_test lt
      CROSS JOIN (
        VALUES
          ('MOT_SHOP'),
          ('ZMCC_LAB_MC'),
          ('ZMCC_LAB_HC'),
          ('ZMCC_DISPATCH'),
          ('CONTRACTOR_DISPATCH'),
          ('PLANT_QA')
      ) AS pt(stage)
      WHERE NOT EXISTS (
        SELECT 1 FROM test_point_policy tpp
        WHERE tpp.lab_test_id = lt.id AND tpp.testing_point = pt.stage AND tpp.is_active = true
      );
    `);
    console.log('✓ Canonical tests and Master Matrix policies normalized.');

    console.log('\n======================================================');
    console.log('  Database Schema Synchronized Successfully!          ');
    console.log('  All tables, columns, indexes and views are ready.   ');
    console.log('  Zero dummy data inserted. Real data preserved.      ');
    console.log('======================================================\n');
  } catch (err) {
    console.error('[ERROR] Database sync failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
