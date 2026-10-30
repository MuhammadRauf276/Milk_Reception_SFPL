-- AlterTable: add portion weighing fields to visit_portion
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_kg" DECIMAL(12,3);
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_at" TIMESTAMP(6);
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_by_user_id" BIGINT;
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_kg" DECIMAL(12,3);
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_at" TIMESTAMP(6);
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_by_user_id" BIGINT;
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "net_weight_kg" DECIMAL(12,3);

-- Safely add foreign key constraints for visit_portion weigher users
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_first_weight_by_user_id_fkey') THEN
        ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_first_weight_by_user_id_fkey" FOREIGN KEY ("first_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_second_weight_by_user_id_fkey') THEN
        ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_second_weight_by_user_id_fkey" FOREIGN KEY ("second_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Cleanup legacy constraints if present
ALTER TABLE IF EXISTS "zmcc_lab_result" DROP CONSTRAINT IF EXISTS "zmcc_lab_result_portion_id_test_id_key";
ALTER TABLE IF EXISTS "zmcc_milk_source" DROP CONSTRAINT IF EXISTS "zmcc_milk_source_id_zmcc_id_key";
