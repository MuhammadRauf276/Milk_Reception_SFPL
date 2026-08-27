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
| `/workspace-unavailable` | **CANONICAL** | Unready / Unmapped Roles | `.../workspace-unavailable/page.tsx` | CURRENT | Safe fail-closed landing page for future or unrecognized roles. |
| `/department/mpd` | **CANONICAL** | `MPD_Operator`, `MPD` | `MPDDispatchWorkspace.tsx` | CURRENT | ZMCC milk dispatch creation and portion entry. |
| `/department/security` | **CANONICAL** | `Security_Operator`, `Security_Weight` | `SecurityGatewayWorkspace.tsx` | CURRENT | Plant gate entry, token issuance, and gate exit. |
| `/department/security-manager`| **CANONICAL** | `Security_Manager` | `SecurityManager.tsx` | CURRENT | Security supervisory and gate exit audit. |
| `/department/qa` | **CANONICAL** | `QA_Operator`, `QA` | `QALaboratoryWorkspace.tsx` | CURRENT | QA session management and portion lab result entry. |
| `/department/weighbridge` | **CANONICAL** | `WEIGHBRIDGE_OPERATOR` | `WeighbridgeWorkspace.tsx` | CURRENT | First weight (gross) and second weight (tare) scale recording. |
| `/department/production` | **CANONICAL** | `Production_Operator`, `Production` | `ProductionUnloadingWorkspace.tsx`| CURRENT | Silo allocation, unloading, and silo issue management. |
| `/mpd/zmcc-manager` | **CANONICAL** | `ZMCC_MANAGER` | `ZMCCManagerWorkspace.tsx` | CURRENT | Source-scoped supervisory workspace (Overview, Live, Cross-Verif, Quality, Receipts, History). |
| `/super-admin` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `src/app/super-admin/page.tsx` | CURRENT | Operations dashboard and live KPI overview. |
| `/super-admin/users` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `src/app/super-admin/users/page.tsx` | CURRENT | User creation, role assignment, activation, password reset. |
| `/super-admin/procurement-sources` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../procurement-sources/page.tsx` | CURRENT | Source master data, testing mode, and baseline configuration. |
| `/super-admin/silos` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../silos/page.tsx` | CURRENT | Silo storage tanks, capacity, and active status master data. |
| `/super-admin/lab-tests` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../lab-tests/page.tsx` | CURRENT | Configurable lab tests, result options, units, and scopes. |
| `/super-admin/sop-rules` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../sop-rules/page.tsx` | CURRENT | Quality SOP rules, min/max limits, and auto-acceptance criteria. |
| `/super-admin/qa-warnings` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../qa-warnings/page.tsx` | CURRENT | Borderline warning audit and threshold tracking. |
| `/super-admin/operations` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../operations/page.tsx` | CURRENT | Vehicle visit journey oversight and administrative inspection. |
| `/super-admin/audit` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../audit/page.tsx` | CURRENT | System data audit log explorer. |
| `/super-admin/master-data` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../master-data/page.tsx` | CURRENT | Directory navigation hub linking to sources, silos, tests. |
| `/super-admin/settings` | **CANONICAL** | `SUPER_ADMIN`, `Admin` | `.../settings/page.tsx` | CURRENT | Security, session, and infrastructure status display. |
| `/weighbridge` | **COMPATIBILITY** | `WEIGHBRIDGE_OPERATOR` | `WeighbridgeWorkspace.tsx` | COMPATIBILITY | Redirects to `/department/weighbridge` (which renders `WeighbridgeWorkspace`). |
| `/admin/lab-tests` | **COMPATIBILITY** | `Admin` | `src/app/admin/lab-tests/page.tsx` | LEGACY (4E-B TARGET) | Redirects to `/super-admin/lab-tests`. |
| `/fleet-tracking` | **LEGACY ACTIVE** | `Management`, `Admin` | `src/app/fleet-tracking/page.tsx` | LEGACY ACTIVE | Legacy fleet tracking view with audit revert controls. |
| `/tv-board` | **BUSINESS DECISION**| Plant Displays | `src/app/tv-board/page.tsx` | BUSINESS DECISION | Read-only wall-board screen for factory reception lanes. |

---

## 3. Root Route & Role-Home Policy (`src/lib/role-routing.ts`)

