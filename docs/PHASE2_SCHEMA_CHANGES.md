# Phase 2 schema changes: workflow alignment

**Files**
- `prisma/schema.prisma`: CRLF line endings kept. Every touched or new model block has been run through the Prisma formatter. Untouched blocks are byte-identical to before.
- `prisma/migrations/20261020120000_phase2_workflow_alignment/migration.sql`: CRLF, additive and idempotent, with no transaction wrapper.

**Totals**
- **8** new tables.
- **129** new columns on **21** existing tables.
- **16** repaired columns.
- **33** foreign keys.
- **39** indexes: 10 unique and 29 plain.

All FK, index and unique names follow Prisma's default naming (`<table>_<cols>_fkey|_idx|_key`, `<table>_pkey`). Every name is 63 characters or fewer, so none are truncated.

## Role-attribution naming rule (plan §14)

This replaces the mixed names used in the three drafts.

| Situation | Columns |
|---|---|
| Primary actor of a *new* row (submitter or creator) | `performed_as_role VARCHAR(64)` + `is_delegated BOOLEAN NOT NULL DEFAULT false` |
| Any other actor column `<stem>_by[_user_id]` | `<stem>_as_role VARCHAR(64)` + `<stem>_is_delegated BOOLEAN NOT NULL DEFAULT false` |

Examples of the second pattern: `plant_decided_by` gives `plant_decided_as_role`/`plant_decided_is_delegated`, and `reviewed_by_user_id` gives `reviewed_as_role`/`reviewed_is_delegated`.

The real person always stays in the existing `*_by` column. There is no `self_approved` flag. Super Admin and Data Executive actions are written with `is_delegated=false`. Admin-only tables carry no `*_as_role` columns: `Device` registration and blocking, `TestPointPolicy` and `ConfigChangeLog` changes. Those actions are outside the delegation rules.

## Summary by model

