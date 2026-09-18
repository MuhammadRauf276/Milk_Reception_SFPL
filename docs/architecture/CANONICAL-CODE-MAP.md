# Canonical Code Map & Architecture Ownership

**Milk Reception Application (SFPL)**
*Stage 6 Architectural Baseline (Refreshed in Stage 6G-D.4A)*

---

## 1. Top-Level Directory Architecture

Being located under `src/app` does **NOT** mean code is current. Every route, API, service, and UI module must be classified by its architectural ownership.

- `src/app/` — Routing, layouts, and HTTP entry layer (Next.js App Router).
- `src/frontend/` — UI components, workspace views, modals, cards, and frontend state.
- `src/backend/` — Core business logic, services, database interfaces, validation engines, and calculations.
- `src/lib/` — Shared utility libraries (datetime, reception numbering, validations, role routing, key utilities).
- `src/types/` & `src/backend/core/types.ts` — Canonical domain and database types.
- `src/constants/` — Current shared constants.
- `prisma/` — Database schema definitions and migration history.
- `scripts/` — Automated CI regression test suites, stage contract verifications, database seeders, and administrative scripts.
- `docs/` — Architecture Decision Records (ADRs) and living system documentation.

---

## 2. Route Ownership Map

| Route | Classification | Role Owner | Main Component | Current / Legacy Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/login` | **CANONICAL** | All Users | `LoginPage.tsx` | CURRENT | Authenticates users, sets secure cookie, and routes to role home via `resolveRoleHome`. |
| `/` | **CANONICAL GATEWAY** | All Authenticated Users | `src/app/page.tsx` | CURRENT | Pure routing gateway using `resolveRoleHome`. Zero legacy component imports or render fallback. |
| `/workspace-unavailable` | **CANONICAL** | Unready / Unmapped Roles | `.../workspace-unavailable/page.tsx` | CURRENT | Safe fail-closed landing page for future, unready, or retired legacy roles. |
| `/mpd/head` | **CANONICAL** | `HEAD_OF_MPD`, `SUPER_ADMIN` | `MilkTestPolicyWorkspace.tsx` | CURRENT | Head of MPD supervisory and test policy workspace (4 MPD testing points). |
| `/department/mpd` | **CANONICAL** | `ZMCC_LAB_ATTENDANT`, `SUPER_ADMIN` | `MPDDispatchWorkspace.tsx` | CURRENT | ZMCC milk dispatch creation and lab test portion entry. |
| `/department/security` | **CANONICAL** | `SECURITY_OPERATOR`, `SUPER_ADMIN` | `SecurityGatewayWorkspace.tsx` | CURRENT | Plant gate entry, token issuance, and gate exit. |
| `/department/qa` | **CANONICAL** | `QA_LAB_ATTENDANT`, `SUPER_ADMIN` | `QALaboratoryWorkspace.tsx` | CURRENT | QA session management and portion lab result entry (Plant QA only). |
| `/department/weighbridge` | **CANONICAL** | `WEIGHBRIDGE_OPERATOR`, `SUPER_ADMIN` | `WeighbridgeWorkspace.tsx` | CURRENT | First weight (gross) and second weight (tare) scale recording. |
| `/department/production` | **CANONICAL** | `PRODUCTION_RECEPTION_OPERATOR`, `SUPER_ADMIN` | `ProductionUnloadingWorkspace.tsx`| CURRENT | Silo allocation, unloading, and silo issue management. |
| `/mpd/zmcc-manager` | **CANONICAL** | `ZMCC_MANAGER`, `SUPER_ADMIN` | `ZMCCManagerWorkspace.tsx` | CURRENT | Source-scoped supervisory workspace with five top-level areas: Overview, Live Operations, Reconciliation, History & Reports, and Master Data. Arrival and Lab correction workflows are nested under History rather than exposed as operator-level top tabs. |
| `/contractor/manager` | **CANONICAL** | `CONTRACTOR_MANAGER`, `SUPER_ADMIN` | `PlantContractorManagerWorkspace.tsx` | CURRENT | Direct-to-plant contractor, source-scoped read-only supervision. |
| `/super-admin` | **CANONICAL** | `SUPER_ADMIN` | `src/app/super-admin/page.tsx` | CURRENT | Operations dashboard and live KPI overview. |
| `/super-admin/users` | **CANONICAL** | `SUPER_ADMIN` | `src/app/super-admin/users/page.tsx` | CURRENT | User creation, role assignment, activation, password reset. |
| `/super-admin/procurement-sources` | **CANONICAL** | `SUPER_ADMIN` | `.../procurement-sources/page.tsx` | CURRENT | Source master data, testing mode, and baseline configuration. |
| `/super-admin/silos` | **CANONICAL** | `SUPER_ADMIN` | `.../silos/page.tsx` | CURRENT | Silo storage tanks, capacity, and active status master data. |
| `/super-admin/lab-tests` | **CANONICAL** | `SUPER_ADMIN` | `.../lab-tests/page.tsx` | CURRENT | Configurable lab tests, result options, units, and scopes. |
| `/super-admin/test-policies` | **CANONICAL** | `SUPER_ADMIN` | `.../test-policies/page.tsx` | CURRENT | Global milk test policy assignments across all 5 testing points. |
| `/super-admin/sop-rules` | **CANONICAL** | `SUPER_ADMIN` | `.../sop-rules/page.tsx` | CURRENT | Quality SOP rules, min/max limits, and auto-acceptance criteria. |
| `/super-admin/qa-warnings` | **CANONICAL** | `SUPER_ADMIN` | `.../qa-warnings/page.tsx` | CURRENT | Borderline warning audit and threshold tracking. |
| `/super-admin/operations` | **CANONICAL** | `SUPER_ADMIN` | `.../operations/page.tsx` | CURRENT | Vehicle visit journey oversight and administrative inspection. |
| `/super-admin/audit` | **CANONICAL** | `SUPER_ADMIN` | `.../audit/page.tsx` | CURRENT | System data audit log explorer. |
| `/super-admin/master-data` | **CANONICAL** | `SUPER_ADMIN` | `.../master-data/page.tsx` | CURRENT | Directory navigation hub linking to sources, silos, tests. |
| `/super-admin/settings` | **CANONICAL** | `SUPER_ADMIN` | `.../settings/page.tsx` | CURRENT | Security, session, and infrastructure status display. |
| `/weighbridge` | **COMPATIBILITY** | `WEIGHBRIDGE_OPERATOR` | `WeighbridgeWorkspace.tsx` | COMPATIBILITY | Redirects to `/department/weighbridge` (which renders `WeighbridgeWorkspace`). |
| `/admin/lab-tests` | **COMPATIBILITY** | None | `src/app/admin/lab-tests/page.tsx` | COMPATIBILITY | Client-side compatibility redirect to `/super-admin/lab-tests`. |
| `/fleet-tracking` | **RETIRED (4E-E)** | None | N/A | RETIRED | Unowned legacy monitoring board retired in Stage 4E-E. |
| `/tv-board` | **BUSINESS DECISION**| Plant Displays | `src/app/tv-board/page.tsx` | BUSINESS DECISION | Read-only wall-board screen for factory reception lanes. |

---

## 3. Root Route & Role-Home Policy (`src/lib/role-routing.ts`)

> [!NOTE]
> **CANONICAL ROUTING GATEWAY (STAGE 6G-A CORRECTION #2)**
> `src/app/page.tsx` is a pure routing gateway. It inspects `currentUser.role` and executes a server-side redirect via `resolveRoleHome(role)`.
> **NO DEFAULT BUSINESS WORKSPACE FALLBACK**: Unknown, unmapped, future, and retired legacy roles fail closed to `/workspace-unavailable`.

### Role Home Ownership Matrix

| Role | Classification | Destination | Notes |
| :--- | :--- | :--- | :--- |
| `SUPER_ADMIN` | **CANONICAL** | `/super-admin` | Super Admin Master Portal |
| `HEAD_OF_MPD` | **CANONICAL** | `/mpd/head` | Head of MPD Milk Test Policy & Management Workspace |
| `ZMCC_MANAGER` | **CANONICAL** | `/mpd/zmcc-manager` | ZMCC Source Manager Workspace |
| `CONTRACTOR_MANAGER` | **CANONICAL** | `/contractor/manager` | Plant Contractor Manager Workspace (Direct-to-Plant) |
| `ZMCC_LAB_ATTENDANT` | **CANONICAL** | `/zmcc/lab` | ZMCC Lab Arrival & Dispatch Testing Workspace (also operational on `/department/mpd` for ZMCC dispatch) |
| `CONTRACTOR_OPERATOR` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Operational Contractor Dispatch Person (Wasim Sahib; routes to `/workspace-unavailable` until dedicated workspace is built) |
| `PHE_OPERATOR` | **CANONICAL** | `/phe` | ZMCC PHE Operator Station |
| `MOT` | **CANONICAL** | `/mot` | Mobile Operator Team Station |
| `SECURITY_OPERATOR` | **CANONICAL** | `/department/security` | Gate Security Station |
| `QA_LAB_ATTENDANT` | **CANONICAL** | `/department/qa` | Plant QA Laboratory Testing Station |
| `WEIGHBRIDGE_OPERATOR` | **CANONICAL** | `/department/weighbridge` | Weighbridge Scale Station |
| `PRODUCTION_RECEPTION_OPERATOR` | **CANONICAL** | `/department/production` | Plant Production Silo Unloading Station |
| `QA_MANAGER` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | QA Department Managerial Oversight |
| `QA_HEAD` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Head of QA Department |
| `ADMIN_HEAD` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Head of Admin / Security |
| `PRODUCTION_HEAD` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Head of Production Department |
| `EXECUTIVE_MANAGEMENT` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Senior Executive Management Overview |
| `DATA_EXECUTIVE` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Data Executive Reporting |
| `FINANCE_ACCOUNTS` | **CANONICAL (UNREADY WORKSPACE)** | `/workspace-unavailable` | Finance and Accounts Ledger Oversight |
| *Retired Legacy Roles* | **RETIRED / ZERO AUTHORITY** | `/workspace-unavailable` | `Admin`, `MPD`, `MPD_Operator`, `MPD_Zone_Manager`, `QA`, `QA_Operator`, `Security_Weight`, `Security_Manager`, `Weighbridge_Operator`, `Production`, `Production_Operator`, `Production_Manager`, `General_Plant_Manager`, `Correction_Officer`, `Management` |
| *Any Unknown Role* | **FAIL CLOSED** | `/workspace-unavailable` | Rejects unauthorized access |

---

## 4. API Ownership Map

### Canonical APIs (Current Production)
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` — Production session authentication, logout, and token inspection.
- `/api/dispatches`, `/api/dispatches/start` — Canonical field milk dispatch creation and portion initialization. Enforces whole-vehicle dispatch quantity as an authoritative measured fact (`basis = 'MEASURED'`). GET `/api/dispatches` date filtering strictly filters by `DispatchInfo.dispatch_timestamp` in Pakistan calendar date (`Asia/Karachi`), not `created_at` or `operational_date`. Serialized responses expose `dispatch_date` and `dispatch_timestamp`; `operational_date` strictly remains null until Plant Gate Exit.
- `/api/security/*` — Gate entry, active visits, ready-for-exit, gate exit.
- `/api/qa/*` — Session management (queues, start, resume), portion QA completion, hold, visit search.
- `/api/scale/*` — Ready-for-gross, gross-weight, ready-for-tare, tare-weight, open-tickets.
- `/api/production/*` — Unloading queue, start unloading, complete unloading, ready-for-unloading, silo-issue, silo-issue history.
- `GET /api/logs` — Canonical source-scoped bounded operational read-model endpoint. Supports live, recent, search, and report retrieval modes with server-side pagination/filtering (strictly validates YYYY-MM-DD calendar dates and rejects malformed fromDate/toDate with HTTP 400). Date query bounds use ordinary Pakistan calendar dates for dispatch/reporting retrieval. Plant Business Date remains a separate authoritative gate-exit-derived field and is not the upstream query-date rule.
- `/api/lab-tests` — Public active lab test definitions for dispatch and plant forms.
- `/api/super-admin/*` — Full administration endpoints (users, sources, silos, lab-tests, sop-rules, qa-warnings, operations, audit, overview).

