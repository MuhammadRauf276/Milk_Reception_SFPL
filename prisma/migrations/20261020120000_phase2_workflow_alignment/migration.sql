-- Phase 2 workflow alignment (WORKFLOW_ALIGNMENT_PLAN.md §2-§18).
-- Additive and idempotent: every statement can be re-run safely; nothing is dropped, renamed or narrowed.
-- Constraint and FK names follow Prisma's default naming (<table>_<cols>_fkey / _idx / _key / _pkey).

-- =====================================================================
-- PART 1 - REPAIR: columns that exist in schema.prisma but were never in a migration
-- (added earlier with `prisma db push`). On databases that already have them these
-- statements are no-ops; on a fresh database they close the drift. None of these
-- columns has an FK or index declared in schema.prisma.
-- =====================================================================

-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN IF NOT EXISTS "is_photo_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lab_test_rule" ADD COLUMN IF NOT EXISTS "warning_offset" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "zmcc_route" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
ADD COLUMN IF NOT EXISTS "approved_by" BIGINT,
ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "zmcc_area" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
ADD COLUMN IF NOT EXISTS "approved_by" BIGINT,
ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "zmcc_shop" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
ADD COLUMN IF NOT EXISTS "approved_by" BIGINT,
ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "geotag_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_FIRST_VISIT';

-- AlterTable
ALTER TABLE "milk_test_policy_assignment" ADD COLUMN IF NOT EXISTS "is_photo_required" BOOLEAN DEFAULT false;

-- =====================================================================
-- PART 2 - PHASE 2: new columns, tables, indexes and foreign keys
-- Order: columns on existing tables -> new tables -> indexes -> foreign keys
-- Role attribution pattern (plan §14): each actor gets <stem>_as_role VARCHAR(64) +
-- <stem>_is_delegated BOOLEAN; the primary actor of a new row uses performed_as_role + is_delegated.
-- =====================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_code" VARCHAR(30),
ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "performed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "device_id" BIGINT;

-- AlterTable
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "test_mode" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(30) NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "approval_request_remarks" TEXT,
ADD COLUMN IF NOT EXISTS "approval_requested_by" BIGINT,
ADD COLUMN IF NOT EXISTS "approval_requested_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approval_requested_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "approval_requested_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "approver_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approval_decided_by" BIGINT,
ADD COLUMN IF NOT EXISTS "approval_decided_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approval_decided_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "approval_decided_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "approval_decision_remarks" TEXT,
ADD COLUMN IF NOT EXISTS "rule_violation_summary" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "business_date_source" VARCHAR(30),
ADD COLUMN IF NOT EXISTS "business_date_set_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "seal_number" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "plant_seal_number_entered" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "seal_match" BOOLEAN,
ADD COLUMN IF NOT EXISTS "seal_checked_by" BIGINT,
ADD COLUMN IF NOT EXISTS "seal_checked_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "seal_checked_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "seal_checked_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "exception_reasons" JSONB,
ADD COLUMN IF NOT EXISTS "plant_decided_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "plant_decided_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "manager_reviewed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "manager_reviewed_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "dispatch_info" ADD COLUMN IF NOT EXISTS "recorded_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "entry_guard_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "entry_guard_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "exit_guard_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "exit_guard_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "tanker_washed" BOOLEAN,
ADD COLUMN IF NOT EXISTS "wash_checked_by" BIGINT,
ADD COLUMN IF NOT EXISTS "wash_checked_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "wash_checked_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "wash_checked_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "wash_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "wash_remarks" TEXT;

-- AlterTable
ALTER TABLE "weight_ticket" ADD COLUMN IF NOT EXISTS "portion_id" BIGINT,
ADD COLUMN IF NOT EXISTS "gross_recorded_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "gross_recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "tare_recorded_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "tare_recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "unloading_log" ADD COLUMN IF NOT EXISTS "started_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "started_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "completed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "completed_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_route" ADD COLUMN IF NOT EXISTS "approved_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approved_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "created_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "created_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_area" ADD COLUMN IF NOT EXISTS "approved_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approved_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "created_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "created_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_shop" ADD COLUMN IF NOT EXISTS "approved_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approved_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "created_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "created_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "geofence_radius_m" INTEGER,
ADD COLUMN IF NOT EXISTS "location_verified_by" BIGINT,
ADD COLUMN IF NOT EXISTS "location_verified_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "location_verified_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "location_verified_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "area_received_net_kg" DECIMAL(12,3),
ADD COLUMN IF NOT EXISTS "area_received_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_received_at_13ts_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_mot_declared_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_mot_declared_at_13ts_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_loss_gain_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_loss_gain_at_13ts_liters" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "area_loss_gain_pct" DECIMAL(7,4),
ADD COLUMN IF NOT EXISTS "area_computed_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "mot_journey_location" ADD COLUMN IF NOT EXISTS "speed_mps" DECIMAL(8,2),
ADD COLUMN IF NOT EXISTS "heading_deg" DECIMAL(6,2),
ADD COLUMN IF NOT EXISTS "battery_pct" INTEGER,
ADD COLUMN IF NOT EXISTS "is_mock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "was_offline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "provider" VARCHAR(20) NOT NULL DEFAULT 'WEB';