| Model (table) | Added fields / new table | Purpose | Plan § |
|---|---|---|---|
| User (`users`) | `employee_code` (unique, nullable), `must_change_password`; 21 back-relations | Stamp ID on photos; first-login password change | 9.3, 17 |
| AuditLog (`audit_log`) | `actor_role`, `performed_as_role`, `is_delegated`, `device_id` → Device; idx (`performed_as_role`,`created_at`), idx (`is_delegated`) | Delegation attribution and device of each action | 2.2–2.4, 14, 16 |
| **Device** (`device`) *new* | uid, sync-key hash, platform, assigned user / source, shared-station flag, status, register/block info, heartbeat snapshot (`last_*`) | Registered-device control (Super Admin / Data Executive only) | 16–18 |
| **DeviceActivityEvent** (`device_activity_event`) *new* | append-only device diary, unique (`device_id`,`client_event_id`) | Offline sync and device diary | 16 |
| **StationPin** (`station_pin`) *new* | `pin_hash`, `failed_attempts`, `locked_until`; unique (user, device) | Shared station PC: name card + 4-digit PIN | 17 |
| **ConfigChangeLog** (`config_change_log`) *new* | module/key, old/new JSON, reason, status, approver | Configuration change history | 12 |
| **TestPointPolicy** (`test_point_policy`) *new* | `lab_test_id` × `testing_point`, `test_mode`, `rule_mode`, `photo_mode`, `version`, effective window | Versioned test×point policy matrix | 9.1 |
| **CapturedPhoto** (`captured_photo`) *new* | `capture_id` (unique), `sha256`, file info, polymorphic entity link, lab test, device/server time, GPS, drift, `policy_version`, role | Live-camera photos with stamp and hash | 9.3 |
| VehicleVisit (`vehicle_visit`) | `test_mode`; approval request (`approval_status`, remarks, requested by/as_role/is_delegated/at, `approver_role`, decided by/as_role/is_delegated/at, decision remarks, `rule_violation_summary`); `business_date_source`, `business_date_set_at`; idx (`approval_status`,`approver_role`) | Stage 3 dispatch mode and approval to dispatch; business-date provenance | 3 S3/S4, 8-2, 14 |
| VisitPortion (`visit_portion`) | `seal_number`, `plant_seal_number_entered`, `seal_match`, `seal_checked_by/as_role/is_delegated/at`, `exception_reasons` (JSONB), `plant_decided_as_role/is_delegated`, `manager_reviewed_as_role/is_delegated`; unique (`visit_id`,`seal_number`), idx (`seal_number`) | Seal at dispatch, seal check at plant, decision-rule extras (existing `plant_decision` / `system_quality_outcome` / `manager_review_*` reused) | 3 S3/S4, 14 |
| DispatchInfo (`dispatch_info`) | `recorded_as_role/is_delegated` | Role attribution | 14 |
| GateLog (`gate_log`) | `entry_guard_as_role/is_delegated`, `exit_guard_as_role/is_delegated`, `tanker_washed`, `wash_checked_by/as_role/is_delegated/at`, `wash_attempts`, `wash_remarks` | Tanker-wash check before plant exit | 3 S4, 14 |
| WeightTicket (`weight_ticket`) | `portion_id` → VisitPortion (nullable) + idx; `gross_recorded_as_role/is_delegated`, `tare_recorded_as_role/is_delegated` | Per-portion weighing (unique change deferred) | 3 S4, 14 |
| UnloadingLog (`unloading_log`) | `started_as_role/is_delegated`, `completed_as_role/is_delegated` | Role attribution | 14 |
| ZmccRoute / ZmccArea (`zmcc_route`, `zmcc_area`) | `approved_as_role/is_delegated`, `created_as_role/is_delegated` | Role attribution | 14 |
| ZmccShop (`zmcc_shop`) | same 4 role columns + `geofence_radius_m`, `location_verified_by/as_role/is_delegated/at` | Geofence; "verified" = existing `geotag_status='VERIFIED'` | 13.4, 14 |
| MotJourney (`mot_journey`) | 9 `area_*` loss/gain columns + `area_computed_at` | Area (MOT) loss/gain stored at journey close (accepted portions only) | 3 S2 |
| MotJourneyLocation (`mot_journey_location`) | `speed_mps`, `heading_deg`, `battery_pct`, `is_mock`, `was_offline`, `provider` | GPS quality | 13.4 |
| MotJourneySummary (`mot_journey_summary`) | `rejected_shop_count` | Summary counts accepted shops only | 3 S1 |
| MotShopCollection (`mot_shop_collection`) | decision rules: `system_outcome`, `person_decision`, `decision_remarks`, `exception_reasons` (JSONB), `review_status`, `reviewed_by_user_id/as_role/is_delegated/at`, `review_remarks`, `final_decision`, `performed_as_role`, `is_delegated`; idx `review_status`, idx `final_decision` | Stage 1 decision rule / exception path | 3 S1, 14 |
| ZmccMotArrival (`zmcc_mot_arrival`) | `recorded_as_role/is_delegated`, `exit_recorded_as_role/is_delegated` | Role attribution (gate-exit columns kept) | 14 |
| ZmccLocalSupplier (`zmcc_local_supplier`) | `approval_status` (default ACTIVE), `approved_by_user_id/as_role/is_delegated/at`, `rejection_reason`, `created_as_role/is_delegated`; idx (`zmcc_id`,`approval_status`) | New HC needs Zonal Manager approval | 3 S2 |
| LocalSupplierRmrIssuance | `issued_as_role/is_delegated` | Role attribution | 14 |
| ZmccLabSession (`zmcc_lab_session`) | `started_/completed_/final_decided_/manager_reviewed_` × `as_role/is_delegated`; `test_mode` (default COMPOSITE), `journey_closed_at`, `closed_reason` | Portion-wise testing at the session level | 3 S2, 14 |
| **ZmccLabPortion** (`zmcc_lab_portion`) *new* | portion no., `client_uuid`, status, quantity/quality, decision-rule set, creator role, first/second weight (MDO/PHE) with role, `net_weight_kg`, `tank_id`, `version`; unique (session, portion_number) | Per-portion ZMCC lab decision + weighing + tank | 3 S2, 14 |
| ZmccLabResult (`zmcc_lab_result`) | `portion_id` → ZmccLabPortion (Cascade) + idx | Results per portion | 3 S2 |
| ZmccTankReceipt (`zmcc_tank_receipt`) | `portion_id` → ZmccLabPortion (Restrict) + idx | Receipt per portion | 3 S2 |
| ZmccTank | back-relation `portions` | — | — |
| **RejectedMilkDisposition** (`rejected_milk_disposition`) *new* | `stage`, `entity_type`, `entity_id` (unique pair), `remarks`, `decided_by_user_id/as_role/is_delegated/at` | MPD Head remarks on rejected milk; one table for ZMCC **and** plant (replaces plan's `mpd_disposition_*` on VisitPortion) | 3 S2/S4 |
| LabTest, ProcurementSource | back-relations only | — | — |

## Documented value sets for VarChar status columns

| Column | Values |
|---|---|
| `vehicle_visit.approval_status` | `NONE` (default) · `PENDING` · `APPROVED` · `RETURNED` |
| `vehicle_visit.approver_role` | `ZMCC_MANAGER` · `CONTRACTOR_MANAGER` |
| `vehicle_visit.test_mode`, `zmcc_lab_session.test_mode` | `COMPOSITE` · `PORTION_WISE` (COMPOSITE = exactly one portion; enforced in API) |
| `vehicle_visit.current_status` (existing, new values) | + `PENDING_APPROVAL` · `RETURNED_FOR_REFILL` (excluded from plant queues like `DRAFT_DISPATCH`) |
| `vehicle_visit.business_date_source` | `FIRST_WEIGHT` · `LAST_QA_REJECTION` |
| `mot_journey_stop.status` (existing, new value) | `PENDING` · `VISITED` · `COMPLETED` · `SKIPPED` · **`REJECTED`** ("Shop not visited" is a UI label for `SKIPPED`) |
| `*.system_outcome` | `PASS` · `FAIL` |
| `*.person_decision` | `ACCEPT` · `REJECT` |
| `*.review_status` | `NONE` (default) · `PENDING` · `APPROVED` · `REJECTED` |
| `mot_shop_collection.final_decision` | `ACCEPTED` (default; keeps existing rows correct) · `REJECTED` · `PENDING` |
| `zmcc_lab_portion.final_decision` | `PENDING` (default) · `ACCEPTED` · `REJECTED` |
| `zmcc_lab_portion.status` | `TESTING` · `PENDING_REVIEW` · `ACCEPTED` · `REJECTED` · `WEIGHED` · `LOADED` |
| `zmcc_lab_session.closed_reason` | `ALL_PORTIONS_REJECTED` · `ALL_PORTIONS_WEIGHED` |
| `*.exception_reasons` (JSONB array) | `MISMATCH` · `PICTURE_MISSING` · `SEAL_MISMATCH` · `MISSING_FIELD` · `RULE_FAIL[:<TEST_CODE>]` |
| `zmcc_local_supplier.approval_status` | `PENDING_APPROVAL` · `ACTIVE` (default) · `REJECTED` |
| `mot_journey_location.provider` | `WEB` (default) · `NATIVE` |
| `device.platform` | `ANDROID_PWA` · `ANDROID_APP` · `WINDOWS_PWA` · `OTHER` (default) |
| `device.status` | `PENDING` · `ACTIVE` (default) · `BLOCKED` · `RELEASED` |
| `test_point_policy.testing_point`, `captured_photo.testing_point` | `MOT_SHOP` · `ZMCC_LAB_MOT` · `ZMCC_LAB_LOCAL_SUPPLIER` · `ZMCC_DISPATCH` · `CONTRACTOR_DISPATCH` · `PLANT_QA` (+ legacy `DISPATCH`, `ZMCC_LAB_CONTRACTOR`) |
| `test_point_policy.test_mode` / `rule_mode` / `photo_mode` | `COMPULSORY`·`OPTIONAL`·`OFF` / `APPLY`·`WARN` / `REQUIRED`·`OPTIONAL`·`NONE` |
| `captured_photo.photo_kind` | `TEST_RESULT` (default) · `LAB_REPORT` · `TANKER_WASH` · `OTHER` |
| `captured_photo.entity_type` | e.g. `MOT_SHOP_COLLECTION` · `ZMCC_LAB_PORTION` · `DISPATCH_PORTION` · `DISPATCH_PORTION_TEST` · `PLANT_PORTION_TEST` · `GATE_LOG` |
| `config_change_log.status` | `PENDING` · `APPLIED` (default) · `REJECTED` |
| `rejected_milk_disposition.stage` / `entity_type` | `ZMCC`·`PLANT` / `ZMCC_LAB_PORTION`·`ZMCC_LAB_SESSION`·`VISIT_PORTION` |

## Deferred constraint changes (later migration, after backfill)

These are not done now because they are breaking or need a backfill.
1. **WeightTicket per portion**: backfill `portion_id` from each visit's single accepted portion. Then drop `weight_ticket_visit_id_key`, add `@@unique([portion_id])`, keep `visit_id` as a plain index, and change `VehicleVisit.weight_ticket` to `WeightTicket[]`. This breaks `api/scale/*`.
2. **ZmccLabResult**: replace `@@unique([session_id, test_id])` with `@@unique([portion_id, test_id])` once every row has a portion. The backfill creates one portion per existing session.
3. **ZmccTankReceipt**: drop `lab_session_id @unique` and replace it with `@@unique([portion_id])`, after the same backfill. `ZmccLabSession.tank_receipt` then becomes one-to-many.

Other later items:
- `MotShopCollection` measurement columns are still NOT NULL, so a rejected shop must still submit values. `DROP NOT NULL` later if the product needs it.
- Gate-exit columns on ZMCC arrivals are left in place for now. They are removed in a later phase.

## PART 1: repair list (columns in schema.prisma that no migration created; added earlier via `db push`)

These are added with `ADD COLUMN IF NOT EXISTS`. They are no-ops on the live DB and close the gap on a fresh DB. The schema declares no FKs or indexes for them.

| Table | Column | Type |
|---|---|---|
| `lab_test` | `is_photo_required` | BOOLEAN NOT NULL DEFAULT false |
| `lab_test_rule` | `warning_offset` | DECIMAL(10,2) |
| `zmcc_route`, `zmcc_area`, `zmcc_shop` | `approval_status` | VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' |
|  | `rejection_reason` | TEXT |
|  | `approved_by` | BIGINT (no relation in schema) |
|  | `approved_at` | TIMESTAMP(6) |
| `zmcc_shop` | `geotag_status` | VARCHAR(50) NOT NULL DEFAULT 'PENDING_FIRST_VISIT' |
| `milk_test_policy_assignment` | `is_photo_required` | BOOLEAN DEFAULT false (nullable, as in schema) |

## Integration decisions (changes against the drafts)

- **VisitPortion overlap (A vs C).** One set is kept: `plant_decided_as_role/_is_delegated` and `manager_reviewed_as_role/_is_delegated`. A's `*_by_as_role` names were dropped, and C's `manager_review_is_delegated` was renamed to `manager_reviewed_is_delegated`.
- **MotShopCollection submitter (A vs B).** A's `submitted_by_as_role` was dropped. B's `performed_as_role` + `is_delegated` is kept because the submitter is the primary actor.
- **All of A's `*_by_as_role` columns renamed** to `<stem>_as_role` (for example `recorded_by_as_role` becomes `recorded_as_role`, and `issued_by_as_role` becomes `issued_as_role`). Each one gained a paired `<stem>_is_delegated`.
- **`_is_delegated` added for consistency** to every role column the drafts introduced without one: B's `reviewed_`, `approved_`, `created_`, `first_weight_`, `second_weight_` and `decided_`; C's `approval_requested_` and `wash_checked_`. `seal_checked_` and `location_verified_` gained both `_as_role` and `_is_delegated`. `is_delegated` was also added to DeviceActivityEvent and CapturedPhoto.
- **Role column width** is now VarChar(64) everywhere. B had used 50.
- **`exception_reasons`** is JSONB everywhere. B had a VarChar(255) comma list and C had JSONB. The three tables now share one format.
- **`ZmccLabPortion.tank_receipt_id` dropped.** It duplicated `ZmccTankReceipt.portion_id`, and B's draft had a relation without a back-relation. `ZmccTankReceipt.portion_id` is the single source of truth.
- **`ZmccLabPortion @@index([lab_session_id])` dropped.** The unique index on (`lab_session_id`, `portion_number`) already covers it.
- **WeightTicket↔VisitPortion relation** is now named (`"WeightTicketPortion"`). C's draft left it unnamed.
- **New tables' `updated_at`** has no DB default (`TIMESTAMP(6) NOT NULL`), which is what Prisma generates for `@updatedAt`. The drafts added `DEFAULT CURRENT_TIMESTAMP`, which would show up as drift.
- **`RejectedMilkDisposition`** is defined once (from B) and covers both ZMCC and plant. C's `mpd_disposition_*` columns are not added.

## Verification

- `node check-schema.mjs /home/claude/repo` printed **ALL CHECKS PASSED**: the schema validates, all 46 migrations apply, and 64 models / 1120 columns were compared. The baseline had 16 problems.
- **Idempotency:** a temp copy with the migration duplicated as `20261020120001_dup` still printed ALL CHECKS PASSED. The copy was then deleted.
- **Extra deep check.** This is a script written for this work. It compares column types (including length and precision) and defaults, plus FK/index/unique names, columns, uniqueness and ON DELETE/ON UPDATE actions, against Prisma's naming rules. **This migration introduces 0 new findings.** The 81 findings that remain all predate it: hand-named indexes and FKs in older migrations, `ON UPDATE NO ACTION` on tank/notification FKs, `DEFAULT CURRENT_TIMESTAMP` on older `updated_at` columns, and `lab_test_assignment.assigned_at` precision. Those need a separate cleanup migration, because fixing them would mean renaming or dropping.
- **Formatter:** every touched or new model block equals the output of `prisma-schema-wasm format`, called correctly as `format(JSON.stringify([[uri, text]]), params)`. The suggested `format(s, '{}')` call returns its input unchanged, so it cannot detect anything. It also prints "NOT formatted" for the original file, only because of CRLF. Untouched blocks keep their earlier, unformatted alignment, to avoid churn. Ignoring whitespace, the only line moves are `version` in MotJourney, MotShopCollection and ZmccTank: the formatter moved it from after `@@map` into the field list.
