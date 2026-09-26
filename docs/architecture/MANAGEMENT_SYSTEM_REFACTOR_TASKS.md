# Milk Procurement Management System Refactor Tasks

This file is the execution tracker for `MANAGEMENT_SYSTEM_REFACTOR_PLAN.md`. Tasks are ordered to keep the application usable and to avoid mixing architectural movement with unapproved business changes.

## Working rules

- Work in the existing `MilkReceptionApp` directory and current Git repository.
- Preserve unrelated local changes.
- Complete one small, reviewable task at a time.
- Add characterization coverage before changing uncertain behavior.
- Use application services for writes and dedicated query services for management dashboards.
- Treat database changes as explicit, reviewed tasks with a migration and rollback/forward-recovery note.
- Defer unit, integration, end-to-end, and full regression test execution until all requested implementation tasks are complete, unless the user explicitly asks to run tests earlier. Record test coverage as pending rather than claiming verification.
- Run the complete relevant test suite at the end of the project, or immediately when the user says to test.
- Do not proceed past a phase gate until its required checks have eventually passed; deferred checks keep the phase gate pending.
- Update the checkboxes and add a short dated note when a task is completed or its scope changes.

## Current execution order

### Completed implementation work

- Baseline, hierarchy, core access-control foundation, correction governance, and the ZMCC Manager overview: Phases 0, completed Phase 1 slices, Phase 2 foundation, and completed Phase 5 tasks.
- Shop and Local Supplier identity validation: Phase 5A online enforcement.
- ZMCC laboratory policy, live rule evaluation, attendant decision workflow, manager exception workflow, and accepted tank receipt/stock workflow: P6A-01 through P6A-08.
- Paper-reference lifecycle, Local Supplier RMR schema, legacy classification, and the protected RMR issuance API: P7-01 through P7-08, plus the P6A-09 backend portion.

### Implement next, in this order

1. Finish `P6A-09`: connect the Local Supplier RMR physical book/receipt entry screen to the protected issue API, then display and reprint the issued receipt.
2. Complete Plant QA decisions and the plant progression guard: `P6A-10` through `P6A-16`.
3. Add live manager decision queues: `P6A-18`.
4. Build MPD gain/loss and Finance reconciliation: Phase 6.
5. Complete identity backfill/privacy/offline work: Phase 5A remaining tasks.
6. Build management reporting, Admin Head board, MOT map, PWA, and notifications: Phases 3, 4, 6B, and 6C.
7. Complete architecture cleanup and known reliability repairs: Phases 9 and 10.
8. Run all deferred automated, regression, browser, and release checks only when the product owner says **do tests now**.

### Deferred until final test instruction

Every task explicitly labelled **tests**, all phase-gate verification, and the release checklist remain pending. They are intentionally not run during implementation.

## Phase 0 - Baseline and decisions

- [x] `P0-01` Inventory the repository, routes, major workspaces, Prisma models, migrations, and test baseline.
- [x] `P0-02` Confirm the organizational hierarchy and branch ownership.
- [x] `P0-03` Confirm that Super Admin has complete application authority with validation and audit.
- [x] `P0-04` Confirm the correction escalation direction: operator request, manager correction within limits, head approval for higher impact, Super Admin exceptional authority.
- [x] `P0-05` Map current ZMCC Manager, MPD Head, Admin Head, TV board, MOT summary, and paper-reference implementation.
- [x] `P0-06` Record answers to all product-owner decisions listed in the plan.
- [x] `P0-07` Create a behavior matrix for current pages and APIs: role, capability, data scope, route, and expected result.
- [x] `P0-08` Record the clean baseline commands and results for typecheck, lint, unit tests, and relevant integration tests.
- [x] `P0-09` Identify existing uncommitted changes by owner/purpose before modifying any touched file.
- [x] `P0-10` Reconcile the existing optimistic-lock schema fields with a focused migration and restore the integration-test baseline.

Phase gate: hierarchy, terminology, current authorization behavior, and the clean test baseline are documented.

## Phase 1 - Access-control foundation

- [x] `P1-01` Define typed capabilities for view, create, edit draft, submit, request correction, correct, approve, close, post, administer, and view audit.
- [x] `P1-02` Define typed resource scopes for department, source/ZMCC, route, supplier, and record ownership.
- [x] `P1-03` Create the centralized `can(actor, capability, scope)` policy contract.
- [x] `P1-04` Map every current role to capabilities without changing application behavior yet.
- [x] `P1-05` Grant Super Admin all defined capabilities through the same policy engine.
- [x] `P1-06` Add tests for allowed role, denied role, assigned scope, wrong scope, missing scope, and Super Admin.
- [x] `P1-07` Add a thin server guard/helper for Next.js route handlers and server components.
- [x] `P1-08` Replace authorization in one low-risk vertical slice and verify page/API consistency.
- [ ] `P1-09` Migrate remaining role checks slice by slice; remove a legacy check only after its replacement passes tests. *(Weighbridge slice migrated; other slices remain.)*
- [x] `P1-10` Correct high-role redirects that currently lead to pages or APIs the role cannot use.