-- AlterTable
ALTER TABLE "mot_shop_collection" ADD COLUMN IF NOT EXISTS "system_outcome" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "person_decision" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "decision_remarks" TEXT,
ADD COLUMN IF NOT EXISTS "exception_reasons" JSONB,
ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" BIGINT,
ADD COLUMN IF NOT EXISTS "reviewed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "reviewed_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "review_remarks" TEXT,
ADD COLUMN IF NOT EXISTS "final_decision" VARCHAR(20) NOT NULL DEFAULT 'ACCEPTED',
ADD COLUMN IF NOT EXISTS "performed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN IF NOT EXISTS "recorded_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "exit_recorded_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "exit_recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_local_supplier" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "approved_by_user_id" BIGINT,
ADD COLUMN IF NOT EXISTS "approved_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "approved_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
ADD COLUMN IF NOT EXISTS "created_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "created_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "local_supplier_rmr_issuance" ADD COLUMN IF NOT EXISTS "issued_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "issued_is_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "zmcc_lab_session" ADD COLUMN IF NOT EXISTS "started_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "started_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "completed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "completed_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "final_decided_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "final_decided_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "manager_reviewed_as_role" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "manager_reviewed_is_delegated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "test_mode" VARCHAR(20) NOT NULL DEFAULT 'COMPOSITE',
ADD COLUMN IF NOT EXISTS "journey_closed_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "closed_reason" VARCHAR(50);

-- AlterTable
ALTER TABLE "zmcc_lab_result" ADD COLUMN IF NOT EXISTS "portion_id" BIGINT;

