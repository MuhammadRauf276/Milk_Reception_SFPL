-- Which units the Mobile Tester may enter milk in. Super Admin chooses; litres only until then.
ALTER TABLE "zmcc_weighing_policy" ADD COLUMN "mot_allowed_units" VARCHAR(10) NOT NULL DEFAULT 'LITER';

-- A rejected HC that Super Admin or Data Executive switched back on: only they can do that, and the switch never updated
-- the approval, so Master Data said Active while PHE and MDO could not choose it. Their later choice stands.
INSERT INTO "audit_log" ("table_name", "record_id", "action", "old_values", "new_values")
SELECT 'zmcc_local_supplier', s."id", 'REPAIR_HC_REACTIVATED_APPROVAL',
       jsonb_build_object('approval_status', s."approval_status", 'is_active', s."is_active"),
       jsonb_build_object('approval_status', 'ACTIVE', 'is_active', s."is_active")
FROM "zmcc_local_supplier" s
WHERE s."is_active" = true AND s."approval_status" = 'REJECTED';

UPDATE "zmcc_local_supplier"
SET "approval_status" = 'ACTIVE'
WHERE "is_active" = true AND "approval_status" = 'REJECTED';

-- A new HC waiting for approval was saved as active, so it looked usable. Waiting now reads as not active.
UPDATE "zmcc_local_supplier"
SET "is_active" = false
WHERE "approval_status" = 'PENDING_APPROVAL' AND "is_active" = true;