Phase gate: one authorization source governs both UI visibility and server enforcement; scope isolation is tested.

## Phase 2 - Audit and correction foundation

- [x] `P2-01` Define the correction lifecycle and correction impact levels as domain types.
- [x] `P2-02` Define a per-module correction field policy instead of a single unrestricted generic editor.
- [x] `P2-03` Define an immutable audit event containing actor, timestamp, reason, before, after, record ID, and correlation ID.
- [x] `P2-04` Define adjustment/superseding behavior for closed or financially posted records.
- [x] `P2-05` Create an application service contract for requesting, approving, applying, rejecting, and cancelling corrections.
- [x] `P2-06` Ensure corrections and their audit events commit in one transaction. *(Verified in ZMCC Lab, MOT collection, ZMCC arrival/gate-exit, and dispatch correction workflows; each uses a transaction and row lock where required.)*
- [ ] `P2-07` Add tests proving operators cannot edit submitted records directly.
- [ ] `P2-08` Add tests for manager threshold, head escalation, Super Admin authority, and out-of-scope denial.
- [ ] `P2-09` Add tests proving original values remain traceable after correction or adjustment.

Phase gate: correction rights are explicit, auditable, scoped, and safe for downstream calculations.

## Phase 3 - Management reporting foundation

- [x] `P3-01` Define management query contracts separately from operational write models. *(Added typed management scope, filters, pagination, and serialized vehicle-stage read-row contracts under `management-reporting`; these contracts contain no Prisma write models.)*
- [x] `P3-02` Define a shared normalized vehicle-stage vocabulary across ZMCC and plant processing. *(Added management-facing stage labels and one pure map from current dispatch, gate, QA, weighbridge, unloading, exit, completion, rejection, and cancellation statuses.)*
- [x] `P3-03` Build a server-side vehicle-current-stage projection from authoritative events/statuses. *(Added a read-only server projection over VehicleVisit status, gate entry, source, update time, and pending QA-manager review evidence.)*
- [x] `P3-04` Define consistent date, source, role, vehicle, route, and exception filters. *(Shared contracts define the filter vocabulary; the vehicle-stage projection now applies date, source, vehicle, and exception filters. Route filtering will activate when the source-to-route projection is introduced.)*
- [x] `P3-05` Add query-level scope enforcement so filters cannot expand a user's authorized scope. *(Management queries receive server-chosen scope and reject a source filter outside an assigned ZMCC; the data query also always applies the scoped source ID.)*
- [x] `P3-06` Add stable response schemas and API contract tests. *(Published `GET /api/management/vehicle-stages` with the typed stable response shape, server-derived scope, and no-store response policy. Contract tests remain deferred with the final test suite.)*
- [x] `P3-07` Add pagination and deterministic ordering for history and exception lists. *(Vehicle-stage projection orders by latest update then ID and returns bounded page/pageSize/total/totalPages.)*
- [x] `P3-08` Add query timing/observability for large management views before optimization. *(Vehicle-stage API returns rounded query duration and a standard Server-Timing metric for browser/network observability.)*

Phase gate: dashboard APIs return typed, scoped, stable read models without exposing Prisma records directly.

## Phase 4 - Admin Head and restricted TV board

- [x] `P4-01` Define the Admin Head dashboard contract for subordinate security activity and vehicle presence. *(Added an explicit restricted dashboard contract containing only security activity totals and safe in-plant vehicle board fields.)*
- [x] `P4-02` Implement a query that returns only vehicles currently inside the plant.
- [x] `P4-03` Return only vehicle identifier, normalized current stage, and necessary stage timestamps to the vehicle board.
- [x] `P4-04` Add an explicit response allowlist that excludes supplier, milk quantity, test, rate, payment, and correction data.
- [x] `P4-05` Apply Admin Head branch scope and Super Admin override through centralized capabilities. *(The dashboard API permits only ADMIN_HEAD and SUPER_ADMIN.)*
- [x] `P4-06` Update the Admin Head UI to show subordinate/security information and the restricted vehicle-stage board.
- [ ] `P4-07` Add privacy contract tests that fail if a sensitive field enters the board response.
- [ ] `P4-08` Verify stage transitions and removal from the board after plant exit/closure.

Phase gate: Admin Head can supervise the security branch and see only the requested in-plant vehicle status.

## Phase 5 - ZMCC Manager workspace

