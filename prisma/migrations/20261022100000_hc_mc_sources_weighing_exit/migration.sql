-- HC/MC naming, independent milk sources, vehicle-level weighing/unload, exit outcomes.
-- NOT applied automatically. Run the demo reset script BEFORE deploying (old CONTRACTOR lab data is removed).

-- 1. Retire the ZMCC-side contractor arrival (merged into HC) and the ERP request flow.
ALTER TABLE "zmcc_lab_session" DROP COLUMN IF EXISTS "contractor_arrival_id";
DROP TABLE IF EXISTS "zmcc_contractor_arrival" CASCADE;
DROP TABLE IF EXISTS "erp_code_request" CASCADE;

-- 2. HC supplier no longer carries an ERP reference.
ALTER TABLE "zmcc_local_supplier" DROP CONSTRAINT IF EXISTS "zmcc_local_supplier_erp_mapping_status_check";
ALTER TABLE "zmcc_local_supplier" DROP COLUMN IF EXISTS "erp_reference";
ALTER TABLE "zmcc_local_supplier" DROP COLUMN IF EXISTS "erp_mapping_status";

-- 3. Shop no longer has a milk source.
ALTER TABLE "zmcc_shop" DROP COLUMN IF EXISTS "milk_source_id";

-- 4. Source on the tank receipt (chosen at unload for HC milk).
ALTER TABLE "zmcc_tank_receipt" ADD COLUMN IF NOT EXISTS "milk_source_id" BIGINT;
ALTER TABLE "zmcc_tank_receipt" ADD COLUMN IF NOT EXISTS "milk_source_code_snapshot" VARCHAR(50);
ALTER TABLE "zmcc_tank_receipt" ADD COLUMN IF NOT EXISTS "milk_source_name_snapshot" VARCHAR(150);
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_milk_source_id_fkey";
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_milk_source_id_fkey"
  FOREIGN KEY ("milk_source_id") REFERENCES "zmcc_milk_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_milk_source_id_idx" ON "zmcc_tank_receipt"("milk_source_id");

-- 5. Manual net entry fields on the portion.
ALTER TABLE "zmcc_lab_portion" ADD COLUMN IF NOT EXISTS "net_entry_mode" VARCHAR(10);
ALTER TABLE "zmcc_lab_portion" ADD COLUMN IF NOT EXISTS "net_entry_value" DECIMAL(12,3);
ALTER TABLE "zmcc_lab_portion" ADD COLUMN IF NOT EXISTS "net_entry_unit" "QuantityUnit";

-- 6. Unload and exit outcome on the lab session.
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "unloaded_at" TIMESTAMP(6);
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "unloaded_by_user_id" BIGINT;
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "exit_outcome" VARCHAR(30);
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "exit_reason_code" VARCHAR(40);
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "exit_remarks" TEXT;
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "close_requested_by_user_id" BIGINT;
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "close_requested_at" TIMESTAMP(6);
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "close_approved_by_user_id" BIGINT;
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "close_approved_at" TIMESTAMP(6);

-- 7. Global weighing policy (single row).
CREATE TABLE IF NOT EXISTS "zmcc_weighing_policy" (
  "id" BIGSERIAL PRIMARY KEY,
  "manual_entry_enabled" BOOLEAN NOT NULL DEFAULT false,
  "allowed_units" VARCHAR(10) NOT NULL DEFAULT 'BOTH',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" BIGINT,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "zmcc_weighing_policy" ("manual_entry_enabled", "allowed_units") SELECT false, 'BOTH' WHERE NOT EXISTS (SELECT 1 FROM "zmcc_weighing_policy");

-- 8. Value renames: LOCAL_SUPPLIER -> HC, MOT lab point -> MC, LOCAL_SUPPLIER lab point -> HC.
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT IF EXISTS "zmcc_lab_session_arrival_type_check";
UPDATE "zmcc_lab_session" SET "arrival_type" = 'HC' WHERE "arrival_type" = 'LOCAL_SUPPLIER';
UPDATE "zmcc_tank_receipt" SET "arrival_type" = 'HC' WHERE "arrival_type" = 'LOCAL_SUPPLIER';

ALTER TABLE "milk_test_policy_assignment" DROP CONSTRAINT IF EXISTS "chk_milk_test_policy_testing_point";

DELETE FROM "milk_test_policy_assignment" a USING "milk_test_policy_assignment" b
  WHERE a."testing_point" = 'ZMCC_LAB_MOT' AND b."testing_point" = 'ZMCC_LAB_MC' AND a."lab_test_id" = b."lab_test_id";
UPDATE "milk_test_policy_assignment" SET "testing_point" = 'ZMCC_LAB_MC' WHERE "testing_point" = 'ZMCC_LAB_MOT';
DELETE FROM "milk_test_policy_assignment" a USING "milk_test_policy_assignment" b
  WHERE a."testing_point" = 'ZMCC_LAB_LOCAL_SUPPLIER' AND b."testing_point" = 'ZMCC_LAB_HC' AND a."lab_test_id" = b."lab_test_id";
UPDATE "milk_test_policy_assignment" SET "testing_point" = 'ZMCC_LAB_HC' WHERE "testing_point" = 'ZMCC_LAB_LOCAL_SUPPLIER';
DELETE FROM "milk_test_policy_assignment" WHERE "testing_point" = 'ZMCC_LAB_CONTRACTOR';

DELETE FROM "test_point_policy" a USING "test_point_policy" b
  WHERE a."testing_point" = 'ZMCC_LAB_MOT' AND b."testing_point" = 'ZMCC_LAB_MC' AND a."lab_test_id" = b."lab_test_id" AND a."version" = b."version";
UPDATE "test_point_policy" SET "testing_point" = 'ZMCC_LAB_MC' WHERE "testing_point" = 'ZMCC_LAB_MOT';
DELETE FROM "test_point_policy" a USING "test_point_policy" b
  WHERE a."testing_point" = 'ZMCC_LAB_LOCAL_SUPPLIER' AND b."testing_point" = 'ZMCC_LAB_HC' AND a."lab_test_id" = b."lab_test_id" AND a."version" = b."version";
UPDATE "test_point_policy" SET "testing_point" = 'ZMCC_LAB_HC' WHERE "testing_point" = 'ZMCC_LAB_LOCAL_SUPPLIER';
DELETE FROM "test_point_policy" WHERE "testing_point" = 'ZMCC_LAB_CONTRACTOR';

UPDATE "lab_test_rule" SET "testing_point" = 'ZMCC_LAB_MC' WHERE "testing_point" = 'ZMCC_LAB_MOT';
UPDATE "lab_test_rule" SET "testing_point" = 'ZMCC_LAB_HC' WHERE "testing_point" = 'ZMCC_LAB_LOCAL_SUPPLIER';

ALTER TABLE "milk_test_policy_assignment" DROP CONSTRAINT IF EXISTS "chk_milk_test_policy_testing_point";
ALTER TABLE "milk_test_policy_assignment" ADD CONSTRAINT "chk_milk_test_policy_testing_point"
  CHECK (testing_point IN ('MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH', 'DISPATCH', 'PLANT_QA'));

-- Legacy CONTRACTOR rows (removed by the demo reset) are tolerated; new rows must be MOT, HC.
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT IF EXISTS "zmcc_lab_session_arrival_type_check";
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_arrival_type_check" CHECK ("arrival_type" IN ('MOT', 'HC', 'CONTRACTOR')) NOT VALID;
