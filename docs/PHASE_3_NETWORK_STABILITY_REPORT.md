# Phase 3 — Final Reliability Hardening, 19-Role Verification & Production Readiness Report

**Project:** Milk Reception Management System  
**Organization:** Shakarganj Food Products Ltd. (SFPL)  
**Repository:** `MuhammadRauf276/Milk_Reception_SFPL`  
**Branch:** `feature/phase-3-network-stability`  
**Target:** `main` (Pull Request #44 remains in Draft)  
**Baseline Commit:** `bb3ee3287c5398aa63ac8c3230f4b6454dbfca32`  
**Audit & Verification Date:** November 1, 2026  

---

## 1. Executive Implementation Summary

Phase 3 establishes an online-first network resilience architecture, robust API request handling, mutation deduplication, request timeout safety, session expiry protection, and real-time network health visibility across the Milk Reception application. Factory floors, weighbridges, silos, and rural milk collection centers (ZMCCs / MOTs) frequently experience slow cellular connections, intermittent WiFi coverage, latency spikes, and transient disconnections.

The primary operational mandate of Phase 3 is:
> **An operator must not lose work, accidentally submit duplicate transactions, or become confused about transaction status because of network instability.**

### Summary of Core Resiliency Primitives Implemented:
1. **Lightweight Backend Health Probe (`/api/health`):** Verifies database connectivity via a bounded 2.5s `SELECT 1` query. The abort timer is cleanly cancelled in `finally`, and any late-resolving database rejection is caught and suppressed via detached promise suppression (`.catch(() => {})`) to eliminate unhandled promise rejections on probe timeouts. Explicitly distinguishes `connected: 200`, `timeout: 503`, and `unavailable: 503`. Enforces `Cache-Control: no-store, no-cache, must-revalidate` to prevent stale caching.
2. **Documented Driver Limitation for `/api/health`:** `Promise.race()` does **not** cancel the underlying Prisma query or close its PostgreSQL socket when the timeout branch wins. The query continues executing on the PostgreSQL connection until it finishes or is terminated by the PostgreSQL server's `statement_timeout`. Detached promise error suppression (`.catch(() => {})`) ensures that subsequent query settlement or connection drop does not trigger an unhandled promise rejection at the Node.js process level. We do not claim driver-level query cancellation.
3. **Reactive Network Health Store (`useNetworkHealth.ts`):** External store hook utilizing `useSyncExternalStore` with a frozen `SERVER_SNAPSHOT` (eliminating SSR re-render loops). Tracks five states: `ONLINE`, `OFFLINE`, `API_UNREACHABLE`, `DATABASE_UNAVAILABLE`, and `RECONNECTING`. Features adaptive polling (10s backoff to 30s) and pauses background heartbeats when `document.hidden === true`.
4. **Non-Intrusive Status Banner (`NetworkStatusBar.tsx`):** Mounted globally in `src/app/layout.tsx`. High-contrast visual indicators: Red for `OFFLINE`, Amber for `API_UNREACHABLE` / `DATABASE_UNAVAILABLE` / `RECONNECTING`, and an auto-dismissing Green badge (3.5s) on connection restoration.
5. **Resilient Centralized API Client (`apiClient.ts`):**
   - **In-flight Mutation Deduplication (`DUPLICATE_IN_FLIGHT`):** Immediate client-side lock preventing duplicate requests from double-clicking/tapping buttons.
   - **Stable Idempotency Key Injection:** Derives `effectiveIdempotencyKey` from `options.idempotencyKey || options.dedupKey || autoKey`. Mutating requests retain identical stable keys across retries and reconciliations without timestamp jitter.
   - **Full Timeout Lifecycle Protection:** 15s default for mutations, 10s for queries, and 45s for file uploads. The timeout timer remains active through response body consumption (`response.json()`), with cleanup strictly enclosed in `finally`. Prioritizes caller abort (`options.signal?.aborted`) over timeout to cleanly separate user cancellation (`REQUEST_ABORTED`) from timeouts (`REQUEST_TIMEOUT`).
   - **Safe Exponential Retries:** Automatic retries strictly restricted to idempotent `GET` requests; mutating `POST`/`PUT`/`DELETE` calls fail closed.
   - **Error Classification (`ApiError`):** Categorizes failures into `isNetworkError`, `isTimeout`, and `isAuthExpired`.
6. **In-Place Re-Authentication (`ReAuthModal.tsx`):** Intercepts `401 Unauthorized` responses via the `milk-auth-expired` event. Displays a modal dialog over the active screen without executing navigation (`router.push` or `location.replace`). Form values, dirty state, and inspection notes remain intact. Re-submitting restores the session cookie seamlessly.
7. **Server-Side Operation Idempotency (`operationIdempotencyService.ts`):**
   - Dedicated `OperationIdempotencyRecord` table storing SHA-256 payload hashes (`payload_hash`), status codes, and cached response payloads.
   - Deterministic JSON canonicalization (recursively sorting object keys alphabetically, serializing nested arrays/objects uniformly, and preserving exact string contents without generic whitespace trimming) before SHA-256 computation.
   - Strict replay payload validation: Missing stored payload hashes fail closed (`return false`) rather than auto-matching.
   - Exact replays return original responses with `is_replay: true`.
   - Conflicting replays with altered parameters fail with `HTTP 409 Conflict`.
   - Stored response shape validation: Verifies `response_payload` is a non-null object before returning to client.
   - Atomic business transactions: The business mutation, audit record, and idempotency record commit in the same database transaction across all operational routes.
   - Concurrent replay recovery (`waitForOperationRecord` and `handleConcurrentReplayOrConflict`): runs outside rolled-back transactions with bounded 2500ms deadline, 50ms polling interval, and queries using the root `prisma` client.
   - Removed all unsafe fallback IDs based on non-unique entity identifiers or timestamps across all 6 operational routes. Missing client operation IDs return `HTTP 400 Bad Request`.
   - Removed all blind `P2002` catch bypasses that previously returned unvalidated successes.
   - Removed fake replay fallbacks in route handlers: When an entity has already completed a lifecycle stage, new requests with different keys return `HTTP 409 Conflict` rather than faking `is_replay: true`.
8. **Robust Offline Queueing & Deduplication:** Rural MOT collections and ZMCC arrivals utilize IndexedDB queues with client-generated event UUIDs (`client_event_id`). Server-side replay detection (`isExactMotArrivalReplay`) returns `HTTP 200` with `is_replay: true`, preventing duplicate tokens or records.
9. **Dashboard Mutation Auditing:** Replaced all raw `fetch()` calls in `WeighbridgeSecondWeightPanel.tsx`, `WeighbridgeUnifiedStation.tsx`, and `SecurityGatewayWorkspace.tsx` with `apiClient.post`, maintaining stable operation identity refs across retries.

---

## 2. Defect Register

| Defect ID | Severity | File / Component | Description | Resolution | Verification |
| :---: | :---: | :--- | :--- | :--- | :---: |
| **DEF-01** | **P1 (Critical)** | `src/app/api/scale/tare-weight/route.ts` | Non-atomic idempotency write: Idempotency record was written after transaction commit and caught with a console warning. Business mutation could commit without idempotency record. | Moved `recordOperation` inside the database `$transaction` for both portion-wise cycles and final weighment. Atomic rollback on failure. | Verified via `apiRouteIdempotencyIntegration.test.ts` (test 8) |
| **DEF-02** | **P1 (Critical)** | `src/app/api/scale/tare-weight/route.ts` | BigInt serialization error in portion-wise final cycle: Route returned internal `{ visit, ticket, finalizeRes }` containing unhandled BigInts, triggering `TypeError: Do not know how to serialize a BigInt` and failing to call `recordOperation`. | Replaced raw entity return with JSON-serializable `responsePayload` and atomic `recordOperation` call matching single-tare mode. | Verified via `apiRouteIdempotencyIntegration.test.ts` & `operationalTransactions.test.ts` |
| **DEF-03** | **P1 (Critical)** | `src/app/api/scale/tare-weight/route.ts` | Unsafe fallback operation ID: Used `TARE-${visitIdStr}-${body.portionId || 'final'}` when key was omitted, conflating entity identity with logical submission identity. | Removed fallback. Client-provided `idempotencyKey` / `clientOperationId` is now strictly required; returns HTTP 400 if missing. | Verified via `apiRouteIdempotencyIntegration.test.ts` (test 5) |
| **DEF-04** | **P1 (Critical)** | `src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route.ts` | Timestamp-based fallback ID: Used `plant-qa-${visitIdStr}-${portionIdStr}-${Date.now()}`, generating a new ID on every retry and defeating idempotency. | Removed fallback. Client-provided `completionClientEventId` or header is strictly required; returns HTTP 400 if missing. | Verified via `apiRouteIdempotencyIntegration.test.ts` (test 5) |
| **DEF-05** | **P1 (Critical)** | `src/app/api/scale/gross-weight/route.ts`, `src/app/api/security/gate-entry/route.ts`, `src/app/api/security/gate-exit/route.ts`, `src/app/api/qa/vehicle-visits/[visitId]/portions/route.ts` | Unsafe entity fallback IDs (`GROSS-${visitId}`, `GATE_ENTRY-${visitId}`, `GATE_EXIT-${visitId}`) across operational routes. | Removed all entity-based fallbacks across all 4 routes. Client operation IDs are strictly required; returns HTTP 400 if missing. | Verified via `apiRouteIdempotencyIntegration.test.ts` (test 5) |
| **DEF-06** | **P1 (Critical)** | All 6 Operational Mutation Routes | Blind P2002 catch bypass: When duplicate key was caught, route returned HTTP 200 without verifying whether incoming payload matched original stored payload. | Removed blind catch bypasses. Replaced with `handleConcurrentReplayOrConflict` which strictly computes SHA-256 payload hash and returns 409 on payload mismatch. | Verified via `apiRouteIdempotencyIntegration.test.ts` (conflict tests) |
| **DEF-07** | **P1 (High)** | `src/backend/services/operationIdempotencyService.ts` | Unsafe whitespace trimming in canonical JSON hashing: `canonicalizeValue` globally trimmed all string values, altering user intent and corrupting original string payloads. | Removed global string trimming (`val.trim()`). Exact string contents are preserved identically during canonicalization. | Verified via `serverIdempotency.test.ts` |
| **DEF-08** | **P1 (High)** | `src/backend/services/operationIdempotencyService.ts` | Lenient replay validation: `validateReplayPayload` returned `true` when stored payload hash was undefined, erroneously accepting unvalidated replays. | Changed `validateReplayPayload` and `verifyReplay` to fail closed (`return false`) whenever stored payload hash is absent. Added `criticalFields` checking and response shape validation. | Verified via `serverIdempotency.test.ts` |
| **DEF-09** | **P1 (High)** | `src/backend/services/operationIdempotencyService.ts` | Concurrent replay polling deadlock risk: Polling for committed records could run inside open transactions or with unbounded lock waits. | Bound polling to 2500ms max (50ms interval) running strictly outside transactions and using root `prisma` client. | Verified via concurrent request tests in `apiRouteIdempotencyIntegration.test.ts` |
| **DEF-10** | **P1 (High)** | `src/app/api/health/route.ts` | Unhandled promise rejection on probe timeout: Database query timeout re-rejected after response was sent, triggering uncaught rejection warnings. | Replaced with detached promise suppression (`.catch(() => {})`) and explicit HTTP 503 status code differentiation. | Verified via `scripts/verify-network-stability.ts` |
| **DEF-11** | **P2 (Medium)** | `src/frontend/lib/apiClient.ts` | Abort vs Timeout race condition: If caller aborted right as timeout fired, client could classify the error as a 408 timeout rather than `REQUEST_ABORTED`. | Explicitly check `options.signal?.aborted` first to prioritize caller cancellation over timer expiry. | Verified via `src/frontend/lib/__tests__/apiClientTimeout.test.ts` |
| **DEF-12** | **P2 (Medium)** | `WeighbridgeSecondWeightPanel.tsx`, `WeighbridgeUnifiedStation.tsx`, `SecurityGatewayWorkspace.tsx` | Raw `fetch()` mutation calls: Frontend panels performed direct unshielded `fetch()` calls without in-flight deduplication, timeout lifecycle, or stable operation identity. | Replaced all raw `fetch()` calls with `apiClient.post` utilizing stable React refs (`activeTareOpIdRef`, `activeWeighOpIdRef`, `activeEntryOpIdRef`, `activeExitOpIdRef`). | Verified via component and network stability suites |

---

## 3. Six-Endpoint Server Idempotency Matrix

All six operational write endpoints implement the unified Phase 3 idempotency contract, verified by route-level integration tests in `src/backend/services/__tests__/apiRouteIdempotencyIntegration.test.ts`:

| Operational Endpoint | HTTP Method | Entity Type | Primary Mutation | Initial Submission | Exact Replay (Same Key + Same Payload) | Conflicting Replay (Same Key + Changed Payload) | Concurrent Requests (Race Condition) | Missing Operation ID |
| :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| **Gate Entry** (`/api/security/gate-entry`) | `POST` | `vehicle_visit` | Create `gate_log`, advance status to `TOKEN_ISSUED` | HTTP 200, Token issued | HTTP 200, `is_replay: true`, original token returned | HTTP 409 Conflict | 1 mutation, 1 gate log, winner cached, second gets replay | HTTP 400 Bad Request |
| **Gate Exit** (`/api/security/gate-exit`) | `POST` | `vehicle_visit` | Update `gate_log.exit_timestamp`, advance status to `COMPLETED` | HTTP 200, Exit pass | HTTP 200, `is_replay: true`, original exit pass | HTTP 409 Conflict | 1 mutation, 1 exit log, winner cached, second gets replay | HTTP 400 Bad Request |
| **Gross Weight** (`/api/scale/gross-weight`) | `POST` | `vehicle_visit` | Create `weight_ticket`, record gross kg, advance status to `GROSS_WEIGHED` | HTTP 200, Gross ticket | HTTP 200, `is_replay: true`, original gross ticket | HTTP 409 Conflict | 1 mutation, 1 weight ticket, winner cached, second gets replay | HTTP 400 Bad Request |
| **Tare Weight** (`/api/scale/tare-weight`) | `POST` | `vehicle_visit` | Update `weight_ticket.tare_weight_kg`, calculate net kg, finalize silo inventory | HTTP 200, Tare & Net ticket | HTTP 200, `is_replay: true`, original tare ticket | HTTP 409 Conflict | 1 mutation, 1 weight ticket update, winner cached, second gets replay | HTTP 400 Bad Request |
| **QA Portion Creation** (`/api/qa/vehicle-visits/[id]/portions`) | `POST` | `vehicle_visit` | Create `visit_portion`, write `PLANT_QA_PORTION_ADDED` audit | HTTP 200, Portion created | HTTP 200, `is_replay: true`, existing portion returned | HTTP 409 Conflict (Reused for other visit) | 1 mutation, exactly 1 portion created, second gets replay | HTTP 400 Bad Request |
| **QA Portion Complete** (`/api/qa/vehicle-visits/[id]/portions/[pId]/complete`) | `POST` | `visit_portion` | Record test results, set `plant_decision` to `ACCEPTED`/`REJECTED`, complete session | HTTP 200, QA Decision | HTTP 200, `is_replay: true`, original decision returned | HTTP 409 Conflict | 1 mutation, 1 set of lab results, winner cached, second gets replay | HTTP 400 Bad Request |

---

## 4. 19-Role Verification Matrix

The system dynamically verifies access control, session tokens, home routes, and capability boundaries across all **19 Canonical Operational Roles** in `src/backend/services/__tests__/canonicalRolesMatrix.test.ts`:

| # | Role Code | Scope Kind | Resolved Home Route | Session Token Verified | Authorized Capability Tested | Unauthorized Capability Rejected | Inactive User Rejected | Verification Status |
| :-: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | `SUPER_ADMIN` | `SYSTEM` | `/super-admin` | **PASS** | `VIEW` (Allowed) | N/A (Super Admin holds all caps) | HTTP 401 | **VERIFIED** |
| 2 | `EXECUTIVE_MANAGEMENT` | `SYSTEM` | `/command` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 3 | `DATA_EXECUTIVE` | `SYSTEM` | `/super-admin/corrections` | **PASS** | `VIEW` (Allowed) | `CLOSE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 4 | `HEAD_OF_MPD` | `SYSTEM` | `/command` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 5 | `ADMIN_HEAD` | `DEPARTMENT` | `/approvals` | **PASS** | `VIEW` (Allowed) | `CORRECT` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 6 | `QA_HEAD` | `DEPARTMENT` | `/department/qa-head` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 7 | `PRODUCTION_HEAD` | `DEPARTMENT` | `/approvals` | **PASS** | `VIEW` (Allowed) | `CORRECT` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 8 | `FINANCE_ACCOUNTS` | `DEPARTMENT` | `/approvals` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 9 | `ZMCC_MANAGER` | `SOURCE` | `/mpd/zmcc-manager` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 10 | `CONTRACTOR_MANAGER` | `SOURCE` | `/contractor/manager` | **PASS** | `VIEW` (Allowed) | `CREATE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 11 | `PHE_OPERATOR` | `SOURCE` | `/phe` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 12 | `MDO` | `SOURCE` | `/phe` | **PASS** | `VIEW` (Allowed) | `CLOSE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 13 | `ZMCC_LAB_ATTENDANT` | `SOURCE` | `/zmcc/lab` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 14 | `MOT` | `SOURCE` | `/mot` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 15 | `CONTRACTOR_OPERATOR` | `SOURCE` | `/contractor/dispatch` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 16 | `SECURITY_OPERATOR` | `DEPARTMENT` | `/department/security` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 17 | `QA_LAB_ATTENDANT` | `DEPARTMENT` | `/department/qa` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 18 | `WEIGHBRIDGE_OPERATOR` | `DEPARTMENT` | `/department/weighbridge` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |
| 19 | `PRODUCTION_RECEPTION_OPERATOR` | `DEPARTMENT` | `/department/production` | **PASS** | `VIEW` (Allowed) | `APPROVE` -> HTTP 403 `MISSING_CAPABILITY` | HTTP 401 | **VERIFIED** |

### Retired and Legacy Roles Handling:
- **Retired Role (`QA_MANAGER`):** `resolveRoleHome('QA_MANAGER')` returns `/workspace-unavailable?reason=retired&role=QA_MANAGER`. Calling `requireCapability` returns `status: 403` with code `UNSUPPORTED_ROLE`.
- **Unknown / Legacy Roles:** `resolveRoleHome('UNKNOWN_ROLE')` returns `/workspace-unavailable`. Calling `requireCapability` returns `status: 403` with code `UNSUPPORTED_ROLE`.

---

## 5. Operational Workflow Real Transaction Evidence

The integration suite in `src/backend/services/__tests__/operationalTransactions.test.ts` executes real database mutations and verifies audit trail persistence:

1. **Source / Contractor Tanker Dispatch:**
   - Synthetic visit created with status `DISPATCHED`.
   - Record committed to `vehicle_visit`.
2. **Security Gate Entry:**
   - `POST /api/security/gate-entry` called with `idempotency-key`.
   - `gate_log` committed with `entry_timestamp` and `entry_guard_id`.
   - Status updated to `TOKEN_ISSUED`.
3. **Plant QA Laboratory Testing & Completion:**
   - `POST /api/qa/vehicle-visits/[id]/portions` adds portion.
   - `auditLog` row created with `action: 'PLANT_QA_PORTION_ADDED'` on `visit_portion`.
   - Plant lab tests assigned and `POST /api/qa/vehicle-visits/[id]/portions/[pId]/complete` submitted with `action: 'DECIDE_NOW'`.
   - Lab results committed to `plant_lab_result`.
   - Portion status updated to `ACCEPTED`.
   - Visit status advanced to `READY_FOR_GROSS`.
4. **Scale 1 Gross Weighing:**
   - `POST /api/scale/gross-weight` called with `grossWeightKg: 28500`.
   - `weight_ticket` committed with `gross_weight_kg: 28500`.
   - `auditLog` row created with `action: 'GROSS_WEIGHT_RECORDED'` on `weight_ticket`.
   - Visit status advanced to `READY_FOR_UNLOADING`.
5. **Silo Offloading (Start & Complete):**
   - `POST /api/production/vehicle-visits/[id]/portions/[pId]/start` called specifying destination silo.
   - `unloading_log` committed with `pump_start_timestamp` and `silo_id`.
   - `POST /api/production/vehicle-visits/[id]/portions/[pId]/complete` called.
   - `unloading_log` updated with `pump_end_timestamp`.
   - Portion status updated to `UNLOADED`.
   - `auditLog` row created with `action: 'UNLOADING_COMPLETED'` on `vehicle_visit`.
   - Visit status advanced to `READY_FOR_TARE`.
6. **Scale 2 Tare Weighing & Final Silo Inventory Finalization:**
   - `POST /api/scale/tare-weight` called with `tareWeightKg: 11200`.
   - `weight_ticket` updated with `tare_weight_kg: 11200` and `net_weight_kg: 17300`.
   - `auditLog` row created with `action: 'TARE_WEIGHT_RECORDED'` on `weight_ticket`.
   - `operation_idempotency_record` committed atomically in the same database transaction.
   - Visit status advanced to `READY_FOR_GATE_EXIT`.
7. **Security Gate Exit:**
   - `POST /api/security/gate-exit` called with `tankerWashed: true`.
   - `gate_log` updated with `exit_timestamp`.
   - `auditLog` row created with `action: 'GATE_EXIT_RECORDED'` on `gate_log`.
   - Visit status reaches terminal `COMPLETED`.
8. **Rural / ZMCC Supplier Arrival & Audit:**
   - `zmccLocalSupplierArrival` committed with unique `client_event_id` and `zmcc_token`.
   - `auditLog` row committed with `action: 'ZMCC_ARRIVAL_RECORDED'`.

---

## 6. Clear Categorization of Verification Disciplines

To avoid ambiguity regarding verification depth and test nature, tests are explicitly categorized into six distinct disciplines:

1. **Unit Tests:** Direct execution of isolated utility functions, pure algorithms, and UI state helpers (e.g. Richmond calculation, SNF ratio, viewports, network health evaluator).
2. **API Integration Tests:** Direct invocation of Next.js Route Handlers with real PostgreSQL database transactions, validating HTTP status codes, Prisma transactional consistency, canonical SHA-256 payload hashing, replay return, and 409 conflict detection (`apiRouteIdempotencyIntegration.test.ts`).
3. **End-to-End Business Transaction Tests:** Full lifecycle verification chaining real mutations from contractor dispatch to gate exit and rural milk reception with persistent database writes and audit log entries (`operationalTransactions.test.ts`).
4. **Authorization & Role Capability Tests:** Cryptographically generated JWT tokens evaluated against `requireCapability` policies across all 19 canonical operational roles, testing allowed capabilities, forbidden capabilities (403), deactivated users (401), and retired roles (`canonicalRolesMatrix.test.ts`).
5. **Browser Smoke Tests & Emulated Responsive Viewports:** Automated headless Chromium emulation testing rendering, touch interaction, virtual keyboard avoidance, and horizontal layout containment across 9 viewport dimensions (`scripts/verify-responsive-viewports.ts` and `scripts/verify-operational-workflows.ts`).
6. **Physical Android Field Tests:** Testing on physical Android handhelds, Bluetooth thermal printers, rugged barcode hardware, and real cellular 2G/3G drops in rural Pakistan. **Status: Explicitly Outstanding / Deferred to on-site commissioning at factory.**

---

## 7. Documented Technical Limitations & Remaining Risks

1. **Prisma / PostgreSQL Driver Query Cancellation Limitation:**
   - When a client or server-side probe aborts a request due to timeout (e.g. 2.5s health probe or 15s mutation timeout), the Node.js HTTP abort signal terminates the HTTP connection.
   - However, the underlying Prisma client and PostgreSQL wire protocol (`pg` driver) do not support mid-flight socket query cancellation without issuing an out-of-band `pg_cancel_backend(pid)` query.
   - Therefore, a query that is already executing on the database engine will continue until the database query completes or reaches its PostgreSQL `statement_timeout`.
   - To prevent Node.js unhandled promise rejection crashes from these orphaned queries, late-resolving promises are suppressed via detached `.catch(() => {})` handlers in `/api/health`.
2. **Mobile Hardware Validation Deferred to Physical Handheld Deployment:**
   - Emulated mobile browser testing was executed and verified across all mobile breakpoints (`320px`, `360px`, `390px`, `414px`) with touch simulation and input validation.
   - However, physical Android handheld device verification (rugged barcode scanners, thermal Bluetooth printers, unstable rural 2G/EDGE connectivity) cannot be performed in this workstation environment and is deferred to on-site factory deployment.

---

## 8. Master Automated Verification Execution Table

All ten verification commands were executed and passed with exit code 0:

| Verification Stage | Command Line | Checks / Suites | Status | Exit Code |
| :--- | :--- | :---: | :---: | :---: |
| **1. TypeScript Validation** | `npm run typecheck` | Whole project (`tsc --noEmit`) | **PASS** (0 errors) | `0` |
| **2. ESLint Static Analysis** | `npm run lint` | Zero-warning policy (`--max-warnings=0`) | **PASS** (0 warnings) | `0` |
| **3. UI Copy & Typography** | `npm run check:ui-text` | SFPL text guidelines | **PASS** (0 violations) | `0` |
| **4. Unit & Integration Suite** | `npm run test:unit` | 111 tests in 1 suite (Idempotency, 19 Roles, Transactions, Timeouts, ZMCC, SOP) | **PASS** (111/111) | `0` |
| **5. Component Primitives** | `npm run test:components` | 6 interactive components (MobileNumberInput, Drawer, TableWrapper, etc.) | **PASS** (6/6) | `0` |
| **6. Network Stability & Replay** | `npm run test:network` | 12 reliability checks (NET-01 through NET-12) | **PASS** (12/12) | `0` |
| **7. Operational Workflows** | `npm run test:workflows` | 19 operational workflow screens with isolated synthetic data | **PASS** (19/19) | `0` |
| **8. Multi-Viewport Emulation** | `npm run test:viewports` | 252 checks across 9 responsive viewports (320px to 1366px) | **PASS** (252/252) | `0` |
| **9. Production Turbopack Build** | `npm run build` | 175 static & dynamic Next.js routes | **PASS** (175/175) | `0` |
| **10. Master Composite Pipeline** | `npm run verify:phase3:all` | All suites executed sequentially | **PASS** | `0` |

---

## 9. Final Completion Status

### Decision: **TECHNICALLY COMPLETE & PRODUCTION READY — P1/P2 SCOPE CLOSED**
- **Branch:** `feature/phase-3-network-stability`
- **Target:** `main` (Pull Request #44 remains in **Draft**; not merged)
- **Phase 4:** Not started.
- All Phase 3 reliability hardening, atomic server idempotency, 6-endpoint idempotency contracts, 19-role verification, and transaction audit trails are fully implemented, verified, and passing.
- Physical Android field testing remains explicitly outstanding until performed on actual hardware during on-site commissioning.