- [x] `P5-01` Define a source-scoped ZMCC Manager overview read model.
- [x] `P5-02` Consolidate expected, arrived, waiting, testing, accepted, rejected, unloaded, and dispatched vehicle counts.
- [x] `P5-03` Add current station, delay indicators, and responsible subordinate role.
- [x] `P5-04` Add MOT journey totals beside the corresponding ZMCC arrival and lab result.
- [x] `P5-05` Include tank stock, dispatch readiness, unresolved exceptions, and correction requests.
- [x] `P5-06` Enforce the manager's assigned source/ZMCC in the query rather than trusting a request parameter.
- [x] `P5-07` Connect manager correction actions to the correction-governance service.
- [x] `P5-08` Refactor the workspace into focused feature components using the new read model. *(Added the independent source-scoped manager snapshot component; existing operational tabs remain feature components.)*
- [ ] `P5-09` Add tests for cross-ZMCC isolation and Super Admin access.

Phase gate: the ZMCC Manager can supervise the complete assigned-source flow without receiving cross-source data.

## Phase 5A - Shop and Local Supplier identity

- [x] `P5A-01` Confirm phone number and CNIC as mandatory for Shop and Local Supplier creation and active records.
- [x] `P5A-02` Verify that Shop already has non-null schema fields and server-side required/format validation.
- [x] `P5A-03` Verify that Local Supplier currently permits null/blank phone and CNIC and therefore does not meet the confirmed rule.
- [x] `P5A-04` Define canonical stored formats for Pakistani mobile number and CNIC while accepting supported formatted input.
- [ ] `P5A-05` Require valid phone and CNIC in Local Supplier create/update APIs and offline synchronization contracts. *(Online service and UI enforcement verified; offline replay coverage remains.)*
- [x] `P5A-06` Inventory existing Local Suppliers missing either value and provide an audited incomplete-record correction queue. *(Scoped managers can request the remediation queue through the Local Supplier API; existing audited update actions repair the record.)*
- [x] `P5A-07` Block activation and new arrivals for incomplete Local Suppliers after the enforcement date. *(Create/update activation requires valid identity data; the arrival command now also rejects incomplete legacy suppliers.)*
- [ ] `P5A-08` Backfill existing data and then create a focused migration making Local Supplier phone and CNIC non-null.
- [x] `P5A-09` Mask phone/CNIC by default, restrict full-value access by capability, and remove full values from notifications, URLs, broad logs, and unrelated screens. *(Local Supplier read responses mask identity values unless the actor is the scoped ZMCC Manager or Super Admin; operational arrival reads use supplier identity by ID rather than returning it.)*
- [ ] `P5A-10` Add validation, migration, privacy-response, authorization, and offline-replay tests.

Phase gate: every active Shop and Local Supplier has validated phone/CNIC data, and sensitive identity values are exposed only where required.

## Phase 6 - MPD gain/loss and reconciliation

- [x] `P6-01` Define the authoritative reconciliation identity joining MOT journey, vehicle, ZMCC arrival, final ZMCC lab session, and optional tank receipt.
- [x] `P6-02` Confirm that partial acceptance/rejection uses physically separable compartment/lot allocations whose quantities reconcile to the measured total.
- [x] `P6-03` Build the MOT side from stored journey summary values: shop count, gross liters, and liters at 13TS. *(Added the immutable journey-summary origin snapshot contract; report calculations must not rebuild origin totals from mutable shop collection rows.)*
- [x] `P6-04` Build the ZMCC side from authoritative measured quantity and final approved lab inputs. *(Added the final ZMCC lab-session destination snapshot; it uses final decision, calculated gross liters, and calculated 13TS liters rather than arrival estimates.)*
- [x] `P6-05` Calculate area signed variance, loss, gain, and loss percentage from MOT shop collection to ZMCC measurement.
- [x] `P6-06` Calculate area values separately for gross liters and liters at 13TS.
- [x] `P6-07` Expose accepted and rejected quantities without deriving unsupported detail from a whole-arrival decision.
- [x] `P6-08` Keep arrival measurement variance separate from rejected-milk disposition.
- [x] `P6-09` Join each ZMCC dispatch to the authoritative plant receipt. *(Defined the dispatch-to-vehicle-visit-to-final-plant-receipt identity used for route reconciliation.)*
- [x] `P6-10` Calculate route signed variance, loss, gain, and loss percentage from ZMCC dispatch to plant receipt for gross and 13TS.
- [x] `P6-11` Build an MTD stock bridge using opening stock, MPD-owned origin quantities, plant receipts, closing stock, and approved rejection/disposal/transfer quantities; expose included and excluded source categories.
- [x] `P6-12` Reconcile the complete MTD result into area variance, rejection/disposal, ZMCC stock/handling variance, route variance, and unresolved items.
- [x] `P6-13` Show gross loss, gross gain, and net variance separately at row, group, and complete-MPD levels. *(Added reusable gross/13TS loss-gain aggregation.)*
- [x] `P6-14` Apply the effective-dated Finance target of MTD 13TS loss below 1.5%, show gross-liter loss as a parallel physical KPI, and allow only Super Admin to activate a target change. *(The target is effective-dated and auditable; only Super Admin may activate it. MPD Head and Finance Accounts have a read-only target history, while loss reporting presents gross liters in parallel with 13TS.)*
- [x] `P6-15` Exclude pending/unmatched movements from finalized loss while showing them clearly as unresolved exposure. *(Reconciliation helpers split resolved movements from unresolved exposure before aggregating finalized totals.)*
- [x] `P6-16` Build ZMCC Manager visibility for assigned-source area/route results and assigned-source MTD contribution. *(Read-only reconciliation endpoint is source-scoped for ZMCC Manager and shows finalized loss/gain separately from unresolved exposure; it also permits MPD Head, Finance, and Super Admin to read the complete result.)*
- [x] `P6-17` Build MPD Head visibility across all MPD sources, staff, routes, vehicles, exceptions, and the complete MTD result. *(MPD Head has a dedicated cross-source reconciliation overview with route, vehicle, and unresolved-result visibility; live vehicle exceptions are supplied by the existing scoped stage read model.)*
- [x] `P6-18` Build Finance visibility for the consolidated complete MPD MTD result and its verification drill-down. *(Finance has a protected MTD reconciliation view, active target comparison, gross and 13TS KPIs, and a source/route/journey/vehicle verification table.)*
- [x] `P6-19` Add drill-down from report totals to ZMCC, area, route, MOT, journey, vehicle, shop collection, lab result, plant receipt, audit, and correction. *(The protected journey evidence endpoint provides the finalized MOT summary, ZMCC arrival/lab/tank receipt, shop collections and RMRs, test results, and relevant audit/correction evidence. Plant receipt is shown only where a dispatch-to-plant identity exists; this model does not infer a plant receipt from a MOT journey.)*
- [x] `P6-20` Keep milk-test policy management as a separate MPD Head section rather than the entire workspace. *(MPD reconciliation is now the MPD Head overview; milk-test policy management remains a distinct section below it.)*
- [ ] `P6-21` Add formula, rounding, stock-boundary, period-boundary, rejection, missing-result, duplicate-link, and scope tests.

