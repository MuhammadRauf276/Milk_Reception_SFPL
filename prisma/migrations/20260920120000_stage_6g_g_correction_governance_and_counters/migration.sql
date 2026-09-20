-- Migration: 20260920120000_stage_6g_g_correction_governance_and_counters
-- Description: Adds canonical correction counters (correction_count, manager_correction_count, last_corrected_by, last_corrected_at)
-- and check constraints across ZmccMotArrival, ZmccLocalSupplierArrival, MotShopCollection, and VehicleVisit.

-- 1. zmcc_mot_arrival
ALTER TABLE "zmcc_mot_arrival"
  ADD COLUMN IF NOT EXISTS "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "last_corrected_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "exit_manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exit_last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "exit_last_corrected_at" TIMESTAMP(6);

-- Relax legacy <= 2 correction_count check on zmcc_mot_arrival to allow governance quota
ALTER TABLE "zmcc_mot_arrival" DROP CONSTRAINT IF EXISTS "zmcc_mot_arrival_correction_count_check";
ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_correction_count_check"
  CHECK ("correction_count" >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_mot_arrival_manager_correction_count_check'
  ) THEN
    ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_manager_correction_count_check"
      CHECK ("manager_correction_count" >= 0 AND "manager_correction_count" <= 5 AND "manager_correction_count" <= "correction_count");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_mot_arrival_exit_manager_correction_count_check'
  ) THEN
    ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_exit_manager_correction_count_check"
      CHECK ("exit_manager_correction_count" >= 0 AND "exit_manager_correction_count" <= 5 AND "exit_manager_correction_count" <= "exit_correction_count");
  END IF;
END $$;


-- 2. zmcc_local_supplier_arrival
ALTER TABLE "zmcc_local_supplier_arrival"
  ADD COLUMN IF NOT EXISTS "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "last_corrected_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "exit_manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exit_last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "exit_last_corrected_at" TIMESTAMP(6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_arrival_manager_correction_count_check'
  ) THEN
    ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_manager_correction_count_check"
      CHECK ("manager_correction_count" >= 0 AND "manager_correction_count" <= 5 AND "manager_correction_count" <= "correction_count");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_arrival_exit_manager_correction_count_check'
  ) THEN
    ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_exit_manager_correction_count_check"
      CHECK ("exit_manager_correction_count" >= 0 AND "exit_manager_correction_count" <= 5 AND "exit_manager_correction_count" <= "exit_correction_count");
  END IF;
END $$;

-- 3. mot_shop_collection
ALTER TABLE "mot_shop_collection"
  ADD COLUMN IF NOT EXISTS "correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "last_corrected_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mot_shop_collection_manager_correction_count_check'
  ) THEN
    ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_manager_correction_count_check"
      CHECK ("manager_correction_count" >= 0 AND "manager_correction_count" <= 5 AND "manager_correction_count" <= "correction_count");
  END IF;
END $$;

-- 4. vehicle_visit
ALTER TABLE "vehicle_visit"
  ADD COLUMN IF NOT EXISTS "correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_corrected_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "last_corrected_at" TIMESTAMP(6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_manager_correction_count_check'
  ) THEN
    ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_manager_correction_count_check"
      CHECK ("manager_correction_count" >= 0 AND "manager_correction_count" <= 5 AND "manager_correction_count" <= "correction_count");
  END IF;
END $$;

-- Foreign Keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_mot_arrival_last_corrected_by_fkey') THEN
    ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_last_corrected_by_fkey"
      FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_mot_arrival_exit_last_corrected_by_fkey') THEN
    ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_exit_last_corrected_by_fkey"
      FOREIGN KEY ("exit_last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_arrival_last_corrected_by_fkey') THEN
    ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_last_corrected_by_fkey"
      FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_arrival_exit_last_corrected_by_fkey') THEN
    ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_exit_last_corrected_by_fkey"
      FOREIGN KEY ("exit_last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mot_shop_collection_last_corrected_by_fkey') THEN
    ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_last_corrected_by_fkey"
      FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_last_corrected_by_fkey') THEN
    ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_last_corrected_by_fkey"
      FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
