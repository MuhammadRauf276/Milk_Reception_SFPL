# Canonical Code Map & Architecture Ownership

**Milk Reception Application (SFPL)**  
*Stage 4E Architectural Baseline*

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
| `/mpd/zmcc-manager` | **CANONICAL** | `ZMCC_MANAGER`, `SUPER_ADMIN` | `ZMCCManagerWorkspace.tsx` | CURRENT | Source-scoped supervisory workspace (Overview, Live, Cross-Verif, Quality, Receipts, History). |
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
- `/api/dispatches`, `/api/dispatches/start` — MPD dispatch creation and portion initialization.
- `/api/security/*` — Gate entry, active visits, ready-for-exit, gate exit.
- `/api/qa/*` — Session management (queues, start, resume), portion QA completion, hold, visit search.
- `/api/scale/*` — Ready-for-gross, gross-weight, ready-for-tare, tare-weight, open-tickets.
- `/api/production/*` — Unloading queue, start unloading, complete unloading, ready-for-unloading, silo-issue, silo-issue history.
- `GET /api/logs` — Canonical source-scoped operational read-model endpoint (Business Date filtered; strictly validates YYYY-MM-DD calendar dates and rejects malformed fromDate/toDate with HTTP 400).
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
| **MPD Dispatch** | `/department/mpd` | `MPDDispatchWorkspace.tsx` | `/api/dispatches*` | `dispatchService.ts`, `validations/dispatch.ts` | ZMCC declared quantities, dispatch test results |
| **Security** | `/department/security` | `SecurityGatewayWorkspace.tsx` | `/api/security/*` | `securityGatewayService.ts`, `reception-number.ts` | Token issuance, chronological gate milestones |
| **QA Lab** | `/department/qa` | `QALaboratoryWorkspace.tsx` | `/api/qa/*` | `qaSessionService.ts`, `sopRuleEngine.ts` | Session lock, portion-level decisions, LT-000008 / LT-000026 |
| **Weighbridge** | `/department/weighbridge` | `WeighbridgeWorkspace.tsx` | `/api/scale/*` | `weighbridgeScaleService.ts`, `vehicleQuantityService.ts` | First weight (gross), second weight (tare), net milk weight |
| **Production** | `/department/production`| `ProductionUnloadingWorkspace.tsx` | `/api/production/*` | `productionUnloadingService.ts`, `siloInventoryService.ts`| Silo provisional allocation, physical liters receipt |
| **Final Receipt** | Read Model | `operationalReadModelService.ts` | `GET /api/logs` | `operationalReadModelService.ts` | `final_receipt_exists` backed by `SiloInventoryTransaction` `RECEIPT` |
| **Read Model** | Read Model | `operationalReadModelService.ts` | `GET /api/logs` | `operationalReadModelService.ts` | `authoritative_final_liters`, source-scoped filtering |
| **ZMCC Manager** | `/mpd/zmcc-manager` | `ZMCCManagerWorkspace.tsx` | `GET /api/logs` | `zmccManagerHelpers.ts`, `zmccManagerTypes.ts` | Assigned source isolation, read-only supervision, 6 tabs |
| **Plant Contractor Manager** | `/contractor/manager` | `PlantContractorManagerWorkspace.tsx` | `GET /api/logs` | `contractorManagerHelpers.ts`, `contractorManagerTypes.ts` | Direct-to-plant contractor, source-scoped read-only supervision, 5 tabs (Overview, Live Pipeline, Quality & Rejections, Receipts & Reconciliation, History & Reports). Assigned strictly to one CONTRACTOR procurement source. Unassigned or misbound non-CONTRACTOR sources FAIL CLOSED (0 records). Reporting Business Date: Final Receipt Business Date (from `final_receipt_timestamp` via canonical 08:00 PKT) for finalized receipts; Visit/Dispatch Date for non-final/pending; `created_at` is NEVER a Business Date fallback. |
| **Super Admin** | `/super-admin` | `src/app/super-admin/page.tsx` | `/api/super-admin/*` | Prisma Client direct queries | Master data management, SOP rules, user administration |

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
- Current ZMCC Cross Verification is NOT the retired standalone `/cross-verification` route; it is an independent, source-scoped component (`ZMCCManagerCrossVerification.tsx`).
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