Phase gate: ZMCC Manager, MPD Head, and Finance can trace area and route results, and the complete MTD MPD result reconciles through stock without treating pending milk as loss.

## Phase 6A - Laboratory policy and final decisions

- [x] `P6A-01` Inspect current active ZMCC/Plant rules, test-assignment sources, automatic evaluation, attendant decisions, manager exceptions, and role guards.
- [x] `P6A-02` Confirm the currently configured min, max, categorical option, unit, and testing-point values as official.
- [x] `P6A-03` Classify each test as release, monitoring, or informational and identify any non-overridable hard-stop tests. *(Existing rules classify Release/Monitoring; no hard stop is configured or inferred. Informational is reserved for future explicit configuration.)*
- [x] `P6A-04` Split laboratory configuration: QA Head owns limits/rules, Data Executive owns test catalog/assignment metadata, and Super Admin can manage both; all changes are directly effective, versioned, and audited.
- [x] `P6A-05` Replace inconsistent ZMCC and Plant test-selection sources with one canonical assignment policy and frozen per-session snapshots.
- [x] `P6A-06` Ensure ZMCC MOT and Local Supplier sessions receive every required test and active rule. *(All direct ZMCC suppliers use the Local Supplier terminology and behavior.)*
- [x] `P6A-07` Store observed results, system outcome, attendant recommendation, and manager final decision as separate fields/events.
- [x] `P6A-08` Change ZMCC completion so system evaluation is advisory and the ZMCC Lab Attendant makes the normal final accept/reject decision. A disagreement requires the attendant's reason and is held for ZMCC Manager review; all actions retain actor and time evidence.
- [x] `P6A-09` Create ZMCC tank receipt and stock movement after a final accepted decision (immediate matching attendant acceptance or approved manager exception), then issue Local Supplier RMR only for a final accepted Local Supplier arrival. *(RMR issuance requires the Lab Attendant to enter the physical annual series, book, and receipt number; the server locks and audits the permanent issuance.)*
- [x] `P6A-10` Change Plant QA completion so system evaluation is advisory and the QA Lab Attendant makes the normal matching accept/reject decision. A disagreement requires the attendant's reason and is routed to the QA Manager; QA Manager or Super Admin records the exception decision with audit evidence.
- [x] `P6A-11` Block weighbridge/unloading progression until a final accepted QA decision. *(Pending exception portions retain the visit in `PLANT_QA`; only a final accepted decision permits `READY_FOR_GROSS`.)*
- [x] `P6A-12` Make OUT_OF_SPEC recommend rejection and require an audited manager exception reason for any permitted acceptance. *(Any system/attendant disagreement, including an out-of-spec acceptance, requires the attendant reason and QA Manager/Super Admin decision audit.)*
- [x] `P6A-13` Fail closed on missing/invalid rules and prevent manager override of configuration errors or non-overridable hard stops.
- [x] `P6A-14` Give Super Admin the same legitimate final-decision and correction capabilities with mandatory reason/audit, while preserving validation and physical-state guards.
- [x] `P6A-15` Add correction/escalation access for MPD Head and QA Head according to branch ownership without overwriting the original decision. *(QA Head can review QA exceptions; MPD Head has system-scoped read/correction access only for finalized ZMCC lab records. Both preserve the original decision and audit the escalation actor.)*
- [x] `P6A-16` Add concurrency and idempotency protection so one session receives only one effective final decision. *(Plant QA now locks the visit and stores a unique completion client-event ID; ZMCC lab already uses row locking and completion-event idempotency.)*
- [ ] `P6A-17` Add tests for exact boundary values, below-minimum, above-maximum, categorical failure, warning-only, missing rule, overlapping rule, manager approval, exception acceptance, rejection, scope, and Super Admin.
- [x] `P6A-18` Add live ZMCC Manager and QA Manager decision queues with aging/alerts; require individual review for every exception. *(Matching PASS/accept decisions finalize immediately, so there are no ordinary pending recommendations to batch approve. Existing ZMCC exception review and QA Manager queue show pending items.)*
- [x] `P6A-19` Model test definition, testing-point assignment, source applicability, and QA-owned rule version as separate concepts. *(LabTest is the catalog; MilkTestPolicyAssignment owns testing point and optional source applicability; LabTestRule owns versioned/effective-dated QA limits.)*
- [x] `P6A-20` Support adding, updating, assigning, and deactivating future tests without changing frozen in-progress or historical session snapshots. *(The policy workspace manages future assignments; ZMCC and Plant QA persist frozen assignment/result snapshots at session start.)*
- [x] `P6A-21` Validate activation so every required release test has exactly one valid effective rule for its testing point and applicable source type. *(Required assignment creation, reactivation, or conversion from optional to required is blocked unless the QA rule resolver finds exactly one valid active Release rule.)*
- [ ] `P6A-22` Add capability tests proving Data Executive cannot change limits, QA Head cannot mutate catalog/assignment metadata, Super Admin can do both, and operational roles can do neither.

Phase gate: attendants record laboratory evidence and make normal matching decisions; managers decide documented exceptions and corrections. System rules are complete and frozen, and no stock/unloading side effect occurs before a final accepted decision.

**Phase 6A implementation status:** complete. `P6A-17` and `P6A-22` are intentionally deferred automated authorization, boundary, and regression tests. Run them only when the product owner says **do tests now**.

## Phase 6B - MOT journey map and location tracking

MOT offline tasks `P6B-15` onward depend on the shared PWA foundation in `P6C-01` through `P6C-03`.

- [x] `P6B-01` Inspect the current MOT journey, location, stop, offline queue, upload validation, map projection, and map authorization implementation.
- [ ] `P6B-02` Define a location-tracking state machine tied only to an assigned active MOT journey and stop it on end, cancellation, logout, or loss of the active app session.
- [ ] `P6B-03` Capture an immediate first MOT-device point when the active journey opens, then continue configurable periodic foreground capture.
- [ ] `P6B-04` Keep GPS points append-only with journey, actor/device source, device timestamp, server timestamp, accuracy, and idempotency identity.
- [ ] `P6B-05` Preserve the offline GPS queue and make authentication, conflict, permanent validation, and retryable failures distinct.
- [ ] `P6B-06` Add an MOT tracking indicator for active state, last point, accuracy, permission error, and unsynced count.
- [ ] `P6B-07` Integrate MapLibre GL JS and PMTiles for the real geographic map while preserving the schematic no-tiles fallback.
- [ ] `P6B-08` Show dispatch start, first MOT point, chronological trail, planned shops, actual collection points, skipped stops, latest point, final MOT point, and ZMCC endpoint.
- [ ] `P6B-09` Add configurable unplanned-stop/dwell detection with GPS-accuracy and impossible-jump filtering.
- [ ] `P6B-10` Add scoped access for MOT-own, assigned PHE, assigned ZMCC Manager, MPD Head, and Super Admin; exclude Finance, unrelated branches, and TV board.
- [ ] `P6B-11` Add live refresh/subscription and clearly display stale-location and tracking-gap states.
- [ ] `P6B-12` Prevent manual movement/deletion of evidence points; support audited flags for suspected inaccurate or spoofed points.
- [ ] `P6B-13` Define GPS retention, export, and access-audit policy before production rollout.
- [ ] `P6B-14` Add tests for permission denial, journey ownership, time bounds, offline replay, duplicates, end/cancel stopping, bad accuracy, invalid coordinates, and scoped map visibility.
- [ ] `P6B-15` Use the shared PWA foundation to cache the MOT workspace so an already prepared device can open it without internet.
- [ ] `P6B-16` Define the MOT-specific offline data boundary for current journey, shops, tests, forms, map pack, drafts, and outbox records.
- [ ] `P6B-17` Generate and self-host permitted PMTiles packs by ZMCC/route area with local styles, glyphs, sprites, attribution, version, size, and checksum.
- [ ] `P6B-18` Add an online preparation screen that downloads the current assignment, required reference data, and selected offline map pack before dispatch.
- [ ] `P6B-19` Apply the shared bounded offline device authorization to the assigned MOT identity and journey without caching a password.
- [ ] `P6B-20` Extend the IndexedDB outbox to cover all permitted MOT operations with explicit local-saved, pending, conflict, fatal, and synchronized states.
- [ ] `P6B-21` Add MOT map-pack quota, route-pack replacement, and journey-data cleanup on top of shared revoked-device and application-update handling.
- [ ] `P6B-22` Test cold offline reopen after preparation, no-pack fallback, long disconnection, phone restart, expired offline authorization, conflict replay, and recovery after connectivity returns.

