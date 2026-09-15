-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS "zmcc_local_supplier_code_seq" START WITH 1 INCREMENT BY 1;

-- CreateTable
CREATE TABLE "zmcc_local_supplier" (
    "id" BIGSERIAL NOT NULL,
    "local_supplier_code" VARCHAR(50) NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(50),
    "cnic" VARCHAR(50),
    "erp_reference" VARCHAR(100),
    "erp_mapping_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" BIGINT NOT NULL,
    "updated_by_user_id" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "zmcc_local_supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zmcc_local_supplier_local_supplier_code_key" ON "zmcc_local_supplier"("local_supplier_code");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_zmcc_id_is_active_idx" ON "zmcc_local_supplier"("zmcc_id", "is_active");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_zmcc_id_name_idx" ON "zmcc_local_supplier"("zmcc_id", "name");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_zmcc_id_erp_mapping_status_idx" ON "zmcc_local_supplier"("zmcc_id", "erp_mapping_status");

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier" ADD CONSTRAINT "zmcc_local_supplier_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier" ADD CONSTRAINT "zmcc_local_supplier_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier" ADD CONSTRAINT "zmcc_local_supplier_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "zmcc_local_supplier_arrival" (
    "id" BIGSERIAL NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "local_supplier_id" BIGINT NOT NULL,
    "rmr_number" VARCHAR(100) NOT NULL,
    "vehicle_number" VARCHAR(50) NOT NULL,
    "arrival_timestamp" TIMESTAMP(6) NOT NULL,
    "arrival_date" DATE NOT NULL,
    "zmcc_token" VARCHAR(100) NOT NULL,
    "phe_latitude" DECIMAL(10,7),
    "phe_longitude" DECIMAL(10,7),
    "phe_gps_accuracy" DECIMAL(8,2),
    "client_event_id" VARCHAR(255) NOT NULL,
    "recorded_by_user_id" BIGINT NOT NULL,
    "submitted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correction_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "zmcc_local_supplier_arrival_pkey" PRIMARY KEY ("id")
);

-- CheckConstraint
ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_rmr_digits_check" CHECK ("rmr_number" ~ '^[0-9]+$');

-- CreateIndex
CREATE UNIQUE INDEX "zmcc_local_supplier_arrival_zmcc_token_key" ON "zmcc_local_supplier_arrival"("zmcc_token");

-- CreateIndex
CREATE UNIQUE INDEX "zmcc_local_supplier_arrival_client_event_id_key" ON "zmcc_local_supplier_arrival"("client_event_id");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_arrival_zmcc_id_idx" ON "zmcc_local_supplier_arrival"("zmcc_id");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_arrival_local_supplier_id_idx" ON "zmcc_local_supplier_arrival"("local_supplier_id");

-- CreateIndex
CREATE INDEX "zmcc_local_supplier_arrival_arrival_date_idx" ON "zmcc_local_supplier_arrival"("arrival_date");

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_local_supplier_id_fkey" FOREIGN KEY ("local_supplier_id") REFERENCES "zmcc_local_supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "zmcc_lab_session" ADD COLUMN "local_supplier_arrival_id" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "zmcc_lab_session_local_supplier_arrival_id_key" ON "zmcc_lab_session"("local_supplier_arrival_id");

-- AddForeignKey
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_local_supplier_arrival_id_fkey" FOREIGN KEY ("local_supplier_arrival_id") REFERENCES "zmcc_local_supplier_arrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- UpdateCheckConstraints: zmcc_lab_session
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT "zmcc_lab_session_arrival_check";
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_arrival_check" CHECK (
    ("mot_arrival_id" IS NOT NULL AND "contractor_arrival_id" IS NULL AND "local_supplier_arrival_id" IS NULL AND "arrival_type" = 'MOT') OR
    ("mot_arrival_id" IS NULL AND "contractor_arrival_id" IS NOT NULL AND "local_supplier_arrival_id" IS NULL AND "arrival_type" = 'CONTRACTOR') OR
    ("mot_arrival_id" IS NULL AND "contractor_arrival_id" IS NULL AND "local_supplier_arrival_id" IS NOT NULL AND "arrival_type" = 'LOCAL_SUPPLIER')
);

ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT "zmcc_lab_session_arrival_type_check";
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_arrival_type_check" CHECK ("arrival_type" IN ('MOT', 'CONTRACTOR', 'LOCAL_SUPPLIER'));

