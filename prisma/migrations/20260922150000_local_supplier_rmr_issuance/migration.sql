-- Dedicated post-acceptance Local Supplier RMR issuance.
-- Legacy arrival rmr_number values remain unchanged for the P7-08 policy.

CREATE TYPE "LocalSupplierRmrStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "local_supplier_rmr_issuance" (
    "id" BIGSERIAL NOT NULL,
    "local_supplier_arrival_id" BIGINT NOT NULL,
    "final_lab_session_id" BIGINT NOT NULL,
    "tank_receipt_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "local_supplier_id" BIGINT NOT NULL,
    "rmr_year" INTEGER NOT NULL,
    "series" VARCHAR(30) NOT NULL,
    "book_number" VARCHAR(50) NOT NULL,
    "receipt_number" VARCHAR(50) NOT NULL,
    "accepted_quantity_value" DECIMAL(12,2) NOT NULL,
    "accepted_quantity_unit" "QuantityUnit" NOT NULL,
    "issued_by_user_id" BIGINT NOT NULL,
    "issued_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" "LocalSupplierRmrStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelled_by_user_id" BIGINT,
    "cancelled_at" TIMESTAMP(6),
    "cancellation_reason" TEXT,
    "reprint_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "local_supplier_rmr_issuance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "local_supplier_rmr_year_check" CHECK ("rmr_year" BETWEEN 2000 AND 9999),
    CONSTRAINT "local_supplier_rmr_quantity_check" CHECK ("accepted_quantity_value" > 0),
    CONSTRAINT "local_supplier_rmr_cancel_state_check" CHECK (
      ("status" = 'ACTIVE' AND "cancelled_by_user_id" IS NULL AND "cancelled_at" IS NULL AND "cancellation_reason" IS NULL)
      OR
      ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancelled_at" IS NOT NULL AND length(btrim("cancellation_reason")) > 0)
    )
);

CREATE UNIQUE INDEX "local_supplier_rmr_issuance_local_supplier_arrival_id_key" ON "local_supplier_rmr_issuance"("local_supplier_arrival_id");
CREATE UNIQUE INDEX "local_supplier_rmr_issuance_final_lab_session_id_key" ON "local_supplier_rmr_issuance"("final_lab_session_id");
CREATE UNIQUE INDEX "local_supplier_rmr_issuance_tank_receipt_id_key" ON "local_supplier_rmr_issuance"("tank_receipt_id");
CREATE UNIQUE INDEX "local_supplier_rmr_issuance_idempotency_key_key" ON "local_supplier_rmr_issuance"("idempotency_key");
CREATE UNIQUE INDEX "local_supplier_rmr_paper_identity_key" ON "local_supplier_rmr_issuance"("zmcc_id", "rmr_year", "series", "book_number", "receipt_number");
CREATE INDEX "local_supplier_rmr_issuance_zmcc_id_rmr_year_idx" ON "local_supplier_rmr_issuance"("zmcc_id", "rmr_year");
CREATE INDEX "local_supplier_rmr_issuance_local_supplier_id_issued_at_idx" ON "local_supplier_rmr_issuance"("local_supplier_id", "issued_at");
CREATE INDEX "local_supplier_rmr_issuance_status_issued_at_idx" ON "local_supplier_rmr_issuance"("status", "issued_at");

ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_local_supplier_arrival_id_fkey" FOREIGN KEY ("local_supplier_arrival_id") REFERENCES "zmcc_local_supplier_arrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_final_lab_session_id_fkey" FOREIGN KEY ("final_lab_session_id") REFERENCES "zmcc_lab_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_tank_receipt_id_fkey" FOREIGN KEY ("tank_receipt_id") REFERENCES "zmcc_tank_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_local_supplier_id_fkey" FOREIGN KEY ("local_supplier_id") REFERENCES "zmcc_local_supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_issuance" ADD CONSTRAINT "local_supplier_rmr_issuance_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