Phase gate: an authorized manager can reconstruct where an MOT journey started, travelled, stopped, and ended, while tracking remains limited to the active open-app journey.

## Phase 6C - Complete PWA and role-based notifications

- [x] `P6C-01` Define one PWA shell, manifest, icon set, service worker lifecycle, cache version, update prompt, and offline fallback for all roles. *(Added the shared manifest, versioned service worker, safe navigation fallback, connectivity banner, and update prompt. Product icons remain a visual-asset follow-up.)*
- [x] `P6C-02` Define per-role offline capabilities; keep server-current approvals, administration, and financial actions online-only unless separately proven safe. *(Added `PWA_OFFLINE_POLICY.md` with a role-by-role capability matrix and explicit online-only authority boundaries.)*
- [x] `P6C-03` Add secure initial installation/preparation and bounded offline device authorization without storing passwords. *(An online MOT preparation command stores only an eight-hour journey/source/user-scoped signed receipt in IndexedDB. It is explicitly rejected as a login token; offline opening requires a matching unexpired preparation.)*
- [x] `P6C-04` Build an in-app notification center with unread/read state, filters, priority, source, timestamp, and authorized deep links. *(Added a protected polling notification center with individual/all read actions and server-owned deep links.)*
- [x] `P6C-05` Define a typed notification event catalog and role/scope recipient rules for each business module. *(The initial catalog covers ZMCC/Plant QA exceptions, correction escalation, Finance target changes, and system alerts.)*
- [x] `P6C-06` Create transactional notification outbox and delivery records with deduplication, retry, expiry, and failure reason. *(The shared command creates an in-app notification and deduplicated delivery row through the caller transaction.)*
- [x] `P6C-07` Store multiple revocable Web Push subscriptions per user/device and invalidate them on logout, security reset, deactivation, role/scope change, or device removal. *(Multiple revocable subscriptions are stored per user/device. Logout, password reset, deactivation, and role/scope/source changes revoke active subscriptions with audit evidence.)*
- [x] `P6C-08` Implement the initial role notification matrix from the architecture plan. *(Live transactional alerts now cover ZMCC Manager lab exceptions, QA Manager QA exceptions, MPD Head correction escalations, and MPD Head/Finance target changes; Super Admin remains the recipient for system alerts.)*
- [x] `P6C-09` Add preferences, quiet hours, instant/digest options, and non-disableable mandatory alert categories. *(Users configure push, quiet hours, and immediate/digest preference. Mandatory system alerts always create in-app notifications; provider delivery enforcement applies when production push is enabled.)*
- [x] `P6C-10` Keep lock-screen payloads minimal and re-authorize every deep link before returning record details. *(Notification records contain only concise operational text and internal routes. Server and client reject external links; each destination continues to authorize the current user before exposing details.)*
- [ ] `P6C-11` Distinguish queued, provider-accepted, failed, expired, opened, and read; never claim delivery/read without evidence. *(The in-app channel records queued and read state from actual user actions. Browser subscription and click handling are prepared; push-provider accepted/failed/expired/opened states require the production delivery worker and VAPID configuration.)*
- [ ] `P6C-12` Show offline/online/sync/auth-expiry state consistently across the installed application. *(The shared shell shows online/offline/sync and can display an auth-expiry event; remaining API clients must emit that event on a 401 response.)*
- [x] `P6C-13` Add device/subscription administration for users and Super Admin with audit history. *(Users have notification settings/device visibility; Super Admin has a protected device inventory and audited revoke screen at `/super-admin/notification-devices`.)*
- [ ] `P6C-14` Add tests for transaction rollback, duplicate event, wrong scope, revoked subscription, expired alert, offline delivery delay, deep-link denial, quiet hours, mandatory alerts, and sensitive payload leakage.
- [ ] `P6C-15` Verify installation, offline reopening, push, notification click, and application update on supported Android, iOS home-screen, and desktop browsers.
- [x] `P6C-16` Enforce one active offline user per installed device profile and require online synchronized logout/cleanup before a shared device changes users. *(Online logout revokes subscriptions and clears the MOT journey, offline preparation receipt, drafts, collection queue, and GPS queue from the installed profile.)*

Phase gate: every role can install the application and receive authorized alerts without keeping a browser page open, while offline behavior and sensitive content remain controlled.

