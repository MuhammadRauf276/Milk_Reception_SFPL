-- Migration: 20260911200000_zmcc_lab_testing_decision
-- Stage 6F: ZMCC Lab Testing, Result Freezing, Acceptance & Rejection Decision

-- 1. Create Table: zmcc_lab_session
CREATE TABLE "zmcc_lab_session" (
    "id" BIGSERIAL NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "arrival_type" VARCHAR(20) NOT NULL,
    "mot_arrival_id" BIGINT,
    "contractor_arrival_id" BIGINT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
    "started_by_user_id" BIGINT NOT NULL,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by_user_id" BIGINT,
    "completed_at" TIMESTAMP(6),
    "decision" VARCHAR(50),
    "rejection_reason" TEXT,
    "remarks" TEXT,
    "completion_client_event_id" VARCHAR(255),
    "correction_count" INTEGER NOT NULL DEFAULT 0,
    "manager_correction_count" INTEGER NOT NULL DEFAULT 0,
    "last_corrected_by_user_id" BIGINT,
    "last_corrected_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_lab_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_lab_session_arrival_check" CHECK (
        ("mot_arrival_id" IS NOT NULL AND "contractor_arrival_id" IS NULL AND "arrival_type" = 'MOT') OR
        ("mot_arrival_id" IS NULL AND "contractor_arrival_id" IS NOT NULL AND "arrival_type" = 'CONTRACTOR')
    ),
    CONSTRAINT "zmcc_lab_session_arrival_type_check" CHECK ("arrival_type" IN ('MOT', 'CONTRACTOR')),
    CONSTRAINT "zmcc_lab_session_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT "zmcc_lab_session_decision_check" CHECK ("decision" IS NULL OR "decision" IN ('ACCEPTED', 'REJECTED')),
    CONSTRAINT "zmcc_lab_session_rejection_check" CHECK (
        ("decision" = 'REJECTED' AND "rejection_reason" IS NOT NULL AND LENGTH(TRIM("rejection_reason")) > 0) OR
        ("decision" IS DISTINCT FROM 'REJECTED')
    ),
    CONSTRAINT "zmcc_lab_session_correction_count_check" CHECK ("correction_count" >= 0),
    CONSTRAINT "zmcc_lab_session_manager_correction_count_check" CHECK (
        "manager_correction_count" >= 0 AND
        "manager_correction_count" <= 5 AND
        "manager_correction_count" <= "correction_count"
    )
);

-- Unique constraints & indexes for zmcc_lab_session
CREATE UNIQUE INDEX "zmcc_lab_session_mot_arrival_id_key" ON "zmcc_lab_session"("mot_arrival_id");
CREATE UNIQUE INDEX "zmcc_lab_session_contractor_arrival_id_key" ON "zmcc_lab_session"("contractor_arrival_id");
CREATE UNIQUE INDEX "zmcc_lab_session_completion_client_event_id_key" ON "zmcc_lab_session"("completion_client_event_id");
CREATE INDEX "zmcc_lab_session_zmcc_id_status_idx" ON "zmcc_lab_session"("zmcc_id", "status");
CREATE INDEX "zmcc_lab_session_status_created_at_idx" ON "zmcc_lab_session"("status", "created_at");

-- Foreign key constraints for zmcc_lab_session
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_mot_arrival_id_fkey" FOREIGN KEY ("mot_arrival_id") REFERENCES "zmcc_mot_arrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_contractor_arrival_id_fkey" FOREIGN KEY ("contractor_arrival_id") REFERENCES "zmcc_contractor_arrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_last_corrected_by_user_id_fkey" FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Create Table: zmcc_lab_result
CREATE TABLE "zmcc_lab_result" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "test_id" BIGINT NOT NULL,
    "test_code_snapshot" VARCHAR(50) NOT NULL,
    "test_name_snapshot" VARCHAR(150) NOT NULL,
    "result_type_snapshot" VARCHAR(20) NOT NULL,
    "unit_snapshot" VARCHAR(30),
    "is_required_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "display_order_snapshot" INTEGER NOT NULL DEFAULT 0,
    "result_options_snapshot" JSONB,
    "numeric_value" DECIMAL(10, 4),
    "text_value" VARCHAR(255),
    "evaluation_status" VARCHAR(50),
    "is_passed" BOOLEAN,
    "recorded_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_lab_result_pkey" PRIMARY KEY ("id")
);

-- Unique constraints & indexes for zmcc_lab_result
CREATE UNIQUE INDEX "zmcc_lab_result_session_id_test_id_key" ON "zmcc_lab_result"("session_id", "test_id");
CREATE INDEX "zmcc_lab_result_session_id_idx" ON "zmcc_lab_result"("session_id");

-- Foreign key constraints for zmcc_lab_result
ALTER TABLE "zmcc_lab_result" ADD CONSTRAINT "zmcc_lab_result_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "zmcc_lab_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_result" ADD CONSTRAINT "zmcc_lab_result_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
