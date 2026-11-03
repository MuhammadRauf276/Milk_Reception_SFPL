-- Permanent role label for the lab tests the milk formulas depend on (LR, FAT, SNF, TOTAL_SOLIDS, SNF_FAT_RATIO).
-- The app finds LR / Fat by this role, never by test code, name, order or id. One test per role.
ALTER TABLE "lab_test" ADD COLUMN IF NOT EXISTS "system_role" VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS "lab_test_system_role_key" ON "lab_test"("system_role");

-- Backfill existing databases. The original master test wins (LT-000008 for LR, LT-000026 for Fat); otherwise the
-- lowest-id test whose name matches. Nothing is overwritten when a role is already set.
UPDATE "lab_test" SET "system_role" = 'LR'
WHERE "id" = (
  SELECT "id" FROM "lab_test"
  WHERE "test_name" !~* '(ratio|snf|solids|sodium|clot)'
    AND ("test_code" IN ('LT-000008', 'LT-000027', 'LR') OR "test_name" ~* '(\mLR\M|lactometer)')
  ORDER BY ("test_code" = 'LT-000008') DESC, "id" ASC LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "lab_test" WHERE "system_role" = 'LR');

UPDATE "lab_test" SET "system_role" = 'FAT'
WHERE "id" = (
  SELECT "id" FROM "lab_test"
  WHERE "test_name" !~* '(ratio|snf|solids)'
    AND ("test_code" IN ('LT-000026', 'FAT') OR "test_name" ~* '(^fat\M|\mgerber)')
  ORDER BY ("test_code" = 'LT-000026') DESC, "id" ASC LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "lab_test" WHERE "system_role" = 'FAT');

UPDATE "lab_test" SET "system_role" = 'SNF_FAT_RATIO'
WHERE "id" = (
  SELECT "id" FROM "lab_test"
  WHERE "test_code" = 'LT-000009' OR "test_name" ~* 'snf to fat ratio'
  ORDER BY ("test_code" = 'LT-000009') DESC, "id" ASC LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "lab_test" WHERE "system_role" = 'SNF_FAT_RATIO');
