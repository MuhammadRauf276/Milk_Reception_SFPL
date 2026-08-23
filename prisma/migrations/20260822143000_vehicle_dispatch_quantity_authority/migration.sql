-- AlterTable: Add vehicle_dispatch_quantity_* to vehicle_visit
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_value" DECIMAL(10,2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_unit" "QuantityUnit";
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_basis" "MeasurementBasis";
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_measurement_method" "MeasurementMethod";

-- AlterTable: Drop vehicle quantity fields from dispatch_info (portion-scoped model)
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_value";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_unit";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_basis";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_measurement_method";