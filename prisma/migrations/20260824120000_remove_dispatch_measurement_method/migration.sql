-- AlterTable: Drop vehicle_dispatch_measurement_method from vehicle_visit
ALTER TABLE "vehicle_visit" DROP COLUMN IF EXISTS "vehicle_dispatch_measurement_method";

-- AlterTable: Drop dispatch_measurement_method from visit_portion
ALTER TABLE "visit_portion" DROP COLUMN IF EXISTS "dispatch_measurement_method";

-- DropEnum: Drop MeasurementMethod enum
DROP TYPE IF EXISTS "MeasurementMethod";