-- AlterTable
ALTER TABLE "mot_journey_summary" ADD COLUMN IF NOT EXISTS "rejected_shop_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "zmcc_tank_receipt" ADD COLUMN IF NOT EXISTS "portion_id" BIGINT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "device" (
    "id" BIGSERIAL NOT NULL,
    "device_uid" VARCHAR(64) NOT NULL,
    "sync_key_hash" VARCHAR(255) NOT NULL,
    "label" VARCHAR(150),
    "platform" VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    "assigned_user_id" BIGINT,
    "procurement_source_id" BIGINT,
    "is_shared_station" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "registered_by" BIGINT NOT NULL,
    "registered_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_by" BIGINT,
    "blocked_at" TIMESTAMP(6),
    "block_reason" TEXT,
    "last_seen_at" TIMESTAMP(6),
    "last_app_version" VARCHAR(30),
    "last_unsent_count" INTEGER NOT NULL DEFAULT 0,
    "last_oldest_unsent_at" TIMESTAMP(6),
    "last_free_storage_mb" INTEGER,
    "last_clock_drift_seconds" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "device_activity_event" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "performed_as_role" VARCHAR(64),
    "is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "event_type" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" BIGINT,
    "client_event_id" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "device_occurred_at" TIMESTAMP(6) NOT NULL,
    "server_received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_activity_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "station_pin" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "pin_hash" VARCHAR(255) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "station_pin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "config_change_log" (
    "id" BIGSERIAL NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "entity_key" VARCHAR(100) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by" BIGINT NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
    "approved_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(6),

    CONSTRAINT "config_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "test_point_policy" (
    "id" BIGSERIAL NOT NULL,
    "lab_test_id" BIGINT NOT NULL,
    "testing_point" VARCHAR(50) NOT NULL,
    "test_mode" VARCHAR(20) NOT NULL DEFAULT 'OPTIONAL',
    "rule_mode" VARCHAR(20) NOT NULL DEFAULT 'APPLY',
    "photo_mode" VARCHAR(20) NOT NULL DEFAULT 'NONE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "changed_by" BIGINT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_point_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "captured_photo" (
    "id" BIGSERIAL NOT NULL,
    "capture_id" VARCHAR(64) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "file_path" VARCHAR(512) NOT NULL,
    "mime" VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "testing_point" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "lab_test_id" BIGINT,
    "portion_number" INTEGER,
    "photo_kind" VARCHAR(30) NOT NULL DEFAULT 'TEST_RESULT',
    "captured_by" BIGINT NOT NULL,
    "performed_as_role" VARCHAR(64),
    "is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "device_id" BIGINT,
    "device_captured_at" TIMESTAMP(6) NOT NULL,
    "server_received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "gps_accuracy" DECIMAL(8,2),
    "was_offline" BOOLEAN NOT NULL DEFAULT false,
    "clock_drift_seconds" INTEGER,
    "policy_version" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captured_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "zmcc_lab_portion" (
    "id" BIGSERIAL NOT NULL,
    "lab_session_id" BIGINT NOT NULL,
    "portion_number" INTEGER NOT NULL,
    "client_uuid" VARCHAR(64),
    "status" VARCHAR(30) NOT NULL DEFAULT 'TESTING',
    "quantity_value" DECIMAL(12,2),
    "quantity_unit" "QuantityUnit",
    "density" DECIMAL(6,4),
    "gross_liters" DECIMAL(12,2),
    "lr" DECIMAL(6,2),
    "fat" DECIMAL(5,2),
    "snf" DECIMAL(6,2),
    "ts" DECIMAL(6,2),
    "at_13ts_liters" DECIMAL(12,2),
    "calculation_version" VARCHAR(20),
    "system_outcome" VARCHAR(20),
    "person_decision" VARCHAR(20),
    "decision_remarks" TEXT,
    "exception_reasons" JSONB,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
    "reviewed_by_user_id" BIGINT,
    "reviewed_as_role" VARCHAR(64),
    "reviewed_is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMP(6),
    "review_remarks" TEXT,
    "final_decision" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" BIGINT,
    "performed_as_role" VARCHAR(64),
    "is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "first_weight_kg" DECIMAL(12,3),
    "first_weight_at" TIMESTAMP(6),
    "first_weight_by_user_id" BIGINT,
    "first_weight_as_role" VARCHAR(64),
    "first_weight_is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "second_weight_kg" DECIMAL(12,3),
    "second_weight_at" TIMESTAMP(6),
    "second_weight_by_user_id" BIGINT,
    "second_weight_as_role" VARCHAR(64),
    "second_weight_is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "net_weight_kg" DECIMAL(12,3),
    "tank_id" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "zmcc_lab_portion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rejected_milk_disposition" (
    "id" BIGSERIAL NOT NULL,
    "stage" VARCHAR(20) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "remarks" TEXT NOT NULL,
    "decided_by_user_id" BIGINT NOT NULL,
    "decided_as_role" VARCHAR(64),
    "decided_is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_milk_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_visit_approval_status_approver_role_idx" ON "vehicle_visit"("approval_status", "approver_role");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visit_portion_visit_id_seal_number_key" ON "visit_portion"("visit_id", "seal_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visit_portion_seal_number_idx" ON "visit_portion"("seal_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "weight_ticket_portion_id_idx" ON "weight_ticket"("portion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_performed_as_role_created_at_idx" ON "audit_log"("performed_as_role", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_is_delegated_idx" ON "audit_log"("is_delegated");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "device_device_uid_key" ON "device"("device_uid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_status_idx" ON "device"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_assigned_user_id_idx" ON "device"("assigned_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_procurement_source_id_idx" ON "device"("procurement_source_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_last_seen_at_idx" ON "device"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "device_activity_event_device_id_client_event_id_key" ON "device_activity_event"("device_id", "client_event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_activity_event_device_id_device_occurred_at_idx" ON "device_activity_event"("device_id", "device_occurred_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_activity_event_entity_type_entity_id_idx" ON "device_activity_event"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_activity_event_event_type_server_received_at_idx" ON "device_activity_event"("event_type", "server_received_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "station_pin_user_id_device_id_key" ON "station_pin"("user_id", "device_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "station_pin_device_id_idx" ON "station_pin"("device_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "config_change_log_module_entity_key_created_at_idx" ON "config_change_log"("module", "entity_key", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "config_change_log_status_idx" ON "config_change_log"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mot_shop_collection_review_status_idx" ON "mot_shop_collection"("review_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mot_shop_collection_final_decision_idx" ON "mot_shop_collection"("final_decision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_local_supplier_zmcc_id_approval_status_idx" ON "zmcc_local_supplier"("zmcc_id", "approval_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_lab_result_portion_id_idx" ON "zmcc_lab_result"("portion_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "zmcc_lab_portion_client_uuid_key" ON "zmcc_lab_portion"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "zmcc_lab_portion_lab_session_id_portion_number_key" ON "zmcc_lab_portion"("lab_session_id", "portion_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_lab_portion_status_idx" ON "zmcc_lab_portion"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_lab_portion_review_status_idx" ON "zmcc_lab_portion"("review_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_lab_portion_tank_id_idx" ON "zmcc_lab_portion"("tank_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rejected_milk_disposition_entity_type_entity_id_key" ON "rejected_milk_disposition"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rejected_milk_disposition_stage_decided_at_idx" ON "rejected_milk_disposition"("stage", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "test_point_policy_lab_test_id_testing_point_version_key" ON "test_point_policy"("lab_test_id", "testing_point", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "test_point_policy_testing_point_is_active_effective_from_idx" ON "test_point_policy"("testing_point", "is_active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "captured_photo_capture_id_key" ON "captured_photo"("capture_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "captured_photo_sha256_idx" ON "captured_photo"("sha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "captured_photo_entity_type_entity_id_idx" ON "captured_photo"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "captured_photo_captured_by_created_at_idx" ON "captured_photo"("captured_by", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "captured_photo_device_id_idx" ON "captured_photo"("device_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_portion_id_idx" ON "zmcc_tank_receipt"("portion_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_approval_requested_by_fkey'
    ) THEN
        ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_approval_requested_by_fkey" FOREIGN KEY ("approval_requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_approval_decided_by_fkey'
    ) THEN
        ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_approval_decided_by_fkey" FOREIGN KEY ("approval_decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_seal_checked_by_fkey'
    ) THEN
        ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_seal_checked_by_fkey" FOREIGN KEY ("seal_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'weight_ticket_portion_id_fkey'
    ) THEN
        ALTER TABLE "weight_ticket" ADD CONSTRAINT "weight_ticket_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "visit_portion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gate_log_wash_checked_by_fkey'
    ) THEN
        ALTER TABLE "gate_log" ADD CONSTRAINT "gate_log_wash_checked_by_fkey" FOREIGN KEY ("wash_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_device_id_fkey'
    ) THEN
        ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_assigned_user_id_fkey'
    ) THEN
        ALTER TABLE "device" ADD CONSTRAINT "device_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_procurement_source_id_fkey'
    ) THEN
        ALTER TABLE "device" ADD CONSTRAINT "device_procurement_source_id_fkey" FOREIGN KEY ("procurement_source_id") REFERENCES "procurement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_registered_by_fkey'
    ) THEN
        ALTER TABLE "device" ADD CONSTRAINT "device_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_blocked_by_fkey'
    ) THEN
        ALTER TABLE "device" ADD CONSTRAINT "device_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_activity_event_device_id_fkey'
    ) THEN
        ALTER TABLE "device_activity_event" ADD CONSTRAINT "device_activity_event_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_activity_event_user_id_fkey'
    ) THEN
        ALTER TABLE "device_activity_event" ADD CONSTRAINT "device_activity_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'station_pin_user_id_fkey'
    ) THEN
        ALTER TABLE "station_pin" ADD CONSTRAINT "station_pin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'station_pin_device_id_fkey'
    ) THEN
        ALTER TABLE "station_pin" ADD CONSTRAINT "station_pin_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'config_change_log_changed_by_fkey'
    ) THEN
        ALTER TABLE "config_change_log" ADD CONSTRAINT "config_change_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'config_change_log_approved_by_fkey'
    ) THEN
        ALTER TABLE "config_change_log" ADD CONSTRAINT "config_change_log_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_shop_location_verified_by_fkey'
    ) THEN
        ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_location_verified_by_fkey" FOREIGN KEY ("location_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mot_shop_collection_reviewed_by_user_id_fkey'
    ) THEN
        ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_approved_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_local_supplier" ADD CONSTRAINT "zmcc_local_supplier_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_lab_session_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_lab_session_id_fkey" FOREIGN KEY ("lab_session_id") REFERENCES "zmcc_lab_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_tank_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "zmcc_tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_created_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_reviewed_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_first_weight_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_first_weight_by_user_id_fkey" FOREIGN KEY ("first_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_portion_second_weight_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_portion" ADD CONSTRAINT "zmcc_lab_portion_second_weight_by_user_id_fkey" FOREIGN KEY ("second_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_result_portion_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_result" ADD CONSTRAINT "zmcc_lab_result_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "zmcc_lab_portion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_tank_receipt_portion_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_portion_id_fkey" FOREIGN KEY ("portion_id") REFERENCES "zmcc_lab_portion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rejected_milk_disposition_decided_by_user_id_fkey'
    ) THEN
        ALTER TABLE "rejected_milk_disposition" ADD CONSTRAINT "rejected_milk_disposition_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'test_point_policy_lab_test_id_fkey'
    ) THEN
        ALTER TABLE "test_point_policy" ADD CONSTRAINT "test_point_policy_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'test_point_policy_changed_by_fkey'
    ) THEN
        ALTER TABLE "test_point_policy" ADD CONSTRAINT "test_point_policy_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'captured_photo_lab_test_id_fkey'
    ) THEN
        ALTER TABLE "captured_photo" ADD CONSTRAINT "captured_photo_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_test"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'captured_photo_captured_by_fkey'
    ) THEN
        ALTER TABLE "captured_photo" ADD CONSTRAINT "captured_photo_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'captured_photo_device_id_fkey'
    ) THEN
        ALTER TABLE "captured_photo" ADD CONSTRAINT "captured_photo_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
