-- AlterTable: add final milk quantity and metric columns to zmcc_lab_session
ALTER TABLE "zmcc_lab_session"
  ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "quantity_unit" "QuantityUnit",
  ADD COLUMN IF NOT EXISTS "density" DECIMAL(6, 4),
  ADD COLUMN IF NOT EXISTS "gross_liters" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "snf" DECIMAL(6, 2),
  ADD COLUMN IF NOT EXISTS "ts" DECIMAL(6, 2),
  ADD COLUMN IF NOT EXISTS "at_13ts_liters" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "calculation_version" VARCHAR(20);

-- Constraints: Ensure valid positive values when present (safe for historical NULL rows)
ALTER TABLE "zmcc_lab_session"
  ADD CONSTRAINT "zmcc_lab_session_quantity_value_check"
    CHECK ("quantity_value" IS NULL OR "quantity_value" > 0),
  ADD CONSTRAINT "zmcc_lab_session_density_check"
    CHECK ("density" IS NULL OR "density" > 0),
  ADD CONSTRAINT "zmcc_lab_session_gross_liters_check"
    CHECK ("gross_liters" IS NULL OR "gross_liters" > 0),
  ADD CONSTRAINT "zmcc_lab_session_snf_check"
    CHECK ("snf" IS NULL OR "snf" >= 0),
  ADD CONSTRAINT "zmcc_lab_session_ts_check"
    CHECK ("ts" IS NULL OR "ts" >= 0),
  ADD CONSTRAINT "zmcc_lab_session_at_13ts_liters_check"
    CHECK ("at_13ts_liters" IS NULL OR "at_13ts_liters" >= 0);
