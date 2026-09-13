-- CreateEnum: ZmccTankTransactionType
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ZmccTankTransactionType') THEN
    CREATE TYPE "ZmccTankTransactionType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');
  END IF;
END $$;

-- CreateTable: zmcc_tank
CREATE TABLE IF NOT EXISTS "zmcc_tank" (
  "id" BIGSERIAL PRIMARY KEY,
  "zmcc_id" BIGINT NOT NULL REFERENCES "procurement_source"("id") ON DELETE RESTRICT,
  "tank_code" VARCHAR(50) NOT NULL,
  "tank_name" VARCHAR(150) NOT NULL,
  "capacity_liters" DECIMAL(12, 2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_user_id" BIGINT REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zmcc_tank_zmcc_id_tank_code_key" UNIQUE ("zmcc_id", "tank_code"),
  CONSTRAINT "zmcc_tank_capacity_liters_check" CHECK ("capacity_liters" > 0)
);

CREATE INDEX IF NOT EXISTS "zmcc_tank_zmcc_id_is_active_idx" ON "zmcc_tank"("zmcc_id", "is_active");

-- CreateTable: zmcc_tank_receipt
CREATE TABLE IF NOT EXISTS "zmcc_tank_receipt" (
  "id" BIGSERIAL PRIMARY KEY,
  "lab_session_id" BIGINT NOT NULL UNIQUE REFERENCES "zmcc_lab_session"("id") ON DELETE RESTRICT,
  "zmcc_id" BIGINT NOT NULL REFERENCES "procurement_source"("id") ON DELETE RESTRICT,
  "tank_id" BIGINT NOT NULL REFERENCES "zmcc_tank"("id") ON DELETE RESTRICT,
  "arrival_type" VARCHAR(20) NOT NULL,
  "quantity_value" DECIMAL(12, 2) NOT NULL,
  "quantity_unit" "QuantityUnit" NOT NULL,
  "density" DECIMAL(6, 4) NOT NULL,
  "gross_liters" DECIMAL(12, 2) NOT NULL,
  "lr" DECIMAL(6, 2) NOT NULL,
  "fat" DECIMAL(5, 2) NOT NULL,
  "snf" DECIMAL(6, 2) NOT NULL,
  "ts" DECIMAL(6, 2) NOT NULL,
  "at_13ts_liters" DECIMAL(12, 2) NOT NULL,
  "calculation_version" VARCHAR(20) NOT NULL,
  "received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "correction_count" INTEGER NOT NULL DEFAULT 0,
  "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
  "last_corrected_by_user_id" BIGINT REFERENCES "users"("id") ON DELETE RESTRICT,
  "last_corrected_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zmcc_tank_receipt_gross_liters_check" CHECK ("gross_liters" > 0),
  CONSTRAINT "zmcc_tank_receipt_at_13ts_liters_check" CHECK ("at_13ts_liters" >= 0),
  CONSTRAINT "zmcc_tank_receipt_density_check" CHECK ("density" > 0),
  CONSTRAINT "zmcc_tank_receipt_quantity_value_check" CHECK ("quantity_value" > 0),
  CONSTRAINT "zmcc_tank_receipt_snf_check" CHECK ("snf" >= 0),
  CONSTRAINT "zmcc_tank_receipt_ts_check" CHECK ("ts" >= 0)
);

CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_zmcc_id_received_at_idx" ON "zmcc_tank_receipt"("zmcc_id", "received_at");
CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_tank_id_idx" ON "zmcc_tank_receipt"("tank_id");

-- CreateTable: zmcc_tank_inventory_transaction
CREATE TABLE IF NOT EXISTS "zmcc_tank_inventory_transaction" (
  "id" BIGSERIAL PRIMARY KEY,
  "tank_id" BIGINT NOT NULL REFERENCES "zmcc_tank"("id") ON DELETE RESTRICT,
  "zmcc_id" BIGINT NOT NULL REFERENCES "procurement_source"("id") ON DELETE RESTRICT,
  "transaction_type" "ZmccTankTransactionType" NOT NULL,
  "quantity_liters" DECIMAL(12, 2) NOT NULL,
  "tank_receipt_id" BIGINT REFERENCES "zmcc_tank_receipt"("id") ON DELETE RESTRICT,
  "dispatch_id" BIGINT,
  "reference_type" VARCHAR(50) NOT NULL,
  "reference_id" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(150) NOT NULL UNIQUE,
  "operational_timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "performed_by_user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "notes" VARCHAR(255),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zmcc_tank_inv_tx_quantity_liters_check" CHECK ("quantity_liters" > 0)
);

CREATE INDEX IF NOT EXISTS "zmcc_tank_inv_tx_tank_id_op_time_idx" ON "zmcc_tank_inventory_transaction"("tank_id", "operational_timestamp");
CREATE INDEX IF NOT EXISTS "zmcc_tank_inv_tx_zmcc_id_op_time_idx" ON "zmcc_tank_inventory_transaction"("zmcc_id", "operational_timestamp");
