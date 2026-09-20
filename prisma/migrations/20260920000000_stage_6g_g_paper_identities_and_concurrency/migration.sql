-- Stage 6G-G: Paper Identities Alignment, Per-ZMCC/Per-Source Uniqueness & Concurrency Safety

-- 1. Preflight Invariant Validations (Fail closed if conflicting records exist)
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    -- Check zmcc_mot_arrival duplicates per ZMCC
    SELECT COUNT(*) INTO dup_count FROM (
        SELECT "zmcc_id", "raw_milk_token_number"
        FROM "zmcc_mot_arrival"
        WHERE "raw_milk_token_number" IS NOT NULL
        GROUP BY "zmcc_id", "raw_milk_token_number"
        HAVING COUNT(*) > 1
    ) sub;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Preflight migration failure: duplicate raw_milk_token_number found in zmcc_mot_arrival for same ZMCC.';
    END IF;

    -- Check vehicle_visit dispatch note duplicates per procurement source
    SELECT COUNT(*) INTO dup_count FROM (
        SELECT "procurement_source_id", "raw_milk_dispatch_note_number"
        FROM "vehicle_visit"
        WHERE "raw_milk_dispatch_note_number" IS NOT NULL
        GROUP BY "procurement_source_id", "raw_milk_dispatch_note_number"
        HAVING COUNT(*) > 1
    ) sub;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Preflight migration failure: duplicate raw_milk_dispatch_note_number found in vehicle_visit for same procurement source.';
    END IF;
END $$;

-- 2. Alter zmcc_local_supplier_arrival: add raw_milk_token_number and make rmr_number nullable
ALTER TABLE "zmcc_local_supplier_arrival" 
ADD COLUMN IF NOT EXISTS "raw_milk_token_number" VARCHAR(100),
ALTER COLUMN "rmr_number" DROP NOT NULL;

-- 3. Indexes & Uniqueness Defenses
-- Index for raw_milk_token_number lookup on local supplier arrivals
CREATE INDEX IF NOT EXISTS "zmcc_local_supplier_arrival_raw_milk_token_number_idx" 
ON "zmcc_local_supplier_arrival"("raw_milk_token_number");

-- Composite partial unique index for ZMCC Local Supplier Arrivals (per ZMCC)
CREATE UNIQUE INDEX IF NOT EXISTS "zmcc_local_supplier_arrival_zmcc_id_raw_milk_token_number_key" 
ON "zmcc_local_supplier_arrival"("zmcc_id", "raw_milk_token_number") 
WHERE "raw_milk_token_number" IS NOT NULL;

-- Composite partial unique index for ZMCC MOT Arrivals (per ZMCC)
CREATE UNIQUE INDEX IF NOT EXISTS "zmcc_mot_arrival_zmcc_id_raw_milk_token_number_key" 
ON "zmcc_mot_arrival"("zmcc_id", "raw_milk_token_number") 
WHERE "raw_milk_token_number" IS NOT NULL;

-- Composite partial unique index for Vehicle Visit Dispatch Note (per Procurement Source)
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_visit_procurement_source_id_raw_milk_dispatch_note_number_key" 
ON "vehicle_visit"("procurement_source_id", "raw_milk_dispatch_note_number") 
WHERE "raw_milk_dispatch_note_number" IS NOT NULL;

-- 4. Update PaperReferencePolicy defaults to final business model:
-- SHOP_RMR: REQUIRED, allow_duplicates = true (historical reuse allowed, not a system unique identity)
-- RAW_MILK_TOKEN: REQUIRED, allow_duplicates = false, duplicate_scope = PER_SOURCE (per ZMCC)
-- RAW_MILK_DISPATCH_NOTE: REQUIRED, allow_duplicates = false, duplicate_scope = PER_SOURCE (per issuing source)
UPDATE "paper_reference_policy"
SET "policy_mode" = 'REQUIRED', "allow_duplicates" = true, "duplicate_scope" = 'GLOBAL', "updated_at" = NOW()
WHERE "reference_type" = 'SHOP_RMR';

UPDATE "paper_reference_policy"
SET "policy_mode" = 'REQUIRED', "allow_duplicates" = false, "duplicate_scope" = 'PER_SOURCE', "updated_at" = NOW()
WHERE "reference_type" = 'RAW_MILK_TOKEN';

UPDATE "paper_reference_policy"
SET "policy_mode" = 'REQUIRED', "allow_duplicates" = false, "duplicate_scope" = 'PER_SOURCE', "updated_at" = NOW()
WHERE "reference_type" = 'RAW_MILK_DISPATCH_NOTE';
