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

## Phase 3 — done (20 Oct 2026), branch feature/phase-3
- Guards: requireRoles expands to ancestors with acting context (SYSTEM / SOURCE / DEPARTMENT scope). x-acting-as validated server-side. CORRECT + ADMINISTER only Super Admin + Data Executive (rolePolicies, correction routes, arrival/lab/MOT corrections, corrections desk). SMS cron keeps exact roles.
- writeAuditLog helper (src/backend/core/audit.ts) replaces all direct auditLog.create (only the helper writes now). Stores real user, actor_role, performed_as_role, is_delegated, device_id.
- Dispatch trap fixed: dispatch source checked by acting scope for every role incl. Super Admin (src/backend/services/dispatchScope.ts). Dispatch GET and operational read models fail closed for unknown roles.
- Devices: /super-admin/devices "Phones" (register, give to user [rotates key], release, block, rotate key with QR, diary). Device key = sha256 stored. Login with deviceUid gives field users a 30-day session on their own phone. /device-setup screen on the phone (scan QR or type key).
- Station PCs: /station-login name cards + 4-digit PIN (set by SA/DE on the Phones screen; 5 wrong tries lock; not allowed for SA/DE accounts).
- Sync: POST /api/sync/batch (idempotent by client UUID, per-item SAVED/DUPLICATE/REJECTED/RETRY; owner must be the assigned user or the signed-in user). Client engine src/frontend/modules/pwa (IndexedDB milk_sync, backoff to 15 min, never deletes before ACK, photos after record ACK). MOT queues drain into it only when the phone has a device key; otherwise the old path is unchanged. Status sign: All sent / N waiting / N need help / Phone blocked.
- Photos: LiveCamera (camera only, stamp band below the photo); LiveCameraCapture is a wrapper (file input removed). POST /api/photos checks JPEG, hash, owner, record whitelist + scope; GET /api/photos/[captureId]. Files in PHOTO_STORAGE_DIR (default storage/photos, git-ignored).
- Test & picture policy matrix: /super-admin/test-point-policies (6 points MOT_SHOP, ZMCC_LAB_MC, ZMCC_LAB_HC, ZMCC_DISPATCH, CONTRACTOR_DISPATCH, PLANT_QA; versioned; change log). Seed script scripts/seed-test-point-policy.ts (dry-run unless --apply; NOT run).
- Owner rule from now: no tests written/updated until all phases are done; backlog in docs/TEST_BACKLOG.md.
- Known follow-ups: src/lib/rate-limit.ts clientIp trusts x-forwarded-for (normal login); plant QA photos have no department scope check; stage screens (MOT/lab/arrival/tank) not yet widened for superiors (Phase 4).
- YOU MUST TEST BY HAND: Phones screen (register a phone, scan QR on /device-setup, MOT sync works offline->online), station login on a shared PC, Test Matrix save, live camera on MOT/QA/ZMCC lab screens, Zonal Manager can no longer apply corrections, Data Executive can.

---

## Phase 4A — done (21 Oct 2026): Stage 1 MOT Field Collection
- MOT Route Execution: MDO route creation and ZMCC Manager approval (`STAGE_1_NEW_ROUTE`). MOT assigned route, sequential shop processing.
- Live camera photo capture with metadata stamp band (no gallery upload).
- Decision rule evaluation (`src/backend/services/milkTestPolicyService.ts`): Auto-accept on PASS, direct reject on FAIL, exception escalation on mismatch or missing photo.
- Automatic 13 TS calculations ($13\text{ TS} = \text{Gross Liters} \times \frac{\text{TS}\%}{13}$).
- **"Return to PHE" Action**: Added "Return to PHE" button in `JourneyCard` and `ReceiptModal` with a confirmation modal (`ReturnToPheModal.tsx`) summarizing total gross volume, @13TS liters, and remaining unvisited shops. Transitions journey to `RETURNING` status (`returnMotJourneyToPhe`), persists to offline cache, and provides "Resume Collection" fallback.

