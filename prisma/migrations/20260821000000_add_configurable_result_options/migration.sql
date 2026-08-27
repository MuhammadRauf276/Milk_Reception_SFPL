-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN IF NOT EXISTS "result_options" JSONB;

-- AlterTable
ALTER TABLE "lab_test_assignment" ADD COLUMN IF NOT EXISTS "result_options_snapshot" JSONB;

-- Deterministic Backfill for OK_NOT_OK on lab_test
UPDATE "lab_test"
SET "result_options" = '[{"value":"OK","label":"OK","isPassing":true},{"value":"NOT_OK","label":"Not OK","isPassing":false}]'::jsonb
WHERE "result_type" = 'OK_NOT_OK' AND "result_options" IS NULL;

-- Deterministic Backfill for POSITIVE_NEGATIVE on lab_test
UPDATE "lab_test"
SET "result_options" = '[{"value":"NEGATIVE","label":"Negative","isPassing":true},{"value":"POSITIVE","label":"Positive","isPassing":false}]'::jsonb
WHERE "result_type" = 'POSITIVE_NEGATIVE' AND "result_options" IS NULL;

-- Deterministic Backfill for OK_NOT_OK on lab_test_assignment
UPDATE "lab_test_assignment"
SET "result_options_snapshot" = '[{"value":"OK","label":"OK","isPassing":true},{"value":"NOT_OK","label":"Not OK","isPassing":false}]'::jsonb
WHERE "result_type_snapshot" = 'OK_NOT_OK' AND "result_options_snapshot" IS NULL;

-- Deterministic Backfill for POSITIVE_NEGATIVE on lab_test_assignment
UPDATE "lab_test_assignment"
SET "result_options_snapshot" = '[{"value":"NEGATIVE","label":"Negative","isPassing":true},{"value":"POSITIVE","label":"Positive","isPassing":false}]'::jsonb
WHERE "result_type_snapshot" = 'POSITIVE_NEGATIVE' AND "result_options_snapshot" IS NULL;