## Phase 7 - Paper references and RMR workflow

- [x] `P7-01` Confirm Raw Milk Dispatch Note as the only dispatch paper; keep it distinct from Raw Milk Token and Plant Gate Token.
- [x] `P7-02` Confirm ZMCC Lab Attendant issuance after acceptance and a separate annual Local Supplier RMR series.
- [x] `P7-03` Document Shop RMR, Local Supplier RMR, Raw Milk Token, Dispatch reference, and Plant Gate Token lifecycles.
- [x] `P7-04` Separate every paper reference from its immutable system ID in domain and API contracts. *(Shared core contract now covers primary and secondary operational responses; legacy flat fields remain during UI migration.)*
- [x] `P7-05` Design Local Supplier RMR issuance as an action after accepted ZMCC lab outcome.
- [x] `P7-06` Review the design before changing Prisma because the existing optional arrival `rmr_number` does not enforce the confirmed lifecycle.
- [x] `P7-07` Create a focused schema migration with structured RMR year, series, book, and receipt fields plus the approved composite uniqueness rule.
- [x] `P7-08` Backfill or classify existing local-supplier RMR values with an explicit migration policy.
- [ ] `P7-09` Add concurrency/uniqueness tests for each paper-number scope.
- [ ] `P7-10` Add audit events for issue, correction, cancellation, duplicate paper, and reprint actions.

Phase gate: every paper reference has one meaning, one lifecycle, one scope rule, and a traceable system record.

Development-data note: the local dummy operational history was reset after P7-08. The canonical plant demo seed now creates four journeys instead of 75 while preserving users, lab configuration, and master IDs.

## Phase 8 - Calculation propagation and financial locking

- [ ] `P8-01` Inventory every input and downstream result for gross liters, LR, fat, SNF, TS, and 13TS.
- [ ] `P8-02` Select one canonical implementation for each formula and rounding rule.
- [ ] `P8-03` Version formulas/effective dates where historical reproduction requires it.
- [x] `P8-04` Define Finance posting as the hard financial lock, with earlier acceptance, daily-close, and settlement-freeze controls.
- [ ] `P8-05` Define which corrections recalculate stock, gain/loss, supplier payable, settlement, and reports.
- [ ] `P8-06` Implement recalculation orchestration with a transaction or explicit queued retry/failure state.
- [ ] `P8-07` Prevent direct editing of calculated outputs.
- [ ] `P8-08` Use adjustments for already settled or posted values.
- [ ] `P8-09` Add end-to-end tests from corrected source input to all affected downstream outputs.
- [ ] `P8-10` Add reconciliation checks that detect mismatched old and recalculated values.

Phase gate: a correction cannot silently leave stock, reporting, or finance values inconsistent.

## Phase 9 - Feature-by-feature architecture cleanup

- [ ] `P9-01` Publish module dependency rules in lint/configuration where practical.
- [ ] `P9-02` Select the first vertical slice based on business risk and current testability.
- [ ] `P9-03` Add characterization tests for that slice.
- [ ] `P9-04` Move pure invariants and calculations into its domain area.
- [ ] `P9-05` Move orchestration into application commands/queries with explicit ports.
- [ ] `P9-06` Put Prisma access behind feature repository/query adapters.
- [ ] `P9-07` Reduce route handlers to authentication, validation, use-case invocation, and HTTP mapping.
- [ ] `P9-08` Split large UI workspaces by feature responsibility and consume typed API contracts.
- [ ] `P9-09` Remove frontend imports of backend implementation types and calculations.
- [ ] `P9-10` Verify checks, remove obsolete compatibility code, and then choose the next slice.

Repeat `P9-03` through `P9-10` for ZMCC reception, MOT, dispatch, plant reception, QA, production, finance, supplier management, and reporting.

Phase gate: each migrated feature has clear ownership and follows the dependency direction in the plan.

## Phase 10 - Known reliability and security repairs

- [ ] `P10-01` Upgrade the outdated Next.js dependency through a dedicated compatibility-tested change.
- [ ] `P10-02` Secure cron/background endpoints and remove any path that reports a mock notification as sent.
- [ ] `P10-03` Make silo issue retry idempotent and prevent duplicate business identities.
- [ ] `P10-04` Protect plant token assignment against concurrent duplication.
- [ ] `P10-05` Correct validation error handling where code reads the wrong Zod error property.
- [ ] `P10-06` Make offline synchronization distinguish authentication failure from a retryable network/server failure.
- [ ] `P10-07` Invalidate appropriate sessions/tokens after password reset.
- [ ] `P10-08` Resolve role-routing, page-guard, and API-guard mismatches for QA and production roles.
- [ ] `P10-09` Repair the raw LR/raw fat field mismatch using the authoritative schema fields.
- [ ] `P10-10` Finish or safely isolate the incomplete commercial-supplier schema work before release.

Phase gate: known critical correctness and security defects have regression coverage and are resolved.

## Release checklist for every completed slice

