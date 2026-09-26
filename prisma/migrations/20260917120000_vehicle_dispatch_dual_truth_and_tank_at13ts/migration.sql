-- AlterTable: Add commercial milk metrics to vehicle_visit
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_fat" DECIMAL(5, 2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_snf" DECIMAL(6, 2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_ts" DECIMAL(6, 2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_at_13ts_liters" DECIMAL(12, 2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_calculation_version" VARCHAR(20);

-- AlterTable: Add at_13ts_liters to zmcc_tank_inventory_transaction
ALTER TABLE "zmcc_tank_inventory_transaction" ADD COLUMN IF NOT EXISTS "at_13ts_liters" DECIMAL(12, 2);

-- Safe forward backfill: Populate at_13ts_liters on historical RECEIPT transactions from authoritative linked zmcc_tank_receipt
UPDATE zmcc_tank_inventory_transaction tx
SET at_13ts_liters = r.at_13ts_liters
FROM zmcc_tank_receipt r
WHERE tx.tank_receipt_id = r.id 
  AND tx.transaction_type = 'RECEIPT' 
  AND tx.at_13ts_liters IS NULL;
