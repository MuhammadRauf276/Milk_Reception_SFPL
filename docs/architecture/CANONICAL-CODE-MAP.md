# Canonical Code Map & Architecture Ownership

**Milk Reception Application (SFPL)**  
*Stage 4E Architectural Baseline*

---

## 1. Top-Level Directory Architecture

Being located under `src/app` does **NOT** mean code is current. Every route, API, service, and UI module must be classified by its architectural ownership.

- `src/app/` — Routing, layouts, and HTTP entry layer (Next.js App Router).
- `src/frontend/` — UI components, workspace views, modals, cards, and frontend state.
- `src/backend/` — Core business logic, services, database interfaces, validation engines, and calculations.
- `src/lib/` — Shared utility libraries (datetime, reception numbering, validations, key utilities).
- `src/types/` & `src/backend/core/types.ts` — Canonical domain and database types.
- `src/constants/` — Current shared constants.
- `prisma/` — Database schema definitions and migration history.
- `scripts/` — Automated CI regression test suites, stage contract verifications, database seeders, and administrative scripts.
- `docs/` — Architecture Decision Records (ADRs) and living system documentation.

---

## 2. Route Ownership Map

| Route | Classification | Role Owner | Main Component | Current / Legacy Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/login` | **CANONICAL** | All Users | `LoginPage.tsx` | CURRENT | Authenticates users and issues secure session token. |
| `/` | **LEGACY FALLBACK** | Unmapped Roles | `src/app/page.tsx` -> `KanbanBoard.tsx` | LEGACY (4E-B TARGET) | Unmatched roles fall back to legacy Kanban. **MUST BE REMOVED IN 4E-B**. |
| `/department/mpd` | **CANONICAL** | `MPD_Operator`, `MPD` | `MPDDispatchWorkspace.tsx` | CURRENT | ZMCC milk dispatch creation and portion entry. |
| `/department/security` | **CANONICAL** | `Security_Operator`, `Security_Weight` | `SecurityGatewayWorkspace.tsx` | CURRENT | Plant gate entry, token issuance, and gate exit. |
| `/department/security-manager`| **CANONICAL** | `Security_Manager` | `SecurityManager.tsx` | CURRENT | Security supervisory and gate exit audit. |
| `/department/qa` | **CANONICAL** | `QA_Operator`, `QA`, `Lab_Chemist` | `QALaboratoryWorkspace.tsx` | CURRENT | QA session management and portion lab result entry. |
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
| `/weighbridge` | **COMPATIBILITY** | `WEIGHBRIDGE_OPERATOR` | `WeighbridgeWorkspace.tsx` | COMPATIBILITY | Alias route rendering WeighbridgeWorkspace. |
| `/admin/lab-tests` | **COMPATIBILITY** | `Admin` | `src/app/admin/lab-tests/page.tsx` | LEGACY (4E-B TARGET) | Redirects to `/super-admin/lab-tests`. |
| `/management/dashboard` | **LEGACY ACTIVE** | `Management`, `Admin` | `KanbanBoard.tsx` | LEGACY ACTIVE | Legacy multi-lane Kanban board with outdated calculations. |
| `/cross-verification` | **LEGACY ACTIVE** | `Management`, `Admin` | `CrossVerification.tsx` | LEGACY ACTIVE | Standalone multi-zone cross verification view. |
| `/fleet-tracking` | **LEGACY ACTIVE** | `Management`, `Admin` | `src/app/fleet-tracking/page.tsx` | LEGACY ACTIVE | Legacy fleet tracking view with audit revert controls. |
| `/tv-board` | **BUSINESS DECISION**| Plant Displays | `src/app/tv-board/page.tsx` | BUSINESS DECISION | Read-only wall-board screen for factory reception lanes. |

---

## 3. Root Route Warning (`src/app/page.tsx`)

> [!WARNING]
> **LEGACY FALLBACK — MUST BE REMOVED IN 4E-B**  
> `src/app/page.tsx` currently inspects `currentUser.role` and redirects operational roles to `/department/*` or `/mpd/zmcc-manager`. Any unmapped or legacy role currently falls through and renders `<KanbanBoard />`. In Stage 4E-B, this fallback must be replaced with explicit authorized redirection or a clean 403 / unmapped role boundary.

---

## 4. API Ownership Map

### Canonical APIs (Current Production)
- `/api/auth/*` — Session login, logout, me, and dev-profiles.
- `/api/dispatches`, `/api/dispatches/start` — MPD dispatch creation.
- `/api/security/*` — Gate entry, active visits, ready-for-exit, gate exit.
- `/api/qa/*` — Session management (queues, start, resume), portion QA completion, hold, visit search.
- `/api/scale/*` — Ready-for-gross, gross-weight, ready-for-tare, tare-weight, open-tickets.
- `/api/production/*` — Unloading queue, start unloading, complete unloading, ready-for-unloading, silo-issue, silo-issue history.
- `/api/logs`, `/api/logs/[id]` — Source-scoped operational read-model logs.
- `/api/lab-tests` — Public active lab test definitions for dispatch and plant forms.
- `/api/super-admin/*` — Full administration endpoints (users, sources, silos, lab-tests, sop-rules, qa-warnings, operations, audit, overview).

### Legacy / Duplicate APIs
- `/api/admin/lab-tests`, `/api/admin/lab-tests/[id]` — **DUPLICATE / LEGACY**: Superseded by `/api/super-admin/lab-tests`.
- `/api/logs/[id]/audit` (POST) — **BUSINESS DECISION / FAKE REVERT**: Inserts audit log without actual table mutation.

---

## 5. Current Canonical Module Map

| Business Area | Main Route | Main UI Component | Main API Group | Main Service / Helper | Important Authority Contract |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | `/login` | `LoginPage.tsx` | `/api/auth/*` | `auth.ts`, `jwt-secret.ts` | Secure JWT cookie, strict role matching |
| **Business Date** | Core Helper | N/A | Embedded in APIs | `business-day.ts`, `datetime-utils.ts` | 08:00 PKT boundary, Asia/Karachi display |
| **MPD Dispatch** | `/department/mpd` | `MPDDispatchWorkspace.tsx` | `/api/dispatches*` | `dispatchService.ts`, `validations/dispatch.ts` | ZMCC declared quantities, dispatch test results |
| **Security** | `/department/security` | `SecurityGatewayWorkspace.tsx` | `/api/security/*` | `securityGatewayService.ts`, `reception-number.ts` | Token issuance, chronological gate milestones |
| **QA Lab** | `/department/qa` | `QALaboratoryWorkspace.tsx` | `/api/qa/*` | `qaSessionService.ts`, `sopRuleEngine.ts` | Session lock, portion-level decisions, LT-000008 / LT-000026 |
| **Weighbridge** | `/department/weighbridge` | `WeighbridgeWorkspace.tsx` | `/api/scale/*` | `weighbridgeScaleService.ts`, `vehicleQuantityService.ts` | First weight (gross), second weight (tare), net milk weight |
| **Production** | `/department/production`| `ProductionUnloadingWorkspace.tsx` | `/api/production/*` | `productionUnloadingService.ts`, `siloInventoryService.ts`| Silo provisional allocation, physical liters receipt |
| **Final Receipt** | Read Model | `operationalReadModelService.ts` | `/api/logs` | `operationalReadModelService.ts` | `final_receipt_exists` backed by `SiloInventoryTransaction` `RECEIPT` |
| **Read Model** | Read Model | `operationalReadModelService.ts` | `/api/logs` | `operationalReadModelService.ts` | `authoritative_final_liters`, source-scoped filtering |
| **ZMCC Manager** | `/mpd/zmcc-manager` | `ZMCCManagerWorkspace.tsx` | `/api/logs` | `zmccManagerHelpers.ts`, `zmccManagerTypes.ts` | Assigned source isolation, read-only supervision, 6 tabs |
| **Super Admin** | `/super-admin` | `src/app/super-admin/page.tsx` | `/api/super-admin/*` | Prisma Client direct queries | Master data management, SOP rules, user administration |

---

## 6. Legacy Modules (DO NOT USE IN NEW DEVELOPMENT)

The following modules represent older architectural iterations. They remain in the codebase until formally retired in subsequent Stage 4E cleanup chunks, but **NEW OR CURRENT CODE MUST NOT IMPORT THEM**:

- `src/frontend/modules/dashboard/KanbanBoard.tsx`
- `src/frontend/modules/dashboard/CrossVerification.tsx`
- `src/frontend/modules/dashboard/ZonalHistoryTable.tsx`
- `src/frontend/modules/dashboard/LogDetailModal.tsx`
- `src/frontend/modules/cards/AdaptiveVehicleCard.tsx`
- `src/backend/services/operationalCalculations.ts`
- `src/app/management/dashboard/page.tsx`
- `src/app/cross-verification/page.tsx`
- `src/app/fleet-tracking/page.tsx`
- `src/frontend/modules/shared/AuditRevertModal.tsx`

---

## 7. Future Roles (Not Yet Ready)

The following roles exist in domain type definitions but do not yet have completed canonical frontend workspaces:

- `CONTRACTOR_MANAGER` — Backend security fails closed (`procurement_source_id: -1`). Dedicated contractor workspace will be built in Stage 4F.
- `EXECUTIVE_MANAGEMENT` — Dedicated multi-plant executive overview not yet implemented.
- `MPD_Zone_Manager` (Multi-Source Zonal Concept) — Legacy role; future MPD Manager workspace will supersede it.

> [!IMPORTANT]
> Do not expose a future role as if its application is complete. Do not route future roles into unrelated operator pages or legacy Kanban as a permanent solution.