### Dev-Only APIs
- `/api/auth/dev-profiles` — **DEV-ONLY**: Double-gated development profile switch endpoint (strictly blocked in production mode; never to be treated as a production authentication surface).

### Deprecated / Compatibility / Mutation Tombstones
- `POST /api/logs`, `PATCH /api/logs`, `PATCH /api/logs/[id]` — **DEPRECATED / MUTATION TOMBSTONES**: Deprecated operational log mutation surfaces. They do NOT represent current canonical manager read architecture.
- `/api/admin/lab-tests`, `/api/admin/lab-tests/[id]` — **RETIRED IN 4E-F**: Duplicate legacy Admin endpoints physically removed; canonical administration is unified at `/api/super-admin/lab-tests`.
- `/api/logs/[id]/audit` — **RETIRED IN 4E-E**: Fake generic revert mutation and ownerless per-log audit endpoint removed. Canonical audit evidence remains immutable and read-only via `/api/super-admin/audit` and `/super-admin/audit`.

---

## 5. Current Canonical Module Map

| Business Area | Main Route | Main UI Component | Main API Group | Main Service / Helper | Important Authority Contract |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | `/login` | `LoginPage.tsx` | `/api/auth/*` | `auth.ts`, `jwt-secret.ts`, `role-routing.ts` | Secure JWT cookie, strict role matching |
| **Business Date** | Core Helper | N/A | Embedded in APIs | `business-day.ts`, `datetime-utils.ts` | 08:00 PKT boundary, Asia/Karachi display |
| **MPD Dispatch** | `/department/mpd` | `MPDDispatchWorkspace.tsx` | `/api/dispatches*` | `dispatchQuantityService.ts`, `quantityPolicyService.ts`, `validations/dispatch.ts` | Authoritative measured whole-vehicle dispatch issue (`basis = 'MEASURED'`), independent composite portions (MEASURED or ESTIMATED), comparison-only reconciliation (anti-derivation: Vehicle Issue = Sum(Portions) forbidden), and PKT calendar dispatch date semantics (`operational_date = null` until plant gate exit). |
| **Security** | `/department/security` | `SecurityGatewayWorkspace.tsx` | `/api/security/*` | `securityGatewayService.ts`, `reception-number.ts` | Token issuance, chronological gate milestones |
| **QA Lab** | `/department/qa` | `QALaboratoryWorkspace.tsx` | `/api/qa/*` | `qaSessionService.ts`, `sopRuleEngine.ts` | Session lock, portion-level decisions, LT-000008 / LT-000026 |
| **Weighbridge** | `/department/weighbridge` | `WeighbridgeWorkspace.tsx` | `/api/scale/*` | `weighbridgeScaleService.ts`, `vehicleQuantityService.ts` | First weight (gross), second weight (tare), net milk weight |
| **Production** | `/department/production`| `ProductionUnloadingWorkspace.tsx` | `/api/production/*` | `productionUnloadingService.ts`, `siloInventoryService.ts`| Silo provisional allocation, physical liters receipt |
| **Final Receipt** | Read Model | `operationalReadModelService.ts` | `GET /api/logs` | `operationalReadModelService.ts` | `final_receipt_exists` backed by `SiloInventoryTransaction` `RECEIPT` |
| **Read Model** | Read Model | `operationalReadModelService.ts` | `GET /api/logs` | `operationalReadModelService.ts` | Bounded canonical operational read model; modes: `live`, `recent`, `search`, `report`. Default `pageSize: 20`, max `100`. Recent history defaults to 7 calendar days. Server-side DB pagination/filtering before Node mapping. No client-side total loads. |
| **ZMCC Manager** | `/mpd/zmcc-manager` | `ZMCCManagerWorkspace.tsx` | `GET /api/logs` | `zmccManagerHelpers.ts`, `zmccManagerTypes.ts` | Assigned-ZMCC supervisory workspace. Five top-level areas: Overview, Live Operations, Reconciliation, History & Reports, and Master Data. Live data may poll; reporting/reconciliation/history remain bounded and paginated. Local manager KPIs use authoritative server aggregates/ledger-backed values where available. ZMCC Manager may perform only the already-authorized manager corrections and master-data actions exposed by canonical ZMCC modules. |
| **Plant Contractor Manager** | `/contractor/manager` | `PlantContractorManagerWorkspace.tsx` | `GET /api/logs` | `contractorManagerHelpers.ts`, `contractorManagerTypes.ts` | Direct-to-plant contractor, source-scoped read-only supervision, 5 tabs (Overview, Live Pipeline, Quality & Rejections, Receipts & Reconciliation, History & Reports). Active tab retrieval (no giant shared array). Live tab polls; historical tabs do NOT poll. Strict CONTRACTOR procurement source isolation. |
| **PHE & ZMCC Arrivals** | `/phe` | `ZmccArrivalsWorkspace.tsx` | `/api/zmcc/arrivals/*` | `zmccArrivalService.ts`, `zmccArrivalAuth.ts` | Direct-to-ZMCC intake. Active intake: MOT and Local Supplier. Gate entry timestamp = physical arrival. Inside vehicles bounded query (`/api/zmcc/arrivals/inside`). Gate exit recorded with row locking and retry idempotency. |
| **Local Supplier Directory** | `/phe` | `ZmccArrivalsWorkspace.tsx` | `/api/zmcc/local-suppliers/*` | `zmccLocalSupplierService.ts` | Canonical ZMCC Local Supplier master (`ZmccLocalSupplier`). Scoped by assigned ZMCC. Fast-creation by PHE, management by ZMCC Manager / Super Admin. Atomic sequence `ZLS-000001`. Distinct from Plant Contractor. |
| **Legacy ZMCC Contractor Arrival** | N/A | N/A | `/api/zmcc/arrivals/contractor` | `zmccArrivalService.ts` | **HISTORICAL COMPATIBILITY ONLY**: Retired for new intake (`POST` returns 410 Gone). Existing records remain readable, searchable, and auditable for completed lab/tank flows. |
| **MOT Operations & Summary** | `/mot` | `MotOperationsWorkspace.tsx` | `/api/mot/*` | `motService.ts`, `motJourneySummaryService.ts` | Canonical `MotJourneySummary`, gross-liters weighted aggregation, 1-to-1 immutable lifecycle, route assignments, offline collection sync. Gate exit unblocks vehicle reuse. |
| **ZMCC Lab Testing & Receipt** | `/zmcc/lab` | `ZmccLabWorkspace.tsx` | `/api/zmcc/lab/*` | `zmccLabService.ts` | Reusable lab workflow across MOT, Local Supplier, and legacy Contractor. Required tests, supervisor corrections, and Accept & Receive into sole active ZMCC tank. Paginated server-side history with date/decision/search filters. |
| **ZMCC Tank & Ledger** | `/zmcc/lab` | Embedded in Lab | `/api/zmcc/tanks/*` | `zmccTankService.ts` | Exactly one active tank per ZMCC facility (`zmcc_tank_one_active_per_zmcc_idx`). Gross Liters physical inventory basis. Immutable transaction ledger (`ZmccTankInventoryTransaction`). |
| **Super Admin Operations** | `/super-admin/operations` | `.../operations/page.tsx` | `/api/super-admin/operations` | Prisma Client direct queries | Paginated administrative vehicle visit inspection (default 20, max 100, server-side search, truthful pagination metadata, no silent 50-row cutoff). |
| **Super Admin Audit** | `/super-admin/audit` | `.../audit/page.tsx` | `/api/super-admin/audit` | Prisma Client direct queries | Read-only audit log explorer with server-side pagination (default 20, max 100, filter by table/action/search, no silent 100-row cutoff). Strictly read-only. |
| **Super Admin Master Data** | `/super-admin` | `src/app/super-admin/page.tsx` | `/api/super-admin/*` | Prisma Client direct queries | Master data management (users, procurement sources, silos, lab tests, test policies, SOP rules, QA warnings). |