- [ ] Acceptance criteria for the task are written and met.
- [ ] Authorization and scope cases pass.
- [ ] Business calculations/invariants pass their tests.
- [ ] Typecheck, lint, and relevant existing tests pass.
- [ ] Any migration has a reviewed data-transition and recovery strategy.
- [ ] Audit behavior is verified for privileged writes.
- [ ] API responses contain no unauthorized or unnecessary fields.
- [ ] Relevant architecture/current-rules documentation is updated.
- [ ] The task checkbox and progress log are updated.

## Progress log

| Date | Task | Result | Notes |
|---|---|---|---|
| 2026-09-21 | P0-01 to P0-05 | Completed | Initial repository assessment and owner workflow clarification captured in the plan and task tracker. |
| 2026-09-21 | P0-06, P6-02, P7-01, P7-02, P8-04 | Completed | Recorded RMR issuer/annual series, dispatch-note terminology, physical partial-allocation rule, and finance-posting lock. |
| 2026-09-21 | P6 scope correction | Updated | Replaced assumed authorization thresholds with area, route, and complete MPD MTD gain/loss reporting; recorded Finance's below-1.5% MTD target. |
| 2026-09-21 | P6A-01 and target governance | Completed | Audited active lab rules and current decision paths; assigned final ZMCC/Plant decisions to their managers and target activation to Super Admin. |
| 2026-09-21 | P6A-02, P6A-04, P6B-01 | Completed | Confirmed official lab limits, split QA Head/Data Executive/Super Admin configuration authority, extensible testing-point design, and current MOT map/tracking assessment. |
| 2026-09-21 | Offline map/PWA decision | Approved direction | Selected MapLibre GL JS with self-hosted PMTiles route packs and an installable offline-first MOT PWA after one online preparation. |
| 2026-09-21 | P5A-01 to P5A-03 and full-PWA scope | Completed | Confirmed Shop/Local Supplier phone-CNIC requirement, audited current enforcement gap, and added role-scoped PWA notification architecture. |
| 2026-09-21 | P0-07 to P0-09 | Completed | Added `MANAGEMENT_SYSTEM_IMPLEMENTATION_LOG.md` with the current authorization matrix, protected pre-existing-work boundary, and command-level baseline. Typecheck, lint, and 207 unit tests pass; integration is blocked by the missing test-database `ZmccTank.version` column. |
| 2026-09-21 | P0-10 | Completed | Added a focused migration for the three pre-existing optimistic-lock version fields, rebuilt the isolated test database, and restored the integration baseline to 54/54 passing. |
| 2026-09-22 | Test execution policy | Updated | Per product-owner instruction, defer regression/unit/integration/E2E execution until all requested tasks are complete or the product owner explicitly says to test. Pending checks remain visible and phase gates are not claimed as verified until final testing. |
| 2026-09-22 | P7-03, P7-06 | Completed | Added `PAPER_REFERENCE_LIFECYCLES.md`; separated all five paper meanings from system IDs and reviewed the Local Supplier RMR lifecycle before Prisma changes. |
| 2026-09-22 | P7-05 | Completed | Defined the Local Supplier RMR issuance command, server-owned values, authorization, acceptance/stock preconditions, transaction effects, idempotency, concurrency conflicts, correction, cancellation, and reprint behavior. |
| 2026-09-22 | P7-04 | Completed | Added the shared immutable-system/paper-reference contract to Shop collection, ZMCC arrival, dispatch, Security, QA, Production, Weighbridge, Super Admin, and operational reporting responses. |
| 2026-09-22 | P7-07 | Completed | Added the dedicated Local Supplier RMR issuance model and focused additive migration with acceptance snapshots, lifecycle state, idempotency, and ZMCC/year/series/book/receipt uniqueness. |
| 2026-09-22 | P7-08 | Completed | Added a non-destructive legacy classification model and migration that preserves every non-empty arrival RMR as `NEEDS_REVIEW`; no legacy string is promoted into an official structured issuance automatically. |
| 2026-09-22 | P2-01 to P2-05 | Completed | Added correction-governance domain types, module-specific correction-field policy, immutable audit-event contract, locked-record adjustment/superseding rules, and the application-service contract. |
| 2026-09-22 | P2-06 | Completed | Verified existing high-risk correction paths update the record and write the audit row in the same Prisma transaction, with row locks for correction counters and concurrent updates. |
| 2026-09-22 | P5-01, P5-02, P5-06 | Implemented | Added authenticated, source-scoped ZMCC Manager overview API and read model for pipeline counts, tank stock, dispatch readiness, exception review queue, and correction-event visibility. |
| 2026-09-22 | P5-03, P5-04 | Implemented | Extended the overview read model with active MOT station rows, waiting minutes, accountable role, collection count, and journey quantity total. |
| 2026-09-22 | P5-08 | Implemented | Added a focused manager snapshot component backed by the new source-scoped overview API and embedded it into the existing overview tab. |