---

## Phase 4B — done (21 Oct 2026): Stage 2 ZMCC Reception & Weighing
- Intake arrival logging: PHE Operator issues sequential ZMCC Token for MC and HC.
- **Real-Time Incoming Vehicle Queue**: PHE Operator and MDO reception screen (`/phe`, `MotArrivalPanel.tsx`) prioritizes tankers in `RETURNING` status under a highlighted "Incoming / Returning to ZMCC (En Route)" section, alerting gate operators of approaching vehicles, driver details, and collected liters before gate arrival. Issuing ZMCC Token closes the journey to `COMPLETED`.
- Laboratory Testing Mode: Supports Composite (1 blended portion) and Portion-Wise (2+ separate portions).
- HC Milk Source Linkage: Mandatory ERP source selection on "Accept Portion" only. Unregistered sources trigger "+ Request New Source" for MPD Head.
- Portion Decision Rule: If all portions are rejected, entire vehicle is rejected and journey closes immediately.
- ZMCC Weighing Loop: Only accepted portions weighed. Sequence: First Weight (Gross KG) → Unload to active ZMCC chilled tank → Second Weight (Tare KG) → Net KG.
- Area Loss / Gain: Calculated automatically ($\text{ZMCC Accepted Net KG} - \text{MOT Shop Recorded Net KG}$) and posted to `ZmccTankTransaction` (RECEIPT).

---

## Phase 4C — done (21 Oct 2026): Stage 3 Tanker Dispatch
- ZMCC & Contractor Dispatch forms with compartment-wise security seals and net weights.
- Compulsory photo evidence: assigned lab test photos and physical hand-written lab report photo.
- Dedicated Contractor Dispatch Station (`/contractor/dispatch`) for third-party direct deliveries.
- Tank inventory deduction: Gross liters deducted from active ZMCC storage tank upon dispatch confirmation.
- Weighted composite quality calculation for multi-portion tankers.

---

## Phase 4D — done (21 Oct 2026): Stage 4 Plant Reception (Gate to Silo)
- Security Gate Entry: Plant Gate Token issuance, driver verification, vehicle queue management.
- QA Reception Testing: QAE testing against plant SOP rules, compartment security seal verification against dispatch snapshots.
- Escalation: Broken or mismatched seals, test failures, or missing photos route to AVP QA (`STAGE_4_PORTION_EXCEPTION`).
- Composite Failure Rule: Failure of a composite tanker test immediately rejects the entire vehicle.
- Business Date Locking: Locked strictly once at initial First Weight (Scale 1) with 08:00 AM cutoff.
- Dual Weighing Models: Composite (single gross/tare cycle) and Portion-Wise (iterative gross/silo unload/tare loop per accepted compartment).
- Tanker CIP Washing Inspection: Security Operator verifies tanker wash (`tanker_washed === true`) before enabling Gate Exit.

---

