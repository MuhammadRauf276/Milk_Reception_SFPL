-- Opening the dispatch form used to create a new vehicle visit every time, so empty VV numbers piled up. The form now
-- reuses one. This closes the old empty ones from before today: never given a vehicle, nothing dispatched, no saved work
-- in the form. Nothing is deleted, and each one is written to the audit log.
CREATE TEMP TABLE "_empty_draft_visits" AS
SELECT v."id", v."visit_number"
FROM "vehicle_visit" v
WHERE v."current_status" = 'DRAFT_DISPATCH'
  AND v."vehicle_number" = 'DRAFT'
  AND v."vehicle_dispatch_gross_liters" IS NULL
  AND v."created_at" < ((now() AT TIME ZONE 'Asia/Karachi')::date::timestamp - interval '5 hours')
  AND NOT EXISTS (SELECT 1 FROM "form_draft" d WHERE d."scope_id" = v."id" AND d."form_type" ILIKE '%DISPATCH%');

INSERT INTO "audit_log" ("table_name", "record_id", "action", "old_values", "new_values")
SELECT 'vehicle_visit', e."id", 'CANCEL_EMPTY_DRAFT_VISIT',
       jsonb_build_object('current_status', 'DRAFT_DISPATCH', 'visit_number', e."visit_number"),
       jsonb_build_object('current_status', 'CANCELLED')
FROM "_empty_draft_visits" e;

UPDATE "vehicle_visit" v
SET "current_status" = 'CANCELLED'
FROM "_empty_draft_visits" e
WHERE v."id" = e."id";

DROP TABLE "_empty_draft_visits";