> [!NOTE]
> **CANONICAL ROUTING GATEWAY (STAGE 4E-B / 4E-D)**
> `src/app/page.tsx` is a pure routing gateway. It inspects `currentUser.role` and executes a server-side redirect via `resolveRoleHome(role)`.
> **NO DEFAULT BUSINESS WORKSPACE FALLBACK**: Unknown, unmapped, future, and retired legacy roles fail closed to `/workspace-unavailable`.

### Role Home Ownership Matrix

| Role / Alias | Classification | Destination | Notes |
| :--- | :--- | :--- | :--- |
| `SUPER_ADMIN` | **CURRENT** | `/super-admin` | Super Admin Master Portal |
| `Admin` | **CURRENT (Alias)** | `/super-admin` | Administrator Alias |
| `ZMCC_MANAGER` | **CURRENT** | `/mpd/zmcc-manager` | ZMCC Source Manager Workspace |
| `MPD_Operator` | **CURRENT** | `/department/mpd` | MPD Field Station |
| `MPD` | **CURRENT (Alias)** | `/department/mpd` | MPD Operator Alias |
| `Security_Operator` | **CURRENT** | `/department/security` | Gate Security Station |
| `Security_Weight` | **CURRENT (Alias)** | `/department/security` | Gate Security Alias |
| `Security_Manager` | **CURRENT** | `/department/security-manager` | Security Supervisor Console |
| `QA_Operator` | **CURRENT** | `/department/qa` | QA Laboratory Testing |
| `QA` | **CURRENT (Alias)** | `/department/qa` | QA Chemist Alias |
| `WEIGHBRIDGE_OPERATOR` | **CURRENT** | `/department/weighbridge` | Weighbridge Scale Station |
| `Weighbridge_Operator` | **CURRENT (Alias)** | `/department/weighbridge` | Weighbridge Operator Alias |
| `Production_Operator` | **CURRENT** | `/department/production` | Silo Unloading Station |
| `Production` | **CURRENT (Alias)** | `/department/production` | Production Operator Alias |
| `MPD_Zone_Manager` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy Zonal Dashboard Retired |
| `Management` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy Management Dashboard Retired |
| `General_Plant_Manager` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy Plant Dashboard Retired |
| `QA_Manager` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy QA Dashboard Retired |
| `Production_Manager` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy Production Dashboard Retired |
| `Correction_Officer` | **RETIRED (4E-D)** | `/workspace-unavailable` | Legacy Correction Dashboard Retired |
| `CONTRACTOR_MANAGER` | **FUTURE NOT READY** | `/workspace-unavailable` | Fails closed until Stage 4F |
| `EXECUTIVE_MANAGEMENT` | **FUTURE NOT READY** | `/workspace-unavailable` | Fails closed until implemented |
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
- `/api/admin/lab-tests`, `/api/admin/lab-tests/[id]` — **DUPLICATE / LEGACY**: Superseded by `/api/super-admin/lab-tests`.
- `/api/logs/[id]/audit` (POST) — **BUSINESS DECISION / FAKE REVERT**: Inserts audit log without actual table mutation.

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
| **Super Admin** | `/super-admin` | `src/app/super-admin/page.tsx` | `/api/super-admin/*` | Prisma Client direct queries | Master data management, SOP rules, user administration |

---

## 6. Legacy Modules (DO NOT USE IN NEW DEVELOPMENT)

The following modules represent older architectural iterations. They remain in the codebase until formally retired in subsequent Stage 4E cleanup chunks, but **NEW OR CURRENT CODE MUST NOT IMPORT THEM**:

- `src/app/fleet-tracking/page.tsx`
- `src/frontend/modules/shared/AuditRevertModal.tsx`
- `src/frontend/modules/dashboard/LogDetailModal.tsx`
- `src/backend/services/operationalCalculations.ts`

---

## 7. Future Roles (Not Yet Ready)

The following roles exist in domain type definitions but do not yet have completed canonical frontend workspaces:

- `CONTRACTOR_MANAGER` —
  - **Assigned `CONTRACTOR_MANAGER`**: Scoped strictly to the procurement source assigned in the current DB user record (`procurement_source_id`).
  - **Unassigned `CONTRACTOR_MANAGER`**: Fails closed using the existing no-source behavior / `-1` scope.
  - Landing destination: `/workspace-unavailable`. Dedicated contractor workspace will be built in Stage 4F.
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
- `LogDetailModal.tsx` is retained only for the legacy `/fleet-tracking` surface pending Stage 4E-E.
- `operationalCalculations.ts` is retained only for legacy validation scripts, which import it directly.