## Phase 5 / Final Alignment — done (21-22 Oct 2026): UX Perfection, Naming, Source Authority & Lock
- **ZMCC Manager Redesign**: Obsolete embedded views (`ARRIVAL_CORRECTIONS`, `LAB_CORRECTIONS`) removed; clean layout focused on Operations, Reconciliation, History & Reports, and Master Data.
- **Milk Source Authority Exclusive to MPD Head**: Removed write authority from ZMCC Manager. Only `HEAD_OF_MPD` and `SUPER_ADMIN` can create ERP milk sources (`WRITE_MILK_SOURCE: ['HEAD_OF_MPD']`).
- **Direct Plant Contractors**: Added `POST /api/finance/contractors` API and Drawer for MPD Head to onboard direct plant contractors and allocate ERP milk sources across ZMCCs and Contractors.
- **HC Nomenclature Standardization**: Replaced all user-facing instances of "Local Supplier", "Local Suppliers", "Registered Suppliers", and "Direct Supplier Intake" with **"HC"** / **"HC Suppliers"** / **"HC Intake"** across components, tables, drawers, forms, and navigation.
- **Pure Sidebar Navigation**: Removed in-page tab bars (`SegmentedTabs`) from Weighbridge Station, Production Silos, and QA Head. Navigation is strictly driven via `HierarchicalNavDrawer`, with dynamic headers adapting subtitles to the URL state (`?tab=...`).
- **Team Station Delegation Navigation**: When a superior covers or visits a subordinate station, sidebar dynamically renders the subordinate station's full operational navigation tree with a pinned "← Return to [Superior Role] Workspace" button.
- **End-to-End Operational Verification**: Seeded rich, realistic dummy data across all 6 critical stations (`scratch/seed_full_workflow_data.ts`), verified with `scratch/verify_all_screens.ts`:
  - ZMCC Manager: 56 live pipeline visits
  - QA Head: 6 Stage 4 exceptions
  - MPD Head: 4 ERP sources, 3 contractors, 3 requests, 10 approvals (Stage 4 excluded)
  - Weighbridge: 12 ready for gross, 5 ready for tare
  - QA Lab: 13 waiting for testing
  - Production: 6 ready to unload, 5 active unloading
- **Quality Gates**:
  - TypeScript: `node node_modules/typescript-7/bin/tsc --noEmit` passed with 0 errors.
  - Backend Test Suite: `node --import tsx --test src/backend/**/*.test.ts` passed (144 / 144 tests passing).

## Phase 6 — Sources, HC/MC naming, vehicle weighing, exit (23 Oct 2026) — code done, DB migration NOT applied
- **Schema / migration** `20261022100000_hc_mc_sources_weighing_exit` (owner runs `npx prisma migrate deploy`; run the demo reset script first): drops `erp_code_request`, `zmcc_contractor_arrival`, HC `erp_reference`/`erp_mapping_status`, shop `milk_source_id`; adds source on `zmcc_tank_receipt`, manual-entry fields on portions, unload/exit/close-request fields on lab session, `zmcc_weighing_policy`; renames `LOCAL_SUPPLIER` -> `HC`, `ZMCC_LAB_MOT` -> `ZMCC_LAB_MC`, `ZMCC_LAB_LOCAL_SUPPLIER` -> `ZMCC_LAB_HC`.
- **Sources / ERP:** independent sources managed only by MPD Head, Super Admin, Data Executive; no request flow; names only for field roles; contractor ERP code required on Procurement Sources; `/api/finance/*` -> `/api/mpd/sources/*`; finance screens removed.
- **MC:** source required on every collection; shop has no source; vehicles managed only by Data Executive / Super Admin; Fleet screen; substitute vehicles removed.
- **HC:** renamed everywhere (routes `/api/zmcc/hc-suppliers`, `hc-arrivals`, `arrivals/hc`); no source/ERP at registration, arrival or lab; contractor arrival removed.
- **Weighing:** vehicle-level card + drawer, N+1 weight chain or manual net (Super Admin global policy), net-only for operators, single Unload to ZMCC tank transaction.
- **Exit:** HC gate exit with computed outcomes; close-without-unloading (PHE requests, ZMCC Manager approves); reports for manager, MPD Head, vehicle-stages.
- **Corrections:** Data Executive / Super Admin only; ticket flow for lower roles; counts and badges removed below Data Executive.
- **Demo data:** seed and demo scripts rewritten to the new model, **not run**.
- **Quality:** `tsc --noEmit` 0 errors. Not done: browser walkthrough, tests (logged for later), full lint cleanup. Known leftovers: sync keys `ZMCC_LOCAL_SUPPLIER_ARRIVAL` / `ZMCC_MOT_ARRIVAL` and nav ids `mot-arrival` / `local-supplier-arrival` kept to avoid breaking queued offline items; `/api/zmcc/lab/sessions/[id]/receive` (historical receipt) still exists; `emergencySubstitutes` still read in the MPD executive overview; `NEW_SOURCE` type still in `approvalMatrix.ts`.
