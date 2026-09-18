-- Migration: 20260918120000_stage_6g_f_plant_final_dual_reconciliation
-- Stage 6G-F: Plant Final Dual Reconciliation + Quality Snapshot

-- 1. AlterTable: Add Plant Final Quality & Commercial Snapshot columns to silo_inventory_transaction
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_composite_lr" DECIMAL(6, 4);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_composite_fat" DECIMAL(6, 4);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_density" DECIMAL(6, 4);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_snf" DECIMAL(6, 4);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_ts" DECIMAL(6, 4);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_final_at_13ts_liters" DECIMAL(12, 2);
ALTER TABLE "silo_inventory_transaction" ADD COLUMN "plant_calculation_version" VARCHAR(20);

-- 2. CreateTable: plant_final_dual_reconciliation
CREATE TABLE "plant_final_dual_reconciliation" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "final_receipt_transaction_id" BIGINT NOT NULL,
    "sent_gross_liters" DECIMAL(12, 2),
    "received_gross_liters" DECIMAL(12, 2) NOT NULL,
    "gross_variance_liters" DECIMAL(12, 2),
    "gross_variance_percent" DECIMAL(8, 4),
    "sent_at_13ts_liters" DECIMAL(12, 2),
    "received_at_13ts_liters" DECIMAL(12, 2) NOT NULL,
    "at_13ts_variance_liters" DECIMAL(12, 2),
    "at_13ts_variance_percent" DECIMAL(8, 4),
    "reconciliation_calculation_version" VARCHAR(20),
    "reconciled_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "plant_final_dual_reconciliation_pkey" PRIMARY KEY ("id")
);

-- 3. Create Unique Indexes (Redundant non-unique indexes removed per Section 9)
CREATE UNIQUE INDEX "plant_final_dual_reconciliation_visit_id_key" ON "plant_final_dual_reconciliation"("visit_id");
CREATE UNIQUE INDEX "plant_final_dual_reconciliation_final_receipt_transaction_id_key" ON "plant_final_dual_reconciliation"("final_receipt_transaction_id");

-- 4. Add Foreign Key Constraints (fail-closed, deterministic)
ALTER TABLE "plant_final_dual_reconciliation"
    ADD CONSTRAINT "plant_final_dual_reconciliation_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plant_final_dual_reconciliation"
    ADD CONSTRAINT "plant_final_dual_reconciliation_final_receipt_transaction_id_fkey"
    FOREIGN KEY ("final_receipt_transaction_id") REFERENCES "silo_inventory_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
