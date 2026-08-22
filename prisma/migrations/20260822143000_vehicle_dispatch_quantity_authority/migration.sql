-- AlterTable: Add vehicle_dispatch_quantity_* to vehicle_visit
ALTER TABLE "vehicle_visit" ADD COLUMN "vehicle_dispatch_quantity_value" DECIMAL(10,2);
ALTER TABLE "vehicle_visit" ADD COLUMN "vehicle_dispatch_quantity_unit" "QuantityUnit";
ALTER TABLE "vehicle_visit" ADD COLUMN "vehicle_dispatch_quantity_basis" "MeasurementBasis";
ALTER TABLE "vehicle_visit" ADD COLUMN "vehicle_dispatch_measurement_method" "MeasurementMethod";

-- Deterministically backfill existing development rows from lowest-numbered portion DispatchInfo
UPDATE "vehicle_visit" v
SET
  "vehicle_dispatch_quantity_value" = di."vehicle_quantity_value",
  "vehicle_dispatch_quantity_unit" = di."vehicle_quantity_unit",
  "vehicle_dispatch_quantity_basis" = di."vehicle_quantity_basis",
  "vehicle_dispatch_measurement_method" = di."vehicle_measurement_method"
FROM "visit_portion" vp
JOIN "dispatch_info" di ON di."portion_id" = vp."id"
WHERE vp."visit_id" = v."id"
  AND vp."portion_number" = (
    SELECT MIN(vp2."portion_number")
    FROM "visit_portion" vp2
    WHERE vp2."visit_id" = v."id"
  );

-- AlterTable: Drop vehicle quantity fields from dispatch_info
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_value";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_unit";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_quantity_basis";
ALTER TABLE "dispatch_info" DROP COLUMN IF EXISTS "vehicle_measurement_method";