---

## 6. Legacy Modules (DO NOT USE IN NEW DEVELOPMENT)

The following modules represent older architectural iterations. They remain in the codebase until formally retired, but **NEW OR CURRENT CODE MUST NOT IMPORT THEM**:

- `src/backend/services/operationalCalculations.ts` — Retained only for legacy validation scripts, which import it directly.

---

## 7. Future Roles (Not Yet Ready)

The following roles exist in domain type definitions but do not yet have completed canonical frontend workspaces:

- `EXECUTIVE_MANAGEMENT` —
  - Landing destination: `/workspace-unavailable`. Dedicated multi-plant executive overview not yet implemented.
- `MPD_Zone_Manager` (Multi-Source Zonal Concept) — Legacy role; fails closed to `/workspace-unavailable`. Future MPD Manager workspace will supersede it.

> [!IMPORTANT]
> Do not expose a future role as if its application is complete. Do not route future roles into unrelated operator pages or legacy Kanban as a permanent solution.

---

## 8. Stage 4E-C Retired Dead Code

The following modules were proven dead (zero active runtime consumers, not route-owned, and unreferenced across canonical workflows) and were safely retired in Stage 4E-C:

- `src/frontend/modules/forms/DynamicQALabForm.tsx` — **DELETED**: Superseded by canonical `QALaboratoryWorkspace.tsx`; zero runtime consumers.
- `src/frontend/modules/shared/StageTimeline.tsx` — **DELETED**: Superseded by `ManagerLifecycleTracker.tsx`; zero runtime consumers.
- `src/backend/controllers/auditController.ts` — **DELETED**: Obsolete standalone controller with zero consumers across repo.
- `src/lib/validations/production.ts` — **DELETED**: Superseded by route/service level validations; zero consumers across repo.

### Retained Candidate Notes
- `src/backend/actions/logActions.ts` — **RETAINED**: Currently referenced by test script `scripts/test_date_filters_and_decisions.ts`. Preserved to avoid test regression until script retirement.

---

## 9. Stage 4E-D Retired Legacy Management Subsystem

The legacy Kanban management application and standalone cross-verification routes have been retired:

- `src/app/management/dashboard/page.tsx` — **DELETED**: Retired legacy management dashboard route.
- `src/app/cross-verification/page.tsx` — **DELETED**: Retired standalone cross-verification route.
- `src/frontend/modules/dashboard/KanbanBoard.tsx` — **DELETED**: Retired 5-stage legacy Kanban component.
- `src/frontend/modules/dashboard/CrossVerification.tsx` — **DELETED**: Retired standalone cross-verification component.
- `src/frontend/modules/dashboard/ZonalHistoryTable.tsx` — **DELETED**: Retired legacy zonal table.
- `src/frontend/modules/cards/AdaptiveVehicleCard.tsx` — **DELETED**: Retired legacy vehicle card.

- The Legacy Kanban management application is no longer an active application surface.
- Current ZMCC Manager Reconciliation is NOT the retired standalone `/cross-verification` route; it is an independent, source-scoped component (`src/frontend/modules/dashboard/zmcc/ZMCCManagerReconciliation.tsx`).
- Legacy roles (`MPD_Zone_Manager`, `Management`, `General_Plant_Manager`, `QA_Manager`, `Production_Manager`, `Correction_Officer`) fail closed to `/workspace-unavailable`.
- Canonical `SecurityManager.tsx` has zero dependency on legacy `LogDetailModal.tsx`.
- Canonical `operationalReadModelService.ts` has zero dependency on or re-exports of `operationalCalculations.ts`.
- `operationalCalculations.ts` is retained only for legacy validation scripts, which import it directly.

---

## 10. Stage 4E-E Retired Fleet Tracking & Generic Revert Subsystem

The unowned legacy fleet tracking page and misleading generic audit-revert mechanism have been retired:

- `src/app/fleet-tracking/page.tsx` — **DELETED**: Unowned legacy monitoring board with zero active role owners.
- `src/frontend/modules/dashboard/LogDetailModal.tsx` — **DELETED**: Legacy modal with zero remaining runtime consumers.
- `src/frontend/modules/shared/AuditRevertModal.tsx` — **DELETED**: Legacy modal with zero remaining runtime consumers.
- `src/app/api/logs/[id]/audit/route.ts` — **DELETED**: Fake revert mutation endpoint and unowned per-log audit endpoint removed.
- `revertLogField` and `getAuditLogsForLog` in `src/backend/core/db.ts` — **DELETED**: Unused/fake revert helpers removed.
- Canonical system audit evidence remains strictly read-only and immutable through Super Admin Audit (`/super-admin/audit` and `/api/super-admin/audit`).
- `Correction_Officer` role definition remains in domain types (routing safely fails closed to `/workspace-unavailable`).

---

## 11. Stage 4E-F Duplicate API / Super Admin Consolidation

The duplicate legacy Admin Lab Tests API has been consolidated into the canonical Super Admin API:

- `src/app/api/admin/lab-tests/route.ts` — **DELETED**: Duplicate legacy API with outdated authorization and missing audit logging.
- `src/app/api/admin/lab-tests/[id]/route.ts` — **DELETED**: Duplicate legacy API with outdated authorization and missing audit logging.
- `src/app/api/admin` directory — **REMOVED**: Directory tree cleaned after endpoint removal.
- Canonical Lab Test Master Data management is unified at `/api/super-admin/lab-tests` and `/api/super-admin/lab-tests/[id]`.
- Operational field test definitions remain served by `/api/lab-tests`.
- `/admin/lab-tests` (`src/app/admin/lab-tests/page.tsx`) is preserved strictly as a **COMPATIBILITY** redirect to `/super-admin/lab-tests`.
- Sidebar navigation for `isMainAdmin` points directly to canonical `/super-admin/lab-tests`.

---

## 12. Stage 4E-G1 Repository-Wide Cleanup & Proven Leftover Removal

Tracked repository leftovers with zero runtime consumers have been removed:

- `next.config.mjs` — **DELETED**: Redundant duplicate of `next.config.js`.
- `src/backend/core/durations.ts` — **DELETED**: Unused duration calculation helpers operating on old schema.
- `src/frontend/modules/dashboard/SecurityWorkforceTable.tsx` — **DELETED**: Ownerless component superseded by SecurityManager milestone ledger.
- `src/frontend/modules/shared/IsometricIcon.tsx` — **DELETED**: Ownerless component from retired StageTimeline.
- `src/lib/key-utils.ts` — **DELETED**: Unused key helper.
- `scratch/*` tracked files — **DELETED**: Tracked scratch investigative scripts removed.
- `docs/architecture/ADR-DRAFT-dispatch-quantity-measurement.md` — **DELETED**: Non-authoritative draft superseded by ADR-001.
- `src/backend/services/operationalCalculations.ts` — **DELETED (4E-G2)**: Zero runtime and test consumers; permanently retired.

---

## 13. Stage 4E-G2 Script & Test Consolidation + Legacy Calculation Retirement

- `src/backend/services/operationalCalculations.ts` — **DELETED**: Retired calculation module with zero runtime consumers. Canonical read-model and vehicle quantity authorities (`operationalReadModelService.ts`, `vehicleQuantityService.ts`, `milkFormulas.ts`) remain canonical.
- Obsolete one-off debug scripts, old completed migration files, and superseded temporary test scripts have been removed.
- Stage 4E transitional test contracts are permanently consolidated into `scripts/test_canonical_architecture.ts`.
- Master regression runner (`scripts/run_all_regressions.ts`) includes `scripts/test_date_filters_and_decisions.ts` for strict calendar date validation and HTTP filtering regressions.

---

## 14. Stage 6G-A Milk Test Policy & Head of MPD Subsystem

- `src/backend/services/milkTestPolicyService.ts`: Authoritative service owning testing point definitions, role mutation authority boundaries, policy reads, creations, and updates with immutable audit logging.
- `src/app/api/milk-test-policies/route.ts`: Canonical API route for listing (all or effective tests) and creating policy assignments.
- `src/app/api/milk-test-policies/[id]/route.ts`: Canonical API route for updating assignment status, display order, and requirement.
- `src/frontend/modules/mpd/policy/MilkTestPolicyWorkspace.tsx`: Reusable role-aware workspace for Head of MPD (4 MPD testing points) and Super Admin (all 5 testing points).
- `src/app/mpd/head/page.tsx`: Dedicated workspace page for Head of MPD (`/mpd/head`).
- `src/app/super-admin/test-policies/page.tsx`: Dedicated Super Admin test policy administration page (`/super-admin/test-policies`).
- `prisma/migrations/20260912120000_milk_test_policy_assignment/migration.sql`: Tracked migration establishing `milk_test_policy_assignment` table with check constraint, unique index, and foreign keys.

---

## 15. Authoritative Organization Role Hierarchy (Stage 6G-A Correction #2)

### 1. Hierarchy Tree
```
SUPER_ADMIN
|
+-- EXECUTIVE_MANAGEMENT (Senior Executive Management)
|
+-- DATA_EXECUTIVE (Data Executive)
|
+-- HEAD_OF_MPD (MPD Head)
|    |
|    +-- ZMCC_MANAGER (ZMCC Manager)
|    |     |
|    |     +-- PHE_OPERATOR (PHE Operator)
|    |     +-- ZMCC_LAB_ATTENDANT (ZMCC Lab Attendant)
|    |     +-- MOT (MOT)
|    |
|    +-- CONTRACTOR_MANAGER (Contractor Manager)
|          |
|          +-- CONTRACTOR_OPERATOR (Contractor Operator - e.g., Wasim Sahib)
|
+-- ADMIN_HEAD (Admin Head)
|    |
|    +-- SECURITY_OPERATOR (Security Operator)
|
+-- QA_HEAD (QA Head)
|    |
|    +-- QA_MANAGER (QA Manager)
|          |
|          +-- QA_LAB_ATTENDANT (QA Lab Attendant)
|
+-- PRODUCTION_HEAD (Production Head)
|    |
|    +-- WEIGHBRIDGE_OPERATOR (Weighbridge Operator)
|    +-- PRODUCTION_RECEPTION_OPERATOR (Production Reception Operator)
|
+-- FINANCE_ACCOUNTS (Finance and Accounts)
```

### 2. Core Authority & Assignment Principles
- **Head of MPD (`HEAD_OF_MPD`)**: Global Milk Procurement authority (SYSTEM scope, no procurement source). Owns test policy mutation for the 4 MPD testing points (`MOT_SHOP`, `ZMCC_LAB_MOT`, `ZMCC_LAB_CONTRACTOR`, `DISPATCH`).
- **ZMCC Manager (`ZMCC_MANAGER`)**: Reports to MPD Head. Source-scoped to an assigned ZMCC (`requiresSource: true, allowedSourceType: ZMCC`).
- **Contractor Manager (`CONTRACTOR_MANAGER`)**: Reports to MPD Head. Source-scoped to an assigned Contractor (`requiresSource: true, allowedSourceType: CONTRACTOR`).
- **ZMCC Lab Attendant (`ZMCC_LAB_ATTENDANT`)**: Single operational laboratory role at ZMCC. Performs MOT vehicle arrival testing, Contractor vehicle arrival testing, and ZMCC dispatch testing. Completely replaces old `MPD_Operator` with zero parallel operational roles. Source-scoped to an assigned ZMCC (`requiresSource: true, allowedSourceType: ZMCC`). Effective test policy: `ZMCC_LAB_MOT`, `ZMCC_LAB_CONTRACTOR`, `DISPATCH`.
- **Contractor Operator (`CONTRACTOR_OPERATOR`)**: Operational dispatch preparation and testing person at Contractor source. Source-scoped to assigned Contractor (`requiresSource: true, allowedSourceType: CONTRACTOR`). Effective test policy: `DISPATCH` only. Cannot access ZMCC or other Contractor sources.
- **Contractor Operator Fixture**: `Wasim Sahib` (`contractor.operator.alkhair`), role `CONTRACTOR_OPERATOR`, source `CONT-ALKHAIR`, reporting under `contractor.manager.alkhair`.
- **QA Lab Attendant (`QA_LAB_ATTENDANT`)**: Single operational plant laboratory role performing Plant QA testing. Reports to `QA_MANAGER` under `QA_HEAD`. Effective test policy: `PLANT_QA` only. Cannot mutate test policies or access ZMCC/MOT/Contractor testing.
- **Retired Legacy Roles**: `Admin`, `MPD`, `MPD_Operator`, `MPD_Zone_Manager`, `QA`, `QA_Operator`, `Security_Weight`, `Security_Manager`, `Weighbridge_Operator`, `Production`, `Production_Operator`, `Production_Manager`, `General_Plant_Manager`, `Correction_Officer`, `Management`. All retired roles have **ZERO LIVE AUTHORITY** and fail closed to `/workspace-unavailable` and HTTP 403 on protected APIs.
- **Historical Attribution & Database Upgrade**: Deterministic in-place role migration updates active users to canonical equivalents where unambiguous (`MPD_Operator` -> `ZMCC_LAB_ATTENDANT` or `CONTRACTOR_OPERATOR`, `QA_Operator`/`QA` -> `QA_LAB_ATTENDANT`, etc.) while deactivating ambiguous legacy users safely. Historical `AuditLog` actor records and foreign keys are never deleted or modified.

---

## 16. Stage 6G-B MOT Journey Final Summary Architecture

- `src/backend/services/motJourneySummaryService.ts`: Authoritative service owning the immutable `MotJourneySummary` entity, gross-liters weighted calculations, initial summary generation in ZMCC arrival completion transactions, late offline sync recomputation, and canonical serialization.
- `prisma/migrations/20260912180000_mot_journey_summary/migration.sql`: Tracked migration creating `mot_journey_summary` table with 1-to-1 foreign key and unique index on `journey_id`, check constraint enforcing `revision >= 1`, non-negative liter checks, and quality metric boundaries.
- `src/backend/services/zmccArrivalService.ts`: Acquires exclusive PostgreSQL row lock on `mot_journey` row (`SELECT id FROM mot_journey WHERE id = ${journeyId} FOR UPDATE`), creates initial summary inside arrival completion transaction via `createInitialMotJourneySummaryTx`, and serves `journey.summary` via `listMotArrivals` and `getMotArrivalById` (`/api/zmcc/arrivals/mot`).
- `src/backend/services/motService.ts`: Acquires exclusive row lock on `mot_journey` row, validates journey lifecycle under lock, recomputes summary inside offline delayed collection submission transaction via `recomputeMotJourneySummaryTx` when `ended_at` exists, and includes `summary` in `getMotJourneyById` and `serializeJourney` (`/api/zmcc/mot/*`).
- `src/frontend/modules/mot/MotOperationsWorkspace.tsx`: Displays compact summary card in Journey Detail modal showing total gross liters, total @13TS liters, gross-weighted quality averages, stop breakdown, and revision badge.
- `src/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace.tsx`: Displays compact summary card in ZMCC arrival success banner.

---

## 17. Stage 6G-C ZMCC Final Milk Metrics Architecture

- `src/backend/utils/milkTestResolvers.ts`: Core test parameter resolver owning `isLrTestCandidate`, `isFatTestCandidate`, and `resolveCoreMilkTestResults`. Resolves exactly 1 LR and 1 Fat candidate with fail-closed semantics (rejects 0 or >1 candidates, excludes ratio tests).
- `src/backend/utils/milkFormulas.ts`: Canonical calculation owner for `computeCanonicalMilkMetrics(quantityValue, quantityUnit, lr, fat)`:
  - `LITER` -> `gross_liters = quantity_value`.
  - `KG` -> `density = 1 + lr / 1000`, `gross_liters = quantity_value / density`.
  - `snf = lr / 4 + 0.22 * fat + 0.72`, `ts = fat + snf`, `at_13ts_liters = gross_liters * ts / 13`.
- `prisma/migrations/20260912210000_zmcc_final_milk_metrics/migration.sql`: Tracked migration (migration count: 21) adding `quantity_value`, `quantity_unit`, `density`, `gross_liters`, `snf`, `ts`, `at_13ts_liters`, and `calculation_version` to `zmcc_lab_session` with CHECK constraints.
- `src/backend/services/zmccLabService.ts`: Authoritative service owning ZMCC laboratory session lifecycle:
  - Validates `quantity_value` and `quantity_unit` (native `QuantityUnit` enum).
  - Resolves core LR & Fat tests fail-closed and calculates canonical derived metrics.
  - Rejects client attempts to pass manually calculated metrics.
  - Atomic manager/superadmin corrections recomputing metrics in transaction.
  - Exposes upstream `mot_arrival.journey.summary` as read-only reference without auto-copying.
- `src/frontend/modules/zmcc/lab/ZmccLabWorkspace.tsx`: User interface for active testing, manager corrections, and historical records:
  - Live client-side preview for canonical milk metrics.
  - Upstream MOT Journey Summary read-only reference panel.
  - Correction modal with quantity/unit inputs and live preview.
  - History table with Received Qty, Gross Liters, @13% TS Liters, and "Not captured under this version" for legacy rows.

---

## 18. Stage 6G-D ZMCC Tank Receipt & Immutable Ledger Architecture

- `src/backend/services/zmccTankService.ts`: Authoritative service owning ZMCC Tank Master operations, dynamic physical stock aggregation (`getTankPhysicalStock`), role authorization (canonical signed session via `getCurrentUser(req)`, zero trust for `x-user-id` header), and controlled historical receipt creation (`receiveHistoricalSession` restricted to `ZMCC_LAB_ATTENDANT` and `SUPER_ADMIN`, failing closed if LR/Fat or Stage 6G-C metrics are incomplete, copying stored snapshot verbatim without fake quality fallbacks).
- `src/app/api/zmcc/tanks/route.ts`: API endpoint for listing and creating ZMCC tanks (`GET`, `POST`).
- `src/app/api/zmcc/tanks/[id]/route.ts`: API endpoint for fetching and updating ZMCC tanks (`GET`, `PATCH`).
- `src/app/api/zmcc/lab/sessions/[id]/receive/route.ts`: API endpoint for receiving pre-6G-D historical accepted sessions into tanks (`POST`).
- `prisma/migrations/20260913120000_zmcc_tank_receipt_and_ledger/migration.sql`: Tracked migration (migration count: 22) establishing `zmcc_tank`, `zmcc_tank_receipt`, and `zmcc_tank_inventory_transaction` tables, `ZmccTankTransactionType` enum, CHECK constraints, and indexes.
- `src/backend/services/zmccLabService.ts`: Updated `completeSession` with atomic "Accept & Receive" logic, row-locking destination tanks `FOR UPDATE` and revalidating `is_active` under lock; updated `correctCompletedSession` with decision safety guards (`ACCEPTED -> REJECTED` after receipt and `REJECTED -> ACCEPTED` forbidden) and `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` ledger entries.
- `src/frontend/modules/zmcc/ZmccMasterDataWorkspace.tsx`: Management tab for ZMCC Tanks (`TANKS`), supporting Super Admin CRUD and ZMCC Manager read-only visibility with live stock indicators.
- `src/frontend/modules/zmcc/lab/ZmccLabWorkspace.tsx`: Updated session completion modal to "Accept & Receive" with active tank selection and capacity validation, History table Tank Receipt column, and historical receive action restricted to `ZMCC_LAB_ATTENDANT` and `SUPER_ADMIN` (hidden from `ZMCC_MANAGER`).
