-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "QuantityUnit" AS ENUM ('KG', 'LITER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MeasurementBasis" AS ENUM ('ESTIMATED', 'MEASURED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MeasurementMethod" AS ENUM ('MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable visit_portion
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "dispatch_quantity_value" DECIMAL(10,2);
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "dispatch_quantity_unit" "QuantityUnit";
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "dispatch_quantity_basis" "MeasurementBasis";
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "dispatch_measurement_method" "MeasurementMethod";

ALTER TABLE "visit_portion" DROP COLUMN IF EXISTS "declared_quantity_value";
ALTER TABLE "visit_portion" DROP COLUMN IF EXISTS "declared_quantity_unit";

-- AlterTable dispatch_info
ALTER TABLE "dispatch_info" ADD COLUMN IF NOT EXISTS "vehicle_quantity_value" DECIMAL(10,2);
ALTER TABLE "dispatch_info" ADD COLUMN IF NOT EXISTS "vehicle_quantity_unit" "QuantityUnit";
ALTER TABLE "dispatch_info" ADD COLUMN IF NOT EXISTS "vehicle_quantity_basis" "MeasurementBasis";
ALTER TABLE "dispatch_info" ADD COLUMN IF NOT EXISTS "vehicle_measurement_method" "MeasurementMethod";

