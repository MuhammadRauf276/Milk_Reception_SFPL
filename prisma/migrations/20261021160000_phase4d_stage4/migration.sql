-- Phase 4d Stage 4 (Plant Reception): per-portion weighing, seal verification, tanker wash check, MPD disposition remarks.
-- Additive, safe backfill, idempotent.

-- 1. GateLog: tanker wash check columns
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "tanker_washed" BOOLEAN;
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_checked_by" BIGINT;
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_checked_as_role" VARCHAR(64);
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_checked_is_delegated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_checked_at" TIMESTAMP(6);
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "washed_checked_by" BIGINT;
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "washed_checked_at" TIMESTAMP(6);
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "wash_remarks" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gate_log_washed_checked_by_fkey'
    ) THEN
        ALTER TABLE "gate_log" ADD CONSTRAINT "gate_log_washed_checked_by_fkey" FOREIGN KEY ("washed_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 2. VisitPortion: MPD disposition remarks
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "mpd_disposition_remarks" TEXT;
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "mpd_disposition_by" BIGINT;
ALTER TABLE "visit_portion" ADD COLUMN IF NOT EXISTS "mpd_disposition_at" TIMESTAMP(6);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_mpd_disposition_by_fkey'
    ) THEN
        ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_mpd_disposition_by_fkey" FOREIGN KEY ("mpd_disposition_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. PlantLabResult: photo_url and seal_verified
ALTER TABLE "plant_lab_result" ADD COLUMN IF NOT EXISTS "photo_url" TEXT;
ALTER TABLE "plant_lab_result" ADD COLUMN IF NOT EXISTS "seal_verified" BOOLEAN;

-- 4. Backfill portion_id for weight_ticket before applying per-portion unique
UPDATE "weight_ticket" wt
SET "portion_id" = (
  SELECT vp.id FROM "visit_portion" vp
  WHERE vp.visit_id = wt.visit_id
  ORDER BY vp.portion_number ASC
  LIMIT 1
)
WHERE wt.portion_id IS NULL;

-- Drop visit_id unique constraint on weight_ticket if present
ALTER TABLE "weight_ticket" DROP CONSTRAINT IF EXISTS "weight_ticket_visit_id_key";
DROP INDEX IF EXISTS "weight_ticket_visit_id_key";

-- Add unique constraint on portion_id for weight_ticket
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'weight_ticket_portion_id_key'
    ) THEN
        ALTER TABLE "weight_ticket" ADD CONSTRAINT "weight_ticket_portion_id_key" UNIQUE ("portion_id");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "weight_ticket_visit_id_idx" ON "weight_ticket"("visit_id");
CREATE INDEX IF NOT EXISTS "weight_ticket_portion_id_idx" ON "weight_ticket"("portion_id");

-- 5. Backfill portion_id for zmcc_tank_receipt before applying per-portion unique
-- Ensure every lab_session has at least portion 1
INSERT INTO "zmcc_lab_portion" ("lab_session_id", "portion_number", "status", "created_at", "updated_at")
SELECT zls.id, 1, 'ACCEPTED', NOW(), NOW()
FROM "zmcc_lab_session" zls
WHERE NOT EXISTS (
  SELECT 1 FROM "zmcc_lab_portion" zlp WHERE zlp.lab_session_id = zls.id
);

UPDATE "zmcc_tank_receipt" ztr
SET "portion_id" = (
  SELECT zlp.id FROM "zmcc_lab_portion" zlp
  WHERE zlp.lab_session_id = ztr.lab_session_id
  ORDER BY zlp.portion_number ASC
  LIMIT 1
)
WHERE ztr.portion_id IS NULL;

-- Drop lab_session_id unique constraint on zmcc_tank_receipt if present
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_lab_session_id_key";
DROP INDEX IF EXISTS "zmcc_tank_receipt_lab_session_id_key";

-- Add unique constraint on portion_id for zmcc_tank_receipt
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_tank_receipt_portion_id_key'
    ) THEN
        ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_portion_id_key" UNIQUE ("portion_id");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_lab_session_id_idx" ON "zmcc_tank_receipt"("lab_session_id");
CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_portion_id_idx" ON "zmcc_tank_receipt"("portion_id");

-- 6. Backfill portion_id for zmcc_lab_result before applying per-portion unique
UPDATE "zmcc_lab_result" zlr
SET "portion_id" = (
  SELECT zlp.id FROM "zmcc_lab_portion" zlp
  WHERE zlp.lab_session_id = zlr.session_id
  ORDER BY zlp.portion_number ASC
  LIMIT 1
)
WHERE zlr.portion_id IS NULL;

-- Drop session_id_test_id unique constraint on zmcc_lab_result if present
ALTER TABLE "zmcc_lab_result" DROP CONSTRAINT IF EXISTS "zmcc_lab_result_session_id_test_id_key";
DROP INDEX IF EXISTS "zmcc_lab_result_session_id_test_id_key";

-- Add unique constraint on (portion_id, test_id) for zmcc_lab_result
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_lab_result_portion_id_test_id_key'
    ) THEN
        ALTER TABLE "zmcc_lab_result" ADD CONSTRAINT "zmcc_lab_result_portion_id_test_id_key" UNIQUE ("portion_id", "test_id");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "zmcc_lab_result_portion_id_idx" ON "zmcc_lab_result"("portion_id");
