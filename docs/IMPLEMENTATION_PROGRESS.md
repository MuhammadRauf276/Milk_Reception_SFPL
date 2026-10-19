# Implementation progress

## Phase 1 — done (20 Oct 2026), written to C:\MilkReceptionApp
- Logout never deletes unsent offline work; "Work not sent yet" dialog with Send now; Logout hidden for MOT/PHE/MDO/Zonal Lab Attendant. Journey cache always cleared on logout (no cross-user leak). Stuck items (CONFLICT/FAILED_FATAL) counted as "need help from the office".
- GPS: single watchPosition stream, real fix timestamp, accuracy ≤50 m / age ≤30 s / 25 m / 120 s filter (src/lib/gpsTracker.ts), fix-age badge, fallback positions labelled "Approximate".
- Security headers in next.config.js (CSP report-only, HSTS prod only); dev-login production guard (src/lib/startupGuards.ts).
- Role hierarchy module src/backend/core/roles (hierarchy.ts, labels.ts) + new MDO role with PHE-equivalent rights (routes stay pending approval), seed users mdo.hasilpur / mdo.jhang (password mdo123), new role labels.
- Tests: node --import tsx --test (55 passing). Typecheck 0 errors.

## Not done yet / follow-ups
- Run `npx prisma db seed` to create MDO users; test in browser.
- MotOperationsWorkspace.tsx & ZmccArrivalsWorkspace.tsx still call acquireRobustGps with old cache ages.
- PHE screens use a role bridge for MDO (remove in phase 4). Some texts still say "PHE".
- Dev-login guard is per-request (add instrumentation.ts boot check later).
- Field users have no logout until "Release phone" (Phase 3).
- Next: Phase 2 (schema migration).

## Phase 2 — schema done (20 Oct 2026), written to C:\MilkReceptionApp
- prisma/schema.prisma updated; new migration prisma/migrations/20261020120000_phase2_workflow_alignment (additive, idempotent).
- 8 new tables (device, device_activity_event, station_pin, config_change_log, test_point_policy, captured_photo, zmcc_lab_portion, rejected_milk_disposition), 129 new columns, 16 repaired columns (existed via db push but had no migration).
- Verified: schema validates; all 46 migrations apply on an in-memory Postgres; 64 models/1120 columns match; migration runs twice cleanly.
- Details: docs/PHASE2_SCHEMA_CHANGES.md
- Known old issue: migration 20261007180000 fails on a FRESH database (drops an index that is a constraint). Production unaffected; affects `migrate dev` shadow DB / new installs.
- USER MUST RUN on PC: `npx prisma migrate status` → `npx prisma migrate deploy` → `npx prisma generate` (then send me node_modules/.prisma/client for Phase 3 typing).
- Deferred to Phase 4: per-portion uniques on weight_ticket, zmcc_lab_result, zmcc_tank_receipt (need backfill).

## Phase 3 — in progress (20 Oct 2026)
- Migrations 20260923142000 + 20261007180000 marked applied (objects already existed); Phase 2 migration deployed. DB backup: C:\MilkReceptionBackups\milk_reception_db_before_phase2_20261020_004945.dump
- Baseline: typecheck 0, tests 55/55, lint 53 problems (51 errors, 2 warnings).
- Plan + shared interfaces + owner decisions: docs/PHASE3_BRIEF.md. Tasks T0..T11 (see brief).
- Done: T0 shared types in src/types (acting, sync, device, captured-photo, test-point-policy). Note: CanonicalRole lives in src/backend/core/types; schema comment for testing_point is stale (use ZMCC_LAB_MC/ZMCC_LAB_HC, map legacy codes in T3).
- Next: T1 (guards/acting context) + T2 (audit/device auth), then T3..T10 in parallel, then T11 station PIN.
