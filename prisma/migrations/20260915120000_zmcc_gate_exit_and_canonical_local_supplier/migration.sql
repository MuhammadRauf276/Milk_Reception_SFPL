-- D.3 Correction: Named erp_mapping_status CHECK on zmcc_local_supplier
ALTER TABLE "zmcc_local_supplier" ADD CONSTRAINT "zmcc_local_supplier_erp_mapping_status_check" CHECK ("erp_mapping_status" IN ('PENDING', 'VERIFIED'));

-- Gate Exit Schema for zmcc_mot_arrival
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "gate_exit_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "exit_timestamp" TIMESTAMP(6);
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "exit_recorded_by_user_id" BIGINT;
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "exit_client_event_id" VARCHAR(255);
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "exit_submitted_at" TIMESTAMP(6);
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "exit_correction_count" INTEGER NOT NULL DEFAULT 0;

-- Historical cutover for zmcc_mot_arrival: pre-feature rows are NOT treated as currently inside
UPDATE "zmcc_mot_arrival" SET "gate_exit_required" = false;

-- Unique constraint on exit_client_event_id for zmcc_mot_arrival
CREATE UNIQUE INDEX "zmcc_mot_arrival_exit_client_event_id_key" ON "zmcc_mot_arrival"("exit_client_event_id");

-- Partial index for active inside vehicles on zmcc_mot_arrival
CREATE INDEX "zmcc_mot_arrival_inside_idx" ON "zmcc_mot_arrival"("zmcc_id") WHERE ("gate_exit_required" = true AND "exit_timestamp" IS NULL);

-- Index on zmcc_id and exit_timestamp for zmcc_mot_arrival
CREATE INDEX "zmcc_mot_arrival_zmcc_id_exit_timestamp_idx" ON "zmcc_mot_arrival"("zmcc_id", "exit_timestamp");

-- ForeignKey for exit_recorded_by_user_id on zmcc_mot_arrival
ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_exit_recorded_by_user_id_fkey" FOREIGN KEY ("exit_recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Gate Exit Schema for zmcc_local_supplier_arrival
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "gate_exit_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "exit_timestamp" TIMESTAMP(6);
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "exit_recorded_by_user_id" BIGINT;
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "exit_client_event_id" VARCHAR(255);
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "exit_submitted_at" TIMESTAMP(6);
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN "exit_correction_count" INTEGER NOT NULL DEFAULT 0;

-- Historical cutover for zmcc_local_supplier_arrival: pre-feature rows are NOT treated as currently inside
UPDATE "zmcc_local_supplier_arrival" SET "gate_exit_required" = false;

-- Unique constraint on exit_client_event_id for zmcc_local_supplier_arrival
CREATE UNIQUE INDEX "zmcc_local_supplier_arrival_exit_client_event_id_key" ON "zmcc_local_supplier_arrival"("exit_client_event_id");

-- Partial index for active inside vehicles on zmcc_local_supplier_arrival
CREATE INDEX "zmcc_local_supplier_arrival_inside_idx" ON "zmcc_local_supplier_arrival"("zmcc_id") WHERE ("gate_exit_required" = true AND "exit_timestamp" IS NULL);

-- Index on zmcc_id and exit_timestamp for zmcc_local_supplier_arrival
CREATE INDEX "zmcc_local_supplier_arrival_zmcc_id_exit_timestamp_idx" ON "zmcc_local_supplier_arrival"("zmcc_id", "exit_timestamp");

-- ForeignKey for exit_recorded_by_user_id on zmcc_local_supplier_arrival
ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_exit_recorded_by_user_id_fkey" FOREIGN KEY ("exit_recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
