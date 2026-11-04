-- Bell clean-up for items raised before handled work cleared them automatically. Only read_at and one link change.

-- 1. Dispatch decisions that were already approved or returned no longer wait on anyone.
UPDATE "notification" n
SET "read_at" = CURRENT_TIMESTAMP
FROM "vehicle_visit" v
WHERE n."event_key" = 'DISPATCH_APPROVAL_PENDING'
  AND n."read_at" IS NULL
  AND n."source_id" ~ '^[0-9]+$'
  AND v."id" = n."source_id"::bigint
  AND v."approval_status" IN ('APPROVED', 'RETURNED');

-- 2. Transit loss alerts go to Zonal Managers, Super Admin and the MPD Head, none of whom use the QA Head page.
UPDATE "notification"
SET "deep_link" = '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=RECONCILIATION'
WHERE "event_key" = 'HIGH_TRANSIT_LOSS_ALERT'
  AND "deep_link" LIKE '/department/qa-head%';
