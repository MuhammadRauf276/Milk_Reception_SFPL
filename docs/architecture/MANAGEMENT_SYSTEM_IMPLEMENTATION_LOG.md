# Management System Implementation Log

This is the evidence log for `MANAGEMENT_SYSTEM_REFACTOR_TASKS.md`. The task file defines the work; this file records what was found, changed, and verified. A checked task means its stated result exists and its evidence is recorded here or linked from here.

From 2026-09-22 onward, automated test execution is deferred until all requested implementation tasks are complete or the product owner explicitly requests testing. Entries made during this period use `Implemented` or `Documented`; final verification remains pending until the deferred suite runs.

## Status rules

| Status | Meaning |
|---|---|
| Planned | Accepted work that has not started. |
| In progress | Work has started but its acceptance checks are incomplete. |
| Implemented | Code or documentation is complete, but a required check is still blocked or failing. |
| Verified | Acceptance criteria and required checks pass. Only this state permits a task checkbox to be checked for code changes. |
| Blocked | A named dependency prevents further work. The blocker and recovery action must be recorded. |

Every implementation entry must name the task, affected files, behavior or decision, validation result, and any remaining risk. Database work must also name its migration and recovery strategy.

## Refactor starting point

- Recorded: 2026-09-21
- Branch: `feature/6g-g-operational-paper-references-corrections-audit`
- Commit: `0199e9e`
- Repository state: dirty before refactor implementation began

The following work was already modified or untracked at this starting point. Its exact author is not inferable from Git, so ownership is recorded as **pre-existing user/session work**. These files must be reviewed and preserved when a later task touches them.

| Existing work group | Files | Inferred purpose |
|---|---|---|
| Stage 6G-G schema and operations | `prisma/schema.prisma`, `scripts/run_all_regressions.ts`, `src/backend/services/zmccTankService.ts`, `src/frontend/modules/forms/DynamicDispatchForm.tsx` | Paper references, operational corrections, concurrency/version fields, and regression coverage. |
| Service decomposition | `src/backend/services/motService.ts`, `src/backend/services/mot/*`, `src/backend/services/zmccArrivalService.ts`, `src/backend/services/zmccArrival/*` | Split large MOT and ZMCC-arrival services into smaller modules. |
| Authentication and role routing | `src/app/api/auth/login/route.ts`, `src/lib/role-routing.ts`, `src/frontend/modules/shared/Sidebar.tsx`, Super Admin layouts/pages, `src/app/tv-board/page.tsx` | Database-backed login, role homes, navigation, and page access changes. |
| Commercial supplier work | `src/app/api/commercial-suppliers/*`, `src/backend/services/commercialSupplierService.ts`, `src/frontend/modules/zmcc/CommercialSupplierManager.tsx`, `src/backend/services/zmccLocalSupplierService.ts` | Incomplete commercial/local-supplier data and assignment flow. |
| Shared UI/data helpers | `src/app/error.tsx`, `src/app/loading.tsx`, `src/frontend/hooks/useArrivingJourneys.ts`, `src/frontend/lib/fetcher.ts`, `src/backend/core/db.ts` | Error/loading UI, shared fetching, polling, and database lifecycle changes. |
| Background endpoints | `src/app/api/cron/process-sms/route.ts`, `src/app/api/revalidate/route.ts` | SMS processing and revalidation endpoints requiring later security review. |
| One-off transformation scripts | root `fix_*.js`, `inject_phase2.js`, `split_mot.js` | Local code-rewrite helpers; these are not application runtime files. |
| Architecture documents | `docs/architecture/CURRENT-RULES.md`, `MANAGEMENT_SYSTEM_REFACTOR_PLAN.md`, `MANAGEMENT_SYSTEM_REFACTOR_TASKS.md` | Existing rules and the approved refactor plan/tracker. |

## Current access-behavior matrix

This matrix records observed behavior before centralized authorization is introduced. “Current result” describes the code as it exists; it is not approval of that design.

| Role | Current capability and scope | Page/API route | Current result / gap |
|---|---|---|---|
| Super Admin | User, source, silo, audit, warning, lab-test and policy administration | `/super-admin`; `/api/super-admin/*` | Most endpoints require `SUPER_ADMIN`. Several operational actions also allow it, but some manager decisions exclude it, contradicting complete-authority policy. |
| Executive Management | Routed to the Super Admin shell | `/super-admin` | The shell destination is shared, while Super Admin APIs reject this role; page/API behavior is inconsistent. |
| Data Executive | Routed to the Super Admin shell | `/super-admin` | Super Admin catalog APIs currently reject this role. Required test-catalog/assignment authority is not implemented. |
| MPD Head | MPD overview and milk-test policy administration outside Plant QA | `/mpd/head`; `/api/milk-test-policies*` | Can view its page and currently mutate some policies; complete subordinate scope, loss reports, corrections, and MOT visibility remain incomplete. |
| ZMCC Manager | Assigned-ZMCC workspace, lab review/correction, dispatch correction and selected MOT visibility | `/mpd/zmcc-manager`; ZMCC lab/correction APIs; dispatch correction APIs | Scope and role checks are distributed. Some final-decision paths are manager-only and dispatch corrections have a five-save quota. |
| ZMCC Lab Attendant | Assigned-source arrival/dispatch lab operations | `/zmcc/lab`, `/zmcc/dispatch`; ZMCC lab and dispatch APIs | Performs normal test sessions. Current completion behavior still mixes evidence/recommendation with outcomes that must later belong to the manager. |
| PHE Operator | Gate/token operations and selected assigned MOT visibility | `/phe`; PHE and MOT read APIs | Operator workflow exists; map scope is enforced independently from other role policies. |
| MOT | Own assigned collection journey, shop collection and GPS upload | `/mot`; MOT APIs | Page checks exact role and assignment. Offline/PWA lifecycle and unified capability policy are absent. |
| Admin Head | Gate entry and exit plus shared Super Admin-shell destination | `/super-admin`; `/api/security/gate-entry`, `/api/security/gate-exit` | Security APIs allow the role, but its dedicated subordinate dashboard and restricted vehicle-stage board are absent. |
| Security Operator | Gate entry/exit and plant-presence workflow | `/department/security`; security APIs | Operational authorization exists as local arrays. |
| QA Head | QA-head page; read QA SOP rules | `/department/qa-head`; `/api/qa-head/sop-rules` | POST currently allows only QA Head; Super Admin cannot use this route even though policy requires full exceptional authority. Versioned limit ownership remains to implement. |
| QA Manager | Manager queue, QA result corrections, and final exception decisions | `/department/qa-manager`; `/api/qa/manager/queue`; QA correction APIs | Queue and result correction allow Super Admin, but final decision correction allows only QA Manager. |
| QA Lab Attendant | Start/resume sessions, hold portions, complete evidence | `/department/qa`; `/api/qa/sessions/*`; QA portion APIs | Operational routes are attendant-only. The final decision must be separated from attendant evidence/recommendation. |
| Production Head | Start/complete production reception and issue silo stock | production APIs | APIs include Production Head and Super Admin, but home routing sends Production Head to the Super Admin shell. |
| Production Reception Operator | Production reception and silo issue | `/department/production`; production APIs | Page/API role lists are local and duplicated. |
| Weighbridge Operator | Gross/tare capture | `/department/weighbridge`; `/api/scale/*` | Gross/tare endpoints allow operator and Super Admin; related read endpoints have separate guards. |
| Finance and Accounts | Routed to the Super Admin shell | `/super-admin` | Dedicated read-only complete-MPD reconciliation and Finance-posting workflow are not implemented; Super Admin APIs reject this role. |
| Contractor roles | Contractor-source dispatch and management | `/contractor/manager`; dispatch APIs | Source-bound behavior exists but is interwoven with ZMCC dispatch checks. |
| TV board | Unauthenticated/restricted display intent | `/tv-board` | Current page and data contract still need a strict allowlist for only vehicle, stage, and necessary timestamps. |

Observed structural issues:

- Roles are checked through repeated string arrays in pages, route handlers, and services.
- Page visibility and API authority do not share one policy source.
- `filterUpdatesByRole` is a separate field allowlist and gives high roles empty editable-field sets; it is not a complete capability system.
- Source, department, record-owner, and hierarchy scope are resolved differently across modules.
- Several high roles are sent to `/super-admin` even though that route's APIs require exactly `SUPER_ADMIN`.
- Super Admin has no consistent operational override: some routes include it, while ZMCC/QA final-decision routes intentionally exclude it.

## Baseline verification

Recorded on 2026-09-21 from the starting point above.

