-- Phase 4c Stage 3 (ZMCC / Contractor dispatch): decision fields + optimistic version. Additive and idempotent.
-- Phase 2 already added test_mode, approval_* and visit_portion.seal_number (unique per visit).
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_person_decision" VARCHAR(10);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_decision_remarks" TEXT;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_system_outcome" VARCHAR(10);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_exception_reasons" JSONB;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_decision_details" JSONB;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_lab_report_capture_id" VARCHAR(64);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_policy_version" INTEGER;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_by" BIGINT;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_as_role" VARCHAR(64);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_is_delegated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_submitted_at" TIMESTAMP(6);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "dispatch_version" INTEGER NOT NULL DEFAULT 0;
