-- Stored roles for the two calculated tests of the master catalog (SYS-SNF -> SNF, SYS-TS -> TOTAL_SOLIDS).
-- The earlier role backfill covered LR, FAT and SNF_FAT_RATIO only. Idempotent: a row is changed only while it has no
-- role and no other test already holds that role (unique index on system_role stays as is). Empty databases do nothing.
UPDATE "lab_test" SET "system_role" = 'SNF'
WHERE "test_code" = 'SYS-SNF' AND "system_role" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "lab_test" WHERE "system_role" = 'SNF');

UPDATE "lab_test" SET "system_role" = 'TOTAL_SOLIDS'
WHERE "test_code" = 'SYS-TS' AND "system_role" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "lab_test" WHERE "system_role" = 'TOTAL_SOLIDS');
