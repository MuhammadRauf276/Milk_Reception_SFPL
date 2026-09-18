-- Migration: 20260917130000_repair_zmcc_lab_correction_schema_drift
-- Purpose: Repair zmcc_lab_session schema drift across historical database states (State A, State B, State C).
-- Ensures canonical correction columns, check constraints, and foreign key exist.

DO $$
BEGIN
    -- 1. Handle columns: restricted_correction_count vs manager_correction_count
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'restricted_correction_count'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'manager_correction_count'
    ) THEN
        -- State B: rename restricted_correction_count to manager_correction_count
        ALTER TABLE "zmcc_lab_session" RENAME COLUMN "restricted_correction_count" TO "manager_correction_count";
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'restricted_correction_count'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'manager_correction_count'
    ) THEN
        -- Both exist: preserve highest trustworthy count <= 5, then drop obsolete restricted_correction_count
        UPDATE "zmcc_lab_session"
        SET "manager_correction_count" = LEAST(5, GREATEST("manager_correction_count", "restricted_correction_count"))
        WHERE "manager_correction_count" < "restricted_correction_count";

        ALTER TABLE "zmcc_lab_session" DROP COLUMN "restricted_correction_count";
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'manager_correction_count'
    ) THEN
        -- State A: add manager_correction_count
        ALTER TABLE "zmcc_lab_session" ADD COLUMN "manager_correction_count" INTEGER NOT NULL DEFAULT 0;
    END IF;

    -- Ensure manager_correction_count has NOT NULL and DEFAULT 0
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'manager_correction_count'
    ) THEN
        UPDATE "zmcc_lab_session" SET "manager_correction_count" = 0 WHERE "manager_correction_count" IS NULL;
        ALTER TABLE "zmcc_lab_session" ALTER COLUMN "manager_correction_count" SET DEFAULT 0;
        ALTER TABLE "zmcc_lab_session" ALTER COLUMN "manager_correction_count" SET NOT NULL;
    END IF;

    -- Ensure correction_count has NOT NULL and DEFAULT 0
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'correction_count'
    ) THEN
        UPDATE "zmcc_lab_session" SET "correction_count" = 0 WHERE "correction_count" IS NULL;
        ALTER TABLE "zmcc_lab_session" ALTER COLUMN "correction_count" SET DEFAULT 0;
        ALTER TABLE "zmcc_lab_session" ALTER COLUMN "correction_count" SET NOT NULL;
    END IF;

    -- Ensure correction_count >= manager_correction_count for any existing rows before adding check constraint
    UPDATE "zmcc_lab_session"
    SET "correction_count" = GREATEST("correction_count", "manager_correction_count")
    WHERE "correction_count" < "manager_correction_count";

    -- 2. Ensure last_corrected_by_user_id exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'last_corrected_by_user_id'
    ) THEN
        ALTER TABLE "zmcc_lab_session" ADD COLUMN "last_corrected_by_user_id" BIGINT;
    END IF;

    -- 3. Ensure last_corrected_at exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'zmcc_lab_session' AND column_name = 'last_corrected_at'
    ) THEN
        ALTER TABLE "zmcc_lab_session" ADD COLUMN "last_corrected_at" TIMESTAMP(6);
    END IF;
END $$;

-- 4. Recreate canonical check constraints
-- Drop obsolete restricted constraint if present
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT IF EXISTS "zmcc_lab_session_restricted_correction_count_check";

-- Recreate canonical correction_count check constraint: correction_count >= 0
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT IF EXISTS "zmcc_lab_session_correction_count_check";
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_correction_count_check" 
CHECK ("correction_count" >= 0);

-- Recreate canonical manager_correction_count check constraint: 0 <= manager <= 5 AND manager <= correction_count
ALTER TABLE "zmcc_lab_session" DROP CONSTRAINT IF EXISTS "zmcc_lab_session_manager_correction_count_check";
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_manager_correction_count_check" 
CHECK (
  "manager_correction_count" >= 0
  AND "manager_correction_count" <= 5
  AND "manager_correction_count" <= "correction_count"
);

-- 5. Ensure foreign key constraint for last_corrected_by_user_id exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.zmcc_lab_session'::regclass
          AND conname = 'zmcc_lab_session_last_corrected_by_user_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_lab_session"
        ADD CONSTRAINT "zmcc_lab_session_last_corrected_by_user_id_fkey"
        FOREIGN KEY ("last_corrected_by_user_id")
        REFERENCES "users"("id")
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
    END IF;
END $$;
