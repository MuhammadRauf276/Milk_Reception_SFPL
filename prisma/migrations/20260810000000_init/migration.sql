-- CreateEnum
CREATE TYPE "SiloTransactionType" AS ENUM ('RECEIPT', 'ISSUE');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "full_name" VARCHAR(255),
    "username" VARCHAR(255) NOT NULL,
    "password_hash" TEXT,
    "role" VARCHAR(255) NOT NULL,
    "department" VARCHAR(150),
    "scope_type" VARCHAR(50) NOT NULL DEFAULT 'ALL',
    "procurement_source_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_visit" (
    "id" BIGSERIAL NOT NULL,
    "visit_number" VARCHAR(255) NOT NULL,
    "reception_number" VARCHAR(255),
    "vehicle_number" VARCHAR(255) NOT NULL,
    "token_number" VARCHAR(255),
    "operational_date" DATE,
    "current_status" VARCHAR(255) NOT NULL DEFAULT 'DISPATCHED',
    "created_by" BIGINT,
    "procurement_source_id" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "vehicle_visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_portion" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "portion_number" SMALLINT NOT NULL,
    "current_status" VARCHAR(255) NOT NULL DEFAULT 'DISPATCHED',
    "declared_quantity_kg" DECIMAL(10,2),
    "plant_decision" VARCHAR(255),
    "plant_rejection_reason" TEXT,
    "plant_decided_by" BIGINT,
    "plant_decided_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "visit_portion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_info" (
    "id" BIGSERIAL NOT NULL,
    "portion_id" BIGINT NOT NULL,
    "dispatch_number" VARCHAR(255),
    "dispatch_timestamp" TIMESTAMP(6),
    "recorded_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "dispatch_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_log" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "entry_timestamp" TIMESTAMP(6),
    "exit_timestamp" TIMESTAMP(6),
    "entry_guard_id" BIGINT,
    "entry_submitted_at" TIMESTAMP(6),
    "exit_guard_id" BIGINT,
    "exit_submitted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "gate_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test" (
    "id" BIGSERIAL NOT NULL,
    "test_code" VARCHAR(50) NOT NULL,
    "test_name" VARCHAR(150) NOT NULL,
    "result_type" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(30),
    "test_scope" VARCHAR(20) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_rule" (
    "id" BIGSERIAL NOT NULL,
    "lab_test_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rule_category" VARCHAR(50) NOT NULL DEFAULT 'RELEASE',
    "effective_from" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(6),
    "min_value" DECIMAL(10,2),
    "max_value" DECIMAL(10,2),
    "acceptable_option" VARCHAR(50),
    "warning_trigger" VARCHAR(50),
    "decision_consequence" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_test_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_source" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "procurement_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_lab_result" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "portion_id" BIGINT NOT NULL,
    "test_id" BIGINT NOT NULL,
    "sample_timestamp" TIMESTAMP(6),
    "result_timestamp" TIMESTAMP(6),
    "numeric_value" DECIMAL(10,2),
    "text_value" VARCHAR(255),
    "is_passed" BOOLEAN,
    "tested_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "dispatch_lab_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_lab_result" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "portion_id" BIGINT NOT NULL,
    "test_id" BIGINT NOT NULL,
    "sample_timestamp" TIMESTAMP(6),
    "result_timestamp" TIMESTAMP(6),
    "numeric_value" DECIMAL(10,2),
    "text_value" VARCHAR(255),
    "is_passed" BOOLEAN,
    "tested_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "plant_lab_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_ticket" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "ticket_number" VARCHAR(255) NOT NULL,
    "gross_weight_kg" DECIMAL(10,2),
    "gross_timestamp" TIMESTAMP(6),
    "gross_recorded_by" BIGINT,
    "gross_submitted_at" TIMESTAMP(6),
    "tare_weight_kg" DECIMAL(10,2),
    "tare_timestamp" TIMESTAMP(6),
    "tare_recorded_by" BIGINT,
    "tare_submitted_at" TIMESTAMP(6),
    "net_weight_kg" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "weight_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unloading_log" (
    "id" BIGSERIAL NOT NULL,
    "portion_id" BIGINT NOT NULL,
    "silo_number" VARCHAR(255),
    "silo_id" BIGINT,
    "pump_start_timestamp" TIMESTAMP(6),
    "start_submitted_at" TIMESTAMP(6),
    "pump_end_timestamp" TIMESTAMP(6),
    "complete_submitted_at" TIMESTAMP(6),
    "started_by" BIGINT,
    "completed_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "unloading_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "table_name" VARCHAR(255) NOT NULL,
    "record_id" BIGINT NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "user_id" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_testing_session" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "started_by" BIGINT NOT NULL,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" BIGINT,
    "completed_at" TIMESTAMP(6),
    "status" VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "qa_testing_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_testing_session_event" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" BIGINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_testing_session_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_reception_counter" (
    "year_month" VARCHAR(6) NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "monthly_reception_counter_pkey" PRIMARY KEY ("year_month")
);

-- CreateTable
CREATE TABLE "silo" (
    "id" BIGSERIAL NOT NULL,
    "silo_code" VARCHAR(50) NOT NULL,
    "silo_name" VARCHAR(150) NOT NULL,
    "capacity_liters" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "silo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silo_inventory_transaction" (
    "id" BIGSERIAL NOT NULL,
    "silo_id" BIGINT NOT NULL,
    "transaction_type" "SiloTransactionType" NOT NULL,
    "quantity_kg" DECIMAL(10,2),
    "quantity_liters" DECIMAL(10,2),
    "operational_timestamp" TIMESTAMP(6) NOT NULL,
    "visit_id" BIGINT,
    "portion_id" BIGINT,
    "reference_type" VARCHAR(50),
    "reference_id" VARCHAR(255),
    "idempotency_key" VARCHAR(255),
    "performed_by" BIGINT,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silo_inventory_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_warning" (
    "id" BIGSERIAL NOT NULL,
    "procurement_source_id" BIGINT NOT NULL,
    "visit_id" BIGINT,
    "portion_id" BIGINT,
    "lab_test_id" BIGINT,
    "lab_test_rule_id" BIGINT,
    "reason" TEXT NOT NULL,
    "operational_timestamp" TIMESTAMP(6),
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "created_by" BIGINT,
    "acknowledged_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(6),
    "resolution_notes" TEXT,

    CONSTRAINT "qa_warning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_visit_visit_number_key" ON "vehicle_visit"("visit_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_visit_reception_number_key" ON "vehicle_visit"("reception_number");

-- CreateIndex
CREATE INDEX "vehicle_visit_current_status_created_at_idx" ON "vehicle_visit"("current_status", "created_at");

-- CreateIndex
CREATE INDEX "vehicle_visit_created_at_idx" ON "vehicle_visit"("created_at");

-- CreateIndex
CREATE INDEX "visit_portion_plant_decision_idx" ON "visit_portion"("plant_decision");

-- CreateIndex
CREATE UNIQUE INDEX "visit_portion_visit_id_portion_number_key" ON "visit_portion"("visit_id", "portion_number");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_info_portion_id_key" ON "dispatch_info"("portion_id");

-- CreateIndex
CREATE UNIQUE INDEX "gate_log_visit_id_key" ON "gate_log"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_test_code_key" ON "lab_test"("test_code");

-- CreateIndex
CREATE INDEX "lab_test_test_scope_is_active_display_order_idx" ON "lab_test"("test_scope", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "lab_test_rule_lab_test_id_is_active_idx" ON "lab_test_rule"("lab_test_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_source_code_key" ON "procurement_source"("code");

-- CreateIndex
CREATE INDEX "dispatch_lab_result_portion_id_idx" ON "dispatch_lab_result"("portion_id");

-- CreateIndex
CREATE INDEX "dispatch_lab_result_visit_id_idx" ON "dispatch_lab_result"("visit_id");

-- CreateIndex
CREATE INDEX "plant_lab_result_portion_id_idx" ON "plant_lab_result"("portion_id");

-- CreateIndex
CREATE INDEX "plant_lab_result_visit_id_idx" ON "plant_lab_result"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "weight_ticket_visit_id_key" ON "weight_ticket"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "weight_ticket_ticket_number_key" ON "weight_ticket"("ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "unloading_log_portion_id_key" ON "unloading_log"("portion_id");

-- CreateIndex
CREATE INDEX "unloading_log_silo_id_idx" ON "unloading_log"("silo_id");

-- CreateIndex
CREATE INDEX "audit_log_table_name_record_id_idx" ON "audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "qa_testing_session_visit_id_key" ON "qa_testing_session"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "silo_silo_code_key" ON "silo"("silo_code");

-- CreateIndex
CREATE UNIQUE INDEX "silo_inventory_transaction_idempotency_key_key" ON "silo_inventory_transaction"("idempotency_key");

-- CreateIndex
CREATE INDEX "silo_inventory_transaction_silo_id_operational_timestamp_idx" ON "silo_inventory_transaction"("silo_id", "operational_timestamp");

-- CreateIndex
CREATE INDEX "silo_inventory_transaction_visit_id_idx" ON "silo_inventory_transaction"("visit_id");

-- CreateIndex
CREATE INDEX "silo_inventory_transaction_portion_id_idx" ON "silo_inventory_transaction"("portion_id");

-- CreateIndex
CREATE INDEX "silo_inventory_transaction_transaction_type_idx" ON "silo_inventory_transaction"("transaction_type");

-- CreateIndex
CREATE INDEX "qa_warning_procurement_source_id_created_at_idx" ON "qa_warning"("procurement_source_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_procurement_source_id_fkey" FOREIGN KEY ("procurement_source_id") REFERENCES "procurement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_procurement_source_id_fkey" FOREIGN KEY ("procurement_source_id") REFERENCES "procurement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_plant_decided_by_fkey" FOREIGN KEY ("plant_decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_info" ADD CONSTRAINT "dispatch_info_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_info" ADD CONSTRAINT "dispatch_info_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_log" ADD CONSTRAINT "gate_log_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_log" ADD CONSTRAINT "gate_log_entry_guard_id_fkey" FOREIGN KEY ("entry_guard_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_log" ADD CONSTRAINT "gate_log_exit_guard_id_fkey" FOREIGN KEY ("exit_guard_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_rule" ADD CONSTRAINT "lab_test_rule_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_lab_result" ADD CONSTRAINT "dispatch_lab_result_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_lab_result" ADD CONSTRAINT "dispatch_lab_result_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_lab_result" ADD CONSTRAINT "dispatch_lab_result_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_lab_result" ADD CONSTRAINT "dispatch_lab_result_tested_by_fkey" FOREIGN KEY ("tested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_lab_result" ADD CONSTRAINT "plant_lab_result_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_lab_result" ADD CONSTRAINT "plant_lab_result_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_lab_result" ADD CONSTRAINT "plant_lab_result_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_lab_result" ADD CONSTRAINT "plant_lab_result_tested_by_fkey" FOREIGN KEY ("tested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_ticket" ADD CONSTRAINT "weight_ticket_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_ticket" ADD CONSTRAINT "weight_ticket_gross_recorded_by_fkey" FOREIGN KEY ("gross_recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_ticket" ADD CONSTRAINT "weight_ticket_tare_recorded_by_fkey" FOREIGN KEY ("tare_recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unloading_log" ADD CONSTRAINT "unloading_log_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unloading_log" ADD CONSTRAINT "unloading_log_silo_id_fkey" FOREIGN KEY ("silo_id") REFERENCES "silo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unloading_log" ADD CONSTRAINT "unloading_log_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unloading_log" ADD CONSTRAINT "unloading_log_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_testing_session" ADD CONSTRAINT "qa_testing_session_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_testing_session" ADD CONSTRAINT "qa_testing_session_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_testing_session" ADD CONSTRAINT "qa_testing_session_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_testing_session_event" ADD CONSTRAINT "qa_testing_session_event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "qa_testing_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_testing_session_event" ADD CONSTRAINT "qa_testing_session_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo" ADD CONSTRAINT "silo_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo" ADD CONSTRAINT "silo_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo_inventory_transaction" ADD CONSTRAINT "silo_inventory_transaction_silo_id_fkey" FOREIGN KEY ("silo_id") REFERENCES "silo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo_inventory_transaction" ADD CONSTRAINT "silo_inventory_transaction_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo_inventory_transaction" ADD CONSTRAINT "silo_inventory_transaction_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silo_inventory_transaction" ADD CONSTRAINT "silo_inventory_transaction_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_procurement_source_id_fkey" FOREIGN KEY ("procurement_source_id") REFERENCES "procurement_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_lab_test_rule_id_fkey" FOREIGN KEY ("lab_test_rule_id") REFERENCES "lab_test_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_warning" ADD CONSTRAINT "qa_warning_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