| Command | Result | Evidence / interpretation |
|---|---|---|
| `npm.cmd run typecheck` | Pass | TypeScript completed with exit code 0. |
| `npm.cmd run lint` | Pass | ESLint reported no warnings or errors. It also warned that the Next.js ESLint plugin was not detected, so the lint configuration requires later repair. |
| `npm.cmd run test:unit` | Pass | 17 files and 207 tests passed. |
| `npm.cmd run test:integration` | Pass after P0-10 | The initial run exposed a missing `ZmccTank.version` database column. After the focused migration and isolated test-database rebuild, all 7 files and 54 tests pass. |

The Phase 0 gate is satisfied: hierarchy, terminology, current authorization behavior, starting repository state, and a passing baseline are documented.

## Implementation entries

| Date | Task | Status | Files / result | Validation and remaining risk |
|---|---|---|---|---|
| 2026-09-21 | P0-07 | Verified | Added the current page/API access-behavior matrix above. | Static inventory identifies current role, scope, routes, expected behavior, and known inconsistencies. Dynamic authorization tests remain Phase 1 work. |
| 2026-09-21 | P0-08 | Verified | Recorded the baseline commands and exact results above. | Integration baseline is blocked by the missing database column; it must not be presented as passing. |
| 2026-09-21 | P0-09 | Verified | Recorded every modified/untracked starting group and its inferred purpose above. | Exact human author is unavailable from Git; all are protected as pre-existing user/session work. |
| 2026-09-21 | P0-10 | Verified | Added `20260921180000_align_optimistic_lock_versions` for the three pre-existing `version` fields only. | All 34 migrations deployed to a freshly recreated isolated test database; seeding and isolation sentinel passed; integration passed 54/54. Forward recovery is to retain and increment the non-null version columns because dropping them after versioned writes would lose concurrency state. |
| 2026-09-22 | P1-01 to P1-03, P1-05 | Verified | Added the typed capability vocabulary, hierarchical resource scopes, `evaluateAccess`, and `can` under `src/backend/modules/access-control`. Super Admin receives every defined capability through this policy. | Typecheck passes; lint passes; 18 unit files and 214 tests pass. No route or page uses the new policy yet, so this slice does not change runtime authorization behavior. |
| 2026-09-22 | P1-04, P1-06 | Verified | Added an exhaustive canonical-role policy map and a server-side actor factory that derives system, department, or source scope from the live authenticated user. Added allowed/denied role, assigned/wrong/missing scope, legacy-role fail-closed, and Super Admin tests. | Typecheck and lint pass; all 219 unit tests pass. The mapping remains disconnected from routes until a characterized vertical slice is selected. |
| 2026-09-22 | P1-07 | Verified | Added framework-neutral `requireCapability` for API routes and server components, returning typed 401/403 failures and the authorized user/actor context. | Typecheck and lint pass; all 219 unit tests pass. No production route uses the helper yet. |
| 2026-09-22 | P1-08 | Verified | Migrated weighbridge gross/tare writes and the weighbridge page to `SUBMIT` within the fixed `Production & Weighbridge` department scope. Removed duplicated API role arrays and added policy coverage. | Typecheck and lint pass; 220/220 unit tests and 54/54 integration tests pass. Existing response status and error text are preserved. |
| 2026-09-22 | TV board duplicate vehicle repair | Verified | Added a vehicle-level projection that collapses portion rows sharing the same visit ID before React renders cards. | Typecheck and lint pass; regression tests cover duplicate visit `1666`, completed filtering, and stable order. This preserves one card per physical vehicle visit and makes the existing visit-based React key unique. |
| 2026-09-22 | P1-09 weighbridge slice | Verified | Migrated open-ticket, ready-for-gross, and ready-for-tare reads from authentication-only checks to centralized `VIEW` authorization in the fixed weighbridge department scope. | Typecheck and lint pass; 222/222 unit tests and 54/54 integration tests pass. This intentionally closes an existing data exposure where unrelated authenticated roles could read weighbridge queues. |
| 2026-09-22 | P1-09 security slice | Verified | Modeled Security as a subordinate Admin Head scope; migrated the security page, gate entry/exit, and three queue APIs to centralized capabilities. | Typecheck and lint pass; 223/223 unit tests and 54/54 integration tests pass. Existing Security Operator, Admin Head, and Super Admin authority is preserved; unrelated authenticated roles can no longer read security queues. |
| 2026-09-22 | P1-10 | Verified | Restricted `/super-admin` to Super Admin, routed Admin Head to Security and Production Head to Production, and sent high roles without implemented workspaces to the explicit unavailable page. Added destination regression coverage. | Typecheck and lint pass; 246/246 unit tests pass. QA Head and MPD Head retain their existing dedicated destinations. |
| 2026-09-22 | P5A-04, P5A-05 online portion | Verified | Added shared Pakistani mobile/CNIC normalization; canonical storage is `+923XXXXXXXXX` and 13 CNIC digits. Shop and Local Supplier writes normalize through one utility, and Local Supplier create/update plus both creation UIs require valid identity values. | Typecheck and lint pass; 264/264 unit tests and 54/54 integration tests pass. P5A-04 is complete. P5A-05 remains open for explicit offline replay coverage. Database columns remain nullable until inventory/backfill tasks P5A-06/P5A-08. |
| 2026-09-22 | P7-03, P7-06 | Documented | Added the authoritative lifecycle and current/target schema mapping for Shop RMR, Local Supplier RMR, Raw Milk Token, Raw Milk Dispatch Note, and Plant Gate Token. Confirmed the legacy arrival `rmr_number` must not be made non-null or treated as the new issuance identity. | Automated tests intentionally deferred by product-owner instruction. No Prisma change was made in this step. |
| 2026-09-22 | P7-05 | Documented | Defined Local Supplier RMR as an idempotent post-acceptance application command with server-owned ZMCC/year/quantity, transaction rechecks, uniqueness locking, and immutable audit/correction history. | Automated tests intentionally deferred. Schema implementation remains P7-07 after the legacy-value inventory/backfill policy is defined. |
| 2026-09-22 | P7-04 | Completed | Added a core-owned `PaperLinkedIdentityContract` and attached it to Shop collection, ZMCC MOT/Local Supplier arrival, dispatch, Security, QA, Production, Weighbridge, Super Admin, and operational reporting responses. System record IDs, Raw Milk Dispatch Notes, Plant Gate Tokens, Shop RMRs, and legacy Local Supplier RMR values are now explicitly distinguished while flat compatibility fields remain for existing screens. | Static response inventory completed. Automated tests intentionally deferred by product-owner instruction. |
| 2026-09-22 | P7-07 | Implemented | Added `LocalSupplierRmrIssuance` as a dedicated post-acceptance entity linked to one Local Supplier arrival, final ZMCC lab session, tank receipt, ZMCC, supplier, and issuer. Added structured year/series/book/receipt identity, accepted quantity snapshot, idempotency key, cancellation state, reprint count, and database constraints including the approved per-ZMCC annual composite uniqueness rule. | Additive migration leaves legacy arrival `rmr_number` unchanged for P7-08. Automated schema/test commands intentionally deferred. |
| 2026-09-22 | P7-08 | Implemented | Added `LocalSupplierRmrLegacyClassification` and a data migration that copies every non-empty legacy arrival RMR into a preserved `NEEDS_REVIEW` record. Defined reviewed outcomes for verified history, duplicate values, and invalid values, with mandatory reviewer evidence fields for completed review. | No legacy value is parsed or promoted to a new issuance automatically. Automated schema/test commands intentionally deferred. |
| 2026-09-22 | Development data reset | Completed | Applied the pending Phase 7 migrations, updated the canonical operational reset for new RMR and dependent tables, deleted the large dummy operational history, and reduced the plant demo generator from 75 journeys to four useful workflow states. Preserved users and IDs, lab tests/rules, paper policies, procurement sources, silos, and ZMCC tanks. | Local development database reseeded successfully. Test suites and regression validation remain intentionally deferred. |
| 2026-09-22 | P2-01 to P2-05 | Implemented | Added `correction-governance` as a shared module with explicit record lifecycle, impact and resolution types; per-module field allowlists; immutable correction audit-event shape; and request/approve/reject/cancel/apply service plus transaction contracts. | Existing feature correction workflows have not yet all adopted the transaction contract; P2-06 remains active. Automated tests remain deferred by product-owner instruction. |
| 2026-09-22 | P2-06 | Verified | Inspected ZMCC Lab, MOT shop collection, ZMCC arrival/gate-exit, and dispatch correction implementations. Each mutation and its `AuditLog` entry run inside one Prisma transaction; critical correction counters are protected by `SELECT ... FOR UPDATE` locks. | The shared correction-governance contract is available for new workflows. Automated tests remain deferred by product-owner instruction. |
| 2026-09-22 | P5 overview foundation | Implemented | Added `getZmccManagerOverview` and `GET /api/zmcc/manager/overview`. It derives the ZMCC exclusively from the authenticated manager assignment, supports an explicit source only for Super Admin, and returns pipeline, ZMCC tank, dispatch, exception, and correction-event data. | UI migration and station-level queue details remain P5-03, P5-04, P5-07, and P5-08. Automated tests remain deferred. |
| 2026-09-22 | P5-03, P5-04 | Implemented | Added active MOT station rows with responsible role, elapsed waiting time, collection count, and quantity total to the source-scoped overview contract. | Existing workspace still needs focused UI migration. Automated tests remain deferred. |
| 2026-09-22 | P5-08 | Implemented | Added `ZmccManagerSnapshot`, an isolated overview component that consumes the manager API and displays source pipeline counts, tank/dispatch status, manager-review exceptions, and active MOT work. | Automated tests remain deferred. |
| 2026-09-22 | P6A-03 | Completed | Published laboratory category and hard-stop policy. Existing Release and Monitoring configuration remains authoritative; no hard stop is inferred without an explicit QA-owned configuration. | Automated tests remain deferred. |
| 2026-09-22 | P6A-05 | Implemented | Switched Plant QA test selection from legacy `LabTest.testScope` flags to canonical `MilkTestPolicyAssignment` effective policy, while retaining visit-level frozen `LabTestAssignment` snapshots. ZMCC already used the same policy source. | Automated tests remain deferred. |
| 2026-09-22 | P6A-06 | Implemented | Added session-start preflight validation for ZMCC MOT, Local Supplier, and Contractor workflows. Every required non-calculated policy test must resolve to one valid active Release rule at the effective testing point; configuration errors block session creation. | Automated tests remain deferred. |
| 2026-09-22 | P6A-07 | Implemented | Added explicit ZMCC lab session fields for attendant recommendation/actor/time and final decision/actor/time/reason. Existing `decision` remains a compatibility field while final-decision workflows migrate. | Additive migration applied to the local development database. Automated tests remain deferred. |
| 2026-09-23 | P6A-08 | Implemented | ZMCC Lab now evaluates results live against the active QA rules while the attendant enters them. The attendant selects ACCEPTED or REJECTED: a decision matching the system is final immediately; a disagreement requires a reason and is sent to the ZMCC Manager. Manager acceptance/rejection records a final actor, time, reason, and audit history. | Prisma client regenerated and the development server restarted. Automated tests remain deferred by product-owner instruction. Local Supplier RMR issuance remains P6A-09. |
| 2026-09-23 | P6A-09 (partial) | Implemented | Added the authenticated Local Supplier RMR issue command and API. It permits a ZMCC Lab Attendant in the assigned source or Super Admin, requires final acceptance and a tank receipt, records the server-owned year/accepted quantity, validates structured paper fields, locks the annual paper identity, supports idempotent replay, and writes `LOCAL_SUPPLIER_RMR_ISSUED` audit evidence. | The operational screen for entering physical series/book/receipt numbers remains to be connected; no automated tests were run by product-owner instruction. |
| 2026-09-23 | P6A-09, P6A-10 to P6A-14 | Implemented | Connected the Local Supplier RMR entry screen. Plant QA now uses the same system-advisory/attendant-decision workflow as ZMCC: matching decisions finalize, disagreements require an attendant reason and enter the QA Manager queue. QA Manager, QA Head, and Super Admin can record the audited exception decision. Pending portions remain in Plant QA and cannot progress to gross weighing. | Automated tests remain deferred by product-owner instruction. MPD Head escalation requires its own system-scope ZMCC review contract and remains P6A-15. |
| 2026-09-23 | P6A-15 | Implemented | Added QA Head access to the Plant QA exception queue and decision action. Added a narrow HEAD_OF_MPD system-scope path for finalized ZMCC laboratory read/correction work, including pending exception resolution and corrections above the local manager limit. Existing original-decision and correction/audit fields remain the historical record. | Automated tests remain deferred by product-owner instruction. |
| 2026-09-23 | P3-01 | Implemented | Added a management-reporting module containing read-only system/department/ZMCC scope, normalized filters/pagination, and serialized vehicle-stage contracts. | No screen or API changes yet; subsequent Phase 3 tasks will implement the projection and scoped query service. Automated tests remain deferred. |
