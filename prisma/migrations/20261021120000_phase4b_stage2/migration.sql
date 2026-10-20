ALTER TABLE "zmcc_lab_portion" ADD COLUMN IF NOT EXISTS "decision_details" JSONB;
ALTER TABLE "zmcc_lab_portion" ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMP(6);
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN IF NOT EXISTS "recorded_as_role" VARCHAR(64);
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN IF NOT EXISTS "recorded_is_delegated" BOOLEAN NOT NULL DEFAULT false;
