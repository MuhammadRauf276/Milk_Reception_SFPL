# Current Approved Business Rules (Current Truth)

This document records the authoritative business rules approved for the Milk Reception Application. It is not historical; it defines active engineering truth.

---

## 1. Time Architecture & Timezone
- **Company Timezone**: `Asia/Karachi` (Pakistan Standard Time, PKT, UTC+5).
- **Business-Facing Clock**: Pakistan local time. All operator-facing timestamps across all departments must display Pakistan local time (e.g. Dispatch Time, Gate Entry, QA Start, First Weight, Unloading Start, Unloading Complete, Second Weight, Gate Exit, Submitted At, and Audit timestamps).
- **Timestamp Authority**: Exactly one timezone-aware event timestamp remains authoritative per event. No separate independently editable `*_utc`, `*_pkt`, or `*_business_time` database fields are created.
- **Internal Representation**: UTC normalization may exist internally for ISO storage, but UTC is never an operator-facing display clock.

---

## 2. Business Date
- **Terminology**: User-facing term is **Business Date**.
- **Plant Business Date Exclusivity**: Plant Business Date (`operational_date`) applies strictly and exclusively to Plant `VehicleVisit` entities upon Gate Exit completion (`READY_FOR_GATE_EXIT -> COMPLETED`).
- **VehicleVisit Scope**: `VehicleVisit` is strictly for the Plant-bound intake lifecycle. Upstream MOT/PHE/ZMCC operations use normal PKT calendar dates and their own domain models (`MotJourney`, `MotVehicle`). Future ZMCC contractor arrival will use its own ZMCC-domain operational record, not `VehicleVisit`.
- **Final Receipt Independence**: Final Receipt retains its real operational timestamp and ordinary PKT calendar date; it does NOT assign or finalize a Business Date. There is no separate "Payment Business Date" or "financial settlement business date".
- **Cutoff Boundary**: `08:00:00 AM Asia/Karachi` through `07:59:59 AM` next calendar day (applied exclusively to `exit_timestamp` upon plant exit completion).
  - Example 1: `23-Aug 07:30 AM PKT` => Business Date `22-Aug`
  - Example 2: `23-Aug 08:00 AM PKT` => Business Date `23-Aug`
  - Example 3: `24-Aug 02:30 AM PKT` => Business Date `23-Aug`
  - Example 4: `24-Aug 08:00 AM PKT` => Business Date `24-Aug`
- **Data Type**: Business Date is **DATE-only** (YYYY-MM-DD).
- **Independence**: Event timestamps and Business Date remain strictly separate concepts. No fake shifted business timestamps are created.
- **Internal Storage**: Existing database column `operational_date` remains the storage field on `VehicleVisit`.

---

## 3. Future Audit Architecture (Design Lock — Not Implemented in 4C-5)
- **Submission Evidence**: High-value operational submissions will eventually preserve `submitted_by`, `submitted_at`, and `submitted_business_date`.
- **Manager / Super Admin Corrections**: Corrections will preserve `actor_user_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `occurred_at`, `business_date`, `reason`, `before_data`, and `after_data`.
- **Date Invariance**: The original milk transaction's Business Date must NOT change because a correction is performed on a subsequent calendar day (e.g. Milk Business Date `23-Aug`, correction on `24-Aug 09:15 AM PKT` records Correction Business Date `24-Aug` while original Milk Business Date remains `23-Aug`).
- **Super Admin Governance**: Super Admin actions must be more auditable, not less auditable. Finalized operational values use an explicit correction workflow rather than silent in-place overwrite.

---

## 4. Stage 4C-5 / Stage 6G-E Quantity Contract

### 4A. Vehicle Dispatch Quantity
- `VehicleVisit` remains the sole authoritative whole-vehicle Dispatch Quantity.
- **Basis Invariant (Stage 6G-E)**: Whole-vehicle dispatch quantity must strictly be an authoritative `MEASURED` fact (`vehicle_dispatch_quantity_basis = 'MEASURED'`). It can NEVER be `ESTIMATED` for new dispatches.
- Model fields: `Value`, `Unit` (`KG` or `LITER`), `Basis` (`MEASURED`).
- In ZMCC context, this represents the authoritative measured tank/bulk issue from calibrated dipstick or mass flow meter.
- Independently recorded; Vehicle Unit and Basis do NOT have to match portion Unit and Basis (e.g. Vehicle `8,000 LITER MEASURED` with Portions `4,000 LITER ESTIMATED` and `3,850 LITER ESTIMATED` is completely valid without forced conversion).

### 4B. Portion Quantity Profile
- Portions remain independently `MEASURED` or `ESTIMATED` (e.g. estimated from collection cans or measured from intermediate flow meters).
- Portion 1 establishes the shared portion `Unit` and `Basis` for all portions of that vehicle.
- Portions 2, 3, etc. automatically inherit Unit and Basis from Portion 1 and cannot independently contradict Portion 1.
- The numeric quantity `Value` remains independent per portion.
- **Unit Change Guard**: If the shared Unit/Basis is changed after quantities exist, old numbers must NOT be reinterpreted (e.g. `9,800 LITER` must not silently transform into `9,800 KG`). Changing Unit requires safe clear/re-entry.

### 4C. Portion Total
- Total Portion Quantity is calculated when all relevant portions have valid quantity values.
- If any portion quantity is missing, Total Portion Quantity is incomplete and unauthoritative (missing is NOT zero).

### 4D. Measured Vehicle Assistance & Portion Derivation Prohibition (Stage 6G-E Hardening)
- **Derivation Prohibited**: Whole-vehicle dispatch quantity must NEVER be auto-prefilled, derived, or overwritten from portion totals (`Vehicle Issue = Sum(Portions)` is strictly forbidden).
- The legacy "Use Portion Total" button and assisted prefill logic are deprecated and disabled.
- Vehicle Dispatch Quantity and Portion Totals are separate, independent operational facts.

### 4E. Difference & Reconciliation Display
- **Same Unit**: If Vehicle Unit == Portion Unit, `Difference = Vehicle Dispatch Quantity - Total Portion Quantity` (informational reconciliation comparison only; NO tolerance bands, NO hard blocks, and non-zero difference is NEVER treated as a submission-blocking error).
- **Different Units**: If Vehicle Unit != Portion Unit, display: `"Different units — no direct comparison"` (never convert KG ↔ LITER merely for comparison).
- **Explanatory Note**: The UI explicitly informs operators: *"Vehicle Issue is the authoritative measured whole-vehicle quantity. Portion Total is shown for comparison only."*

---

## 5. Gross Liters & Quality Terminology
- **Gross Liters (replaces "Physical Liters" in UI)**:
  - If declared Unit = `LITER`: `Gross Liters = Declared Liters`
  - If declared Unit = `KG`: `Gross Liters = KG / Canonical Density` (where `Density = 1 + LR / 1000`)
  - If KG declared and required authoritative LR/Density is unavailable: `Gross Liters = unavailable` (no fake density, no zero default).
- **Liters @ 13% TS (replaces "13 TS" in UI)**:
  - Formula: `Gross Liters * TS / 13`
- **Canonical Formula Invariants**:
  - `SNF = LR / 4 + 0.22 * Fat + 0.72`
  - `TS = Fat + SNF`
  - `SNF:Fat Ratio = SNF / Fat`
- **Portion Scope**: Quality calculations remain portion-wise. No whole-vehicle LR/Fat/Density/SNF/TS averaging is introduced in 4C-5.

---

## 6. Dispatch UX & Form Layout
- **Top-Level Tabs**: `[ Recent Dispatches ]` (history & filter cards) and `[ New Dispatch ]` (entry workspace).
- **New Dispatch Workspace**: Main form accompanied by a sticky/left-side Summary Area.
  - **Vehicle Summary**: Vehicle Dispatch Quantity, Unit, Basis, Total Portion Quantity, Portion Unit, Portion Basis, Portion Count, same-unit Difference / different-unit message, safe total Gross Liters (when mathematically valid), and safe total Liters @ 13% TS (when mathematically valid).
  - **Portion Summaries**: Per-portion Quantity, Basis, LR, Fat, Density, Gross Liters, SNF, Total Solids, SNF:Fat Ratio, Liters @ 13% TS.
  - **Simplification**: The repeated large "Live Calculation Summary (Canonical Formulae)" block inside each individual portion card is replaced/consolidated into the summary UX.

---

## 7. Removal of Measurement Method
- **Canonical Model**: Quantity is defined strictly by `Value`, `Unit` (`KG` or `LITER`), and `Basis` (`ESTIMATED` or `MEASURED`).
- **Removal**: Dispatch Measurement Method has been completely removed from active production.
- **Database & Schema**: Vehicle and Portion `measurement_method` columns and the PostgreSQL `MeasurementMethod` enum were dropped by migration 13 (`20260824120000_remove_dispatch_measurement_method`).
- **Production Independence**: No active Dispatch UI, API, domain, or validation dependencies remain on measurement method.
- **Historical Immutability**: Historical migrations may still mention the legacy column names because migration history remains immutable.

---

## 8. Weighbridge Terminology Alignment
- **First Weight**: `Gross Weight` => **`First Weight (Loaded Vehicle)`**
- **Second Weight**: `Tare / Second Weight` => **`Second Weight (After Unloading)`** (second weight is the post-unloading mass; rejected milk may remain onboard; do not term it empty tare).
- **Net Mass**: `Net Milk Received KG` => **`Net Milk Weight`**
- **Formula**: `Net Milk Weight = First Weight - Second Weight`
- **Scope**: Initial phase is a UI terminology change to maintain backend database column stability.

---

## 9. QA Workflow & Save Draft Resolution
- **Save Draft Unsupported**: Save Draft is intentionally unsupported based on approved operational review (Chemists complete QA entry in the same working session).
- **Production Surface**: No operator "Save Draft" button exists, no production QA `/draft` endpoint exists, and no autosave mechanism exists.
- **Workflow Lifecycle**: Normal workflow is `Pending` -> `IN_PROGRESS` -> `Accept` / `Reject` / `Hold`.
- **HOLD State**: HOLD is a genuine, explicit QA business quarantine state with mandatory rationale and is NOT a draft substitute.
- **Historical Compatibility**: Existing historical partial `PlantLabResult` rows remain readable and finalizable for backwards compatibility.

---

## 10. QA Pakistan Local Time Display
- **Authoritative Timezone**: Company and plant timezone is `Asia/Karachi` (PKT, UTC+5).
- **Operator Event Display**: All operator-visible QA event timestamps (Gate Entry, Hold since, Start/Resume/Accept/Reject/Hold modals) explicitly format using Pakistan local time via `formatOperationalTime` / `formatOperationalDatetime`.
- **Form Inputs & Submission**: `<input type="datetime-local">` minimums and values use Pakistan wall time (`toDatetimeLocalInput`), which converts deterministically to authoritative UTC ISO instants on submission (`datetimeLocalToIso`).
- **Chronology & Validation**: Chronology validation and future-event checks remain instant-based (`Date.getTime()`).
- **Business Date**: Business Date remains an independent DATE-only concept (`operational_date`) and was not altered.

---

## 11. Dispatch Source Authority & Draft Scoping
- **Bound Operator**: Source-bound users automatically and immutably use their assigned `procurement_source_id`.
- **Unbound Operator / Admin**: Unbound authorized users must explicitly select an operating source from available active sources.
- **Zero Fallback**: Silent fallback to the "first active source" is strictly forbidden across frontend and backend.
- **Draft Key Scoping**: Client storage keys are strictly scoped: `mpd_active_draft_visit_id:<USER_ID>:<SOURCE_ID>`.
- **Configuration Freeze**: Starting a Dispatch draft immutably freezes all required configuration snapshots (Lab Test Catalog and Quantity Policy) for the lifetime of that draft.

---

## 12. Plant Final Receipt & Silo Allocation
- **Vehicle-Wise Finalization**: Final Net KG is calculated strictly at the vehicle level as `Gross Weight - Second Weight`.
- **Quality Averaging**: Accepted Plant QA quantitative results are averaged arithmetically across accepted compartments/portions.
- **No Fallback**: Zero fallback to Dispatch lab results or Dispatch quantities for plant inventory receipts.
- **Silo Allocation**: If accepted portions map to more than one destination silo, final receipt remains blocked with `MULTI_SILO_ALLOCATION_REQUIRED` because actual received Net KG exists only at vehicle level and no authoritative per-portion received mass exists. Do not invent allocation.

---

## 13. Operational Business Date vs Upstream Calendar Dates

- **Plant Business Date Exclusivity**: Plant Business Date (`operational_date`) applies strictly and exclusively to Plant `VehicleVisit` entities upon Gate Exit completion (`operational_date` computed via `getOperationalBusinessDate(exit_timestamp)` at `READY_FOR_GATE_EXIT -> COMPLETED` transition).
- **In-Progress Visits**: A vehicle visit currently inside the plant or not yet exited has `operational_date: null` and `business_date: null`. Do NOT filter in-progress visits by `VehicleVisit.operational_date`.
- **Source Dispatch Date Filtering**: Default date filtering on `/api/logs` filters by source dispatch date (`dispatch_date` in PKT calendar boundaries), never by Plant Gate-Exit Business Date.
- **Upstream Stage Calendar Dates**: Upstream operations (MOT journeys, shop collections, ZMCC dispatches, and initial visit/reception numbering prefixes) operate on ordinary Pakistan Standard Time calendar dates (`getPakistanCalendarDate()`, `YYYY-MM-DD` in `Asia/Karachi`), NOT the 08:00 AM plant rollover cutoff.
- **Final Receipt Date Semantics**: Final Receipt does NOT assign or finalize a Business Date. It retains its real operational timestamp (`operational_timestamp`) and ordinary PKT calendar date (`getPakistanCalendarDate`). No separate "Payment Business Date" or "financial settlement business date" exists.
- **VehicleVisit Lifecycle Boundary**: `VehicleVisit` is strictly for the Plant-bound intake lifecycle. MOT uses `MotJourney` / `MotVehicle` domain records. Future ZMCC contractor arrival will use its own ZMCC-domain operational record, not `VehicleVisit`.
- **MOT Journey Lifecycle**: MOT journey starts immediately upon authorized assignment. `first_mot_gps_*` remains the first actual MOT-device telemetry, not the journey start trigger. There is no manual MOT Start button.
- **Canonical MOT Route Namespace**: The canonical API namespace for MOT operations is `/api/zmcc/mot/journeys/current`. Deprecated duplicate `/api/mot/...` routes are removed.

---

## 14. Stage 6E ZMCC Arrival, Tokens, Journey Completion, and Roadmap

### 14A. MOT ZMCC Arrival & Journey Completion
- **Operator Authority**: PHE Operator (scoped to assigned active ZMCC) or Super Admin records arrival.
- **Route Milk Token**: Manually submitted by PHE from the physical collection slip / driver ticket (`route_milk_token`). It is not client/system regenerated on replay. After completed submission, PHE cannot edit it. Authorized ZMCC Manager / Super Admin may correct it under the max-two correction contract with mandatory reason and immutable AuditLog history. System ZMCC Token (`zmcc_token`) is permanently immutable.
- **Automatic ZMCC Token**: Generated using sequence `zmcc_token_seq` with daily PKT calendar date code: `ZT-MOT-YYYYMMDD-XXXX`. Collision-safe, immutable.
- **Journey Lifecycle Transition**: Journey status moves atomically from `COLLECTING` to `COMPLETED`. `ended_at` is set to the actual arrival timestamp.
- **Pending Stops**: Unvisited journey stops remain in `PENDING` status. They are NOT marked as `SKIPPED`.
- **GPS Separation**:
  - `phe_latitude` / `phe_longitude` / `phe_gps_accuracy`: Recorded by PHE operator device upon arrival (optional, valid coordinates).
  - `final_mot_gps_*`: Snapshotted from the latest recorded `MOT_DEVICE` telemetry point where `device_recorded_at <= arrival_timestamp`.
- **Delayed Offline Sync After Completion**: Delayed offline GPS batches or shop collections recorded prior to or at `ended_at` remain valid and can be synced after journey completion. If a delayed point is newer than `final_mot_gps_at`, `final_mot_gps_*` is updated atomically.

### 14B. Contractor ZMCC Arrival Foundation
- **ZMCC Domain Model**: Uses its own `ZmccContractorArrival` model.
- **Strict Boundary (NO VehicleVisit)**: ZMCC contractor arrival NEVER creates a `VehicleVisit`. `VehicleVisit` is reserved exclusively for the Plant domain.
- **Contractor Token**: Generated from sequence `zmcc_token_seq`: `ZT-CON-YYYYMMDD-XXXX`.
- **Contractor Validation**: Requires active `CONTRACTOR` procurement source and normalized uppercase vehicle number.

### 14C. Idempotency & Concurrency Safety
- Both arrival endpoints require `client_event_id`.
- First submission: `201 Created`.
- Exact replay (identical payload): `200 OK` with `is_replay: true`.
- Altered replay (same `client_event_id` with changed payload): `409 Conflict`.
- Duplicate arrival attempt on the same journey: `409 Conflict`.
- Concurrent identical requests yield exactly 201 + 200, 1 database row, 1 token, and 1 audit log.

### 14D. Manager Corrections
- Authorized roles: `ZMCC_MANAGER` (own ZMCC) or `SUPER_ADMIN`.
- Max 2 corrections per arrival record (`correction_count < 2`).
- Mandatory `reason` required for every correction.
- Tokens (`zmcc_token`) and identity relationships are immutable.
- Correctable: `route_milk_token` (MOT), `vehicle_number` (Contractor), `arrival_timestamp`, and PHE GPS.
- Changing `arrival_timestamp` updates `MotJourney.ended_at` and re-evaluates `final_mot_gps_*`.
- Full before/after state, reason, and actor recorded in immutable `AuditLog`.

### 14E. Stage 6I PWA Roadmap Entry
- **Roadmap Note**: Progressive Web Application (PWA) offline capabilities, service worker caching, and manifest installation for MOT and PHE operators are designated for **Stage 6I**.
- **Stage 6E Status**: PWA is NOT implemented in Stage 6E. Stage 6E establishes the server-side idempotency, offline sync reconciliation contracts, and database sequence tokens required to support future PWA offline clients.

---

## 15. Stage 6F ZMCC Lab Testing & Acceptance Decisions

### 15A. Lab Role & Permissions
- Exactly one canonical testing role is introduced: `ZMCC_LAB_ATTENDANT`.
- **Authority**:
  - `ZMCC_LAB_ATTENDANT` (scoped to assigned active ZMCC) and `SUPER_ADMIN` have testing authority: start/resume sessions, update draft results, and submit final acceptance decisions.
  - `ZMCC_MANAGER` (scoped to assigned active ZMCC) and `SUPER_ADMIN` have supervisory oversight and correction authority: view queue/history and perform corrections on completed lab sessions. ZMCC Managers cannot start, draft, or complete intake sessions.
  - PHE Operators, MOT Officers, Plant QA Chemists, and other roles fail closed (`403 Forbidden`).

### 15B. Lab Test Master & Scope Extension
- Canonical `LabTest` master is extended to include scopes `ZMCC` and `ALL` in addition to `DISPATCH`, `PLANT`, and `BOTH`.
- `GET /api/lab-tests?scope=ZMCC` returns tests where `testScope IN ('ZMCC', 'ALL')`.
- If zero active ZMCC lab tests are configured when starting a session, the request fails with a controlled `400 Bad Request` (`"No active ZMCC lab tests configured."`).
- Result type immutability checks on `LabTest` include `ZmccLabResult` historical usage.

### 15C. Session Lifecycle & Frozen Test Snapshot
- Models: `ZmccLabSession` and `ZmccLabResult`.
- When a session starts, active ZMCC lab tests are snapshotted into `ZmccLabResult` (frozen test code, test name, result type, unit, requirement, and categorical options). Subsequent edits to the `LabTest` master do NOT alter existing session results.
- Only one session can exist per arrival (`mot_arrival_id` or `contractor_arrival_id` unique constraint). Concurrent starts return the existing session idempotently.
- Status transition: `IN_PROGRESS -> COMPLETED`. Once completed, draft updates are rejected.

### 15D. Decision Semantics & Mandatory Rejection Reason
- Allowed decisions: `ACCEPTED` or `REJECTED`.
- If `REJECTED`, a non-empty `rejection_reason` is mandatory.
- Completion requires deterministic 1-to-1 payload matching for every frozen non-CALCULATED test:
  - Rejects unknown test IDs, duplicate test IDs, and missing frozen non-CALCULATED tests (`400 Bad Request`).
  - Required tests (`is_required_snapshot = true`) must have valid non-null values. Categorical tests must adhere to snapshot allowed options.
  - Optional tests may be explicitly null or empty.
- Idempotency via `completion_client_event_id`: exact re-submissions return `200 OK` with the existing completed session; altered payloads or concurrent collisions return `409 Conflict`.

### 15E. Completed Record Correction & Audit Policy
- **Zero Post-Completion Operator Authority**: The operational user (`ZMCC_LAB_ATTENDANT`) who finalized/submitted the form has zero edit authority once `status = COMPLETED`.
- **Latest State on Main Record**: The latest corrected values are stored directly on the main record (`ZmccLabSession`, `ZmccLabResult`). No separate correction-history table is created.
- **AuditLog as History Truth**: The immutable `AuditLog` table is the sole authoritative audit trail for before/after history (`action = 'ZMCC_LAB_SESSION_CORRECTED'`).
- **Operational Manager 5-Save Limit**: `ZMCC_MANAGER` (scoped to assigned active ZMCC) is capped at 5 successful correction saves per completed form (`manager_correction_count < 5`). DB constraint enforces:
  `correction_count >= 0 AND manager_correction_count >= 0 AND manager_correction_count <= 5 AND manager_correction_count <= correction_count`.
- **One Successful Save = One Correction**: A Manager save request may update one or multiple approved fields (e.g. results, decision, remarks). It counts as exactly ONE correction increment and produces exactly ONE AuditLog event.
- **No-Op & Failed Request Protection**: A correction count increases only when the actor is authorized, validation passes, at least one allowed operational value actually changes, and the transaction commits. Requests with identical/no-op values are rejected with `400 Bad Request` (`"No changes detected."`) and create zero counter increment, zero AuditLog entry, and zero timestamp change.
- **Super Admin Authority**: `SUPER_ADMIN` possesses unlimited completed-record correction authority. Super Admin corrections do NOT consume the Manager's 5 allowed saves, but DO increment total `correction_count`, require a mandatory reason, update `last_corrected_by_user_id` / `last_corrected_at`, and create an immutable `AuditLog`.
- **Audit & Counting Rigor**:
  - `correction_count` tracks total successful corrections across all actors.
  - `manager_correction_count` tracks successful corrections by `ZMCC_MANAGER` (0..5).
  - Every successful correction requires a non-empty `reason` and writes an immutable `AuditLog` entry containing actor, action, timestamp, reason, before_state, and after_state.
- **Attribution Permanence**:
  - Original submitter and timestamp (`started_by_user_id`, `started_at`, `completed_by_user_id`, `completed_at`) remain permanently immutable upon completion.
  - Latest corrector and timestamp (`last_corrected_by_user_id`, `last_corrected_at`) update atomically on every successful correction.
- **Allow-Listed Fields**: Correction UI/API may alter only explicitly approved Stage 6F operational values: observed results (`numeric_value`, `text_value`), `decision`, `rejection_reason`, and `remarks`. System/identity fields and CALCULATED tests remain immutable.
- **Concurrency Safety**: Row-level locking (`SELECT ... FOR UPDATE`) guarantees race safety. When 1 Manager slot remains (count = 4) and two Manager requests arrive concurrently, exactly one succeeds (#5) and the other fails cleanly with `400 Bad Request` without creating phantom audit logs.

### 15F. Architectural Boundaries
- **Zero Plant Business Date Rollover**: ZMCC operations use ordinary PKT timestamps and dates; 08:00 AM Plant Business Date rollover is strictly forbidden in ZMCC.
- **Zero VehicleVisit**: ZMCC arrivals and lab sessions NEVER create or reference `VehicleVisit`.
- **Zero Tank/Inventory Posting**: `ACCEPTED` milk does NOT post to tanks or inventory in Stage 6F (reserved for Stage 6G).

---

## 16. Stage 6G-A Milk Test Policy & Head of MPD Authority

### 16A. Role & Authority Architecture
- Exactly one new canonical role is introduced: `HEAD_OF_MPD` (Display: `Head of MPD`).
- **Scope**: Global Milk Procurement scope, not attached to one ZMCC or Contractor (`requiresSource = false`, `scopeType = 'SYSTEM'`).
- `MPD_Zone_Manager` is a retired legacy role. It is NOT repurposed to Head of MPD and does not receive policy mutation authority.
- `ZMCC_MANAGER` remains the operational source manager for a single ZMCC with zero policy mutation authority.
- **Authority Boundaries**:
  - `SUPER_ADMIN`: Full authority across all 5 testing points (`MOT_SHOP`, `ZMCC_LAB_MOT`, `ZMCC_LAB_CONTRACTOR`, `DISPATCH`, `PLANT_QA`) and the master `LabTest` catalogue.
  - `HEAD_OF_MPD`: Policy authority over the 4 MPD testing points (`MOT_SHOP`, `ZMCC_LAB_MOT`, `ZMCC_LAB_CONTRACTOR`, `DISPATCH`). Strictly forbidden from mutating `PLANT_QA` (`403 Forbidden`). Read-only access to master `LabTest` catalogue.
  - `ZMCC_MANAGER`, `ZMCC_LAB_ATTENDANT`, `MOT`, `PHE_OPERATOR`, `QA_Operator`, `CONTRACTOR_MANAGER`, and legacy roles: Zero policy mutation authority (`403 Forbidden`).

### 16B. Test Master vs. Test Policy Separation
- `model LabTest` remains the single canonical test master catalogue. No secondary test masters (`MotTest`, `ZmccTest`, etc.) are created.
- `model MilkTestPolicyAssignment` defines the policy layer: "Which tests must be performed at each business testing point?"
- Canonical testing points (exact strings):
  1. `MOT_SHOP`: Tests for milk collected by MOT drivers at village shops.
  2. `ZMCC_LAB_MOT`: Tests evaluated at ZMCC Lab for MOT milk arrivals.
  3. `ZMCC_LAB_CONTRACTOR`: Tests evaluated at ZMCC Lab for Contractor milk arrivals.
  4. `DISPATCH`: Tests evaluated at dispatch time before departing for factory.
  5. `PLANT_QA`: Tests evaluated at factory QA reception laboratory.
- **Uniqueness**: Unique constraint on `[lab_test_id, testing_point]`.
- **Independent Policy Properties**: Each policy assignment owns its own `is_required`, `display_order`, and `is_active`. Changing policy does not mutate `LabTest.isRequired` or `LabTest.testScope`.
- **Soft-Deactivation Only**: `is_active = false`. Physical row deletion is not permitted in normal policy API.

### 16C. Core Milk Calculations Invariance
- Core calculated milk metrics (`Density`, `Gross Liters`, `SNF`, `TS`, `@13TS`) remain owned by `src/backend/utils/milkFormulas.ts`.
- They are NOT configurable test assignments and must NOT be created as policy rows.

### 16D. Compatibility & Staged Migration
- Existing `LabTest.testScope` values (`DISPATCH`, `PLANT`, `BOTH`, `ZMCC`, `ALL`) remain untouched for backwards compatibility.
- `BOTH` continues to mean Dispatch + Plant.
- No existing consumers (MOT shop collection, Stage 6F ZMCC Lab freezing, Dispatch, Plant QA) are switched in Stage 6G-A.
- Policy table starts empty in production; zero guessed test assignment seeding.

### 16E. Configuration Audit Trail
- Uses the single canonical `audit_logs` table (`table_name = 'milk_test_policy_assignment'`).
- Actions: `MILK_TEST_POLICY_CREATED`, `MILK_TEST_POLICY_UPDATED`, `MILK_TEST_POLICY_DEACTIVATED`, `MILK_TEST_POLICY_ACTIVATED`.
- Master configuration changes are not subject to operational form correction counters (e.g. 5-save limit does not apply to policy configuration).

---

## 17. Authoritative Organization Role Hierarchy & Legacy Role Retirement (Stage 6G-A Correction #2)

### 17A. Authoritative Hierarchy Architecture
The enterprise organization hierarchy is codified as follows:
```
SUPER ADMIN (SUPER_ADMIN)
|
+-- Senior Executive Management (EXECUTIVE_MANAGEMENT)
|
+-- Data Executive (DATA_EXECUTIVE)
|
+-- MPD Head (HEAD_OF_MPD)
|    |
|    +-- ZMCC Manager (ZMCC_MANAGER)
|    |     |
|    |     +-- PHE Operator (PHE_OPERATOR)
|    |     +-- ZMCC Lab Attendant (ZMCC_LAB_ATTENDANT)
|    |     +-- MOT (MOT)
|    |
|    +-- Contractor Manager (CONTRACTOR_MANAGER)
|          |
|          +-- Contractor Operator (CONTRACTOR_OPERATOR)
|              Example dummy fixture: Wasim Sahib
|
+-- Admin Head (ADMIN_HEAD)
|    |
|    +-- Security Operator (SECURITY_OPERATOR)
|
+-- QA Head (QA_HEAD)
|    |
|    +-- QA Manager (QA_MANAGER)
|          |
|          +-- QA Lab Attendant (QA_LAB_ATTENDANT)
|
+-- Production Head (PRODUCTION_HEAD)
|    |
|    +-- Weighbridge Operator (WEIGHBRIDGE_OPERATOR)
|    +-- Production Reception Operator (PRODUCTION_RECEPTION_OPERATOR)
|
+-- Finance and Accounts (FINANCE_ACCOUNTS)
```

### 17B. Key Role Meanings & Boundaries
- **MPD Head (`HEAD_OF_MPD`)**: Global Milk Procurement authority (`scopeType = 'SYSTEM'`).
- **ZMCC Manager (`ZMCC_MANAGER`)**: Source-bound manager below MPD Head for one assigned ZMCC (`scopeType = 'SOURCE'`).
- **Contractor Manager (`CONTRACTOR_MANAGER`)**: Source-bound manager below MPD Head for one assigned Contractor (`scopeType = 'SOURCE'`).
- **ZMCC Lab Attendant (`ZMCC_LAB_ATTENDANT`)**: Single operational laboratory role at ZMCC responsible for:
  1. MOT arrival lab testing
  2. Contractor arrival lab testing
  3. ZMCC dispatch testing before milk departure to Plant
  (Eliminates old `MPD_Operator` at ZMCC). Role Home is `/zmcc/lab` (also authorized at `/department/mpd` for ZMCC dispatch).
- **PHE Operator (`PHE_OPERATOR`)**: Role Home is `/phe`.
- **MOT (`MOT`)**: Role Home is `/mot`.
- **Contractor Operator (`CONTRACTOR_OPERATOR`)**: Operational role at contractor source performing dispatch prep/testing.
  - Fixture: `Wasim Sahib` (`contractor.operator.alkhair`), bound to `CONT-ALKHAIR`. Restricted to assigned Contractor source. Role Home is `/workspace-unavailable` for now (until dedicated workspace is built).
- **QA Lab Attendant (`QA_LAB_ATTENDANT`)**: Operational role performing Plant laboratory testing (`PLANT_QA` testing point only). Role Home is `/department/qa`.
- **Security Operator (`SECURITY_OPERATOR`)**: Plant security gate execution. Role Home is `/department/security`.
- **Weighbridge Operator (`WEIGHBRIDGE_OPERATOR`)**: Plant weighbridge scale recording. Role Home is `/department/weighbridge`.
- **Production Reception Operator (`PRODUCTION_RECEPTION_OPERATOR`)**: Plant silo offloading and production reception. Role Home is `/department/production`.
- **Unimplemented High-Level Roles**: `EXECUTIVE_MANAGEMENT`, `DATA_EXECUTIVE`, `ADMIN_HEAD`, `QA_HEAD`, `QA_MANAGER`, `PRODUCTION_HEAD`, `FINANCE_ACCOUNTS`, and `CONTRACTOR_OPERATOR` route fail-closed to `/workspace-unavailable` until their respective stages.

### 17C. Retired Legacy Roles (Zero Live Authority)
- The following legacy roles have ZERO live authority: `Admin`, `MPD`, `MPD_Operator`, `MPD_Zone_Manager`, `QA`, `QA_Operator`, `Security_Weight`, `Security_Operator` (legacy casing), `Security_Manager`, `Weighbridge_Operator` (legacy casing), `Production`, `Production_Operator` (legacy casing), `Production_Manager`, `QA_Manager` (legacy casing), `General_Plant_Manager`, `Correction_Officer`, `Management`.
- Legacy strings fail closed across all active APIs, routes, and mutation checks.
- Exact legacy users in persistent databases are safely migrated in-place to canonical equivalents or deactivated.
- **Audit Log Immutability**: Historical user IDs on `audit_logs`, `created_by`, `completed_by`, and related foreign keys are strictly preserved; no fake identities or audit log deletions.

---

## 18. Stage 6G-B MOT Journey Final Summary

### 18A. Core Entity & Immutability
- **Entity**: `MotJourneySummary` (backed by PostgreSQL table `mot_journey_summary`).
- **Ownership**: 100% system-owned, immutable summary. No operator (including Super Admin) can manually edit or override summary fields via any API or UI.
- **Relationship**: Exact 1-to-1 relationship with `MotJourney` via unique foreign key `journey_id`.
- **Creation Lifecycle**: Created strictly inside the same PostgreSQL transaction (`tx`) that completes ZMCC arrival (`POST /api/zmcc/arrivals/mot`).
- **Version Tracking**: `summary_version = '1.0'`. Distinct sorted array of calculation formula versions tracked in `source_calculation_versions` (e.g. `["1.0"]`).
- **No Plant Business Date**: Upstream MOT journeys operate on standard Pakistan Standard Time (PKT) calendar dates. Summary does NOT use Plant 08:00 AM cutoff or `operational_date`.
- **No MotVehicleVisit**: `MotJourney` remains the canonical entity; no artificial visit abstraction is introduced.

### 18B. Aggregation & Weighting Formulae
- Aggregates all shop collections belonging to the journey (`MotShopCollection` linked via `journey_id` through `MotJourneyStop`):
  - `total_gross_liters = SUM(gross_liters)` (rounded half-up to 2 decimals)
  - `total_at_13ts_liters = SUM(at_13ts_liters)` (rounded half-up to 2 decimals)
  - `weighted_avg_lr = SUM(gross_liters * lr) / total_gross_liters` (rounded half-up to 2 decimals)
  - `weighted_avg_fat = SUM(gross_liters * fat) / total_gross_liters` (rounded half-up to 2 decimals)
  - `weighted_avg_snf = SUM(gross_liters * snf) / total_gross_liters` (rounded half-up to 2 decimals)
  - `weighted_avg_ts = SUM(gross_liters * ts) / total_gross_liters` (rounded half-up to 2 decimals)
- **Weighting Basis**: All quality averages are strictly weighted by **`gross_liters`** (never physical kg, dipstick inches, or unweighted count averages).
- **Empty Journey Handling**: If zero shop collections exist, `total_gross_liters = 0.00`, `total_at_13ts_liters = 0.00`, and all weighted average quality metrics (`lr`, `fat`, `snf`, `ts`) must be `NULL`.
- **Shop Stop Counts**:
  - `assigned_shop_count`: Total stops on journey
  - `collected_shop_count`: Stops with successful collection (`status == 'COLLECTED'`)
  - `skipped_shop_count`: Stops skipped (`status == 'SKIPPED'`)
  - `pending_shop_count`: Stops not completed (`status == 'PENDING'`)

### 18C. Offline Delayed Sync & Late Recompute Exception
- **Late Sync Window**: If a delayed offline collection arrives after journey completion, but was recorded on the device prior to or at journey end (`device_collected_at <= journey.ended_at`):
  - Allowed and ingested in a transaction.
  - The existing `MotJourneySummary` is recomputed in the SAME transaction.
  - `revision` counter is incremented by 1 (`revision += 1`).
  - An audit log event `MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC` is created in the same transaction with `user_id` set to the submitting MOT actor.
  - Stop counts update (e.g. `pending_shop_count` decrements, `collected_shop_count` increments).
- **Exact Idempotent Replay**: Re-submitting the exact same collection must NOT alter revision or emit redundant audit logs.
- **Post-Journey Prohibition**: Any collection attempted with `device_collected_at > journey.ended_at` is rejected, leaving the summary unchanged.
- **GPS Invariance**: Late sync of GPS breadcrumbs or location points alone does NOT trigger summary recomputation or revision bumps.

### 18D. Concurrency Row-Level Locking & Serialization
- **Exclusive Journey Lock**: Both ZMCC MOT arrival completion (`submitMotArrival`) and MOT shop collection recording (`recordShopCollection`) acquire an exclusive PostgreSQL row lock on `mot_journey` via `SELECT id FROM mot_journey WHERE id = ${journeyId} FOR UPDATE` within their respective transactions.
- **Race Prevention**: Eliminates race conditions between simultaneous arrival completion and offline shop collection ingestion, or dual simultaneous offline collections syncing from different mobile queues.
- **Lifecycle Re-validation Under Lock**: Ingestion transactions re-read `started_at`, `ended_at`, and `cancelled_at` inside the locked transaction, ensuring accurate historical validation against the journey's finalized lifespan.
- **Monotonic Revision Sequencing**: When multiple delayed collections arrive simultaneously for different stops on a completed journey, the exclusive row lock forces sequential execution:
  - The first collection acquires lock, inserts collection, recomputes summary (revision 1 -> 2), and commits.
  - The second collection acquires lock, reads the updated revision 2, inserts collection, recomputes summary (revision 2 -> 3), and commits.
  - Emits distinct `MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC` audit log records for each late collection transaction.

---

## 19. Stage 6G-C ZMCC Final Milk Metrics & Independent Lab Snapshot

### 19A. Quantity & Unit Authority
- **Allowed Units**: User input allows `KG` or `Liters` (persisted strictly as canonical values `KG` or `LITER` via PostgreSQL native enum `QuantityUnit`).
- **Canonical Calculation Owner**: Derived gross volume must be computed using `computeCanonicalMilkMetrics(quantityValue, quantityUnit, lr, fat)` from `src/backend/utils/milkFormulas.ts`:
  - `LITER` -> returns declared liters directly: `gross_liters = quantity_value`.
  - `KG` -> returns declared `gross_liters = quantity_value / (1 + lr / 1000)`.
- **Derived Metrics**:
  - `density = 1 + lr / 1000` (Decimal 6,4, rounded to 4 decimals)
  - `gross_liters` (Decimal 12,2, rounded to 2 decimals)
  - `snf = lr / 4 + 0.22 * fat + 0.72` (Decimal 6,2, rounded to 2 decimals)
  - `ts = fat + snf` (Decimal 6,2, rounded to 2 decimals)
  - `at_13ts_liters = gross_liters * ts / 13` (Decimal 12,2, rounded to 2 decimals)
  - `calculation_version = '1.0'`
- **Physical Bounds & Constraints**:
  - `quantity_value > 0`
  - `density > 0`
  - `gross_liters > 0`
  - `snf >= 0`
  - `ts >= 0`
  - `at_13ts_liters >= 0`
  - Database check constraints enforce that when set, these columns satisfy the physical bounds.

### 19B. Independent Stage Snapshots & Shared Calculation Engine
- **No Conflation**: ZMCC Laboratory Session metrics (`gross_liters`, `density`, `snf`, `ts`, `at_13ts_liters`) are computed independently from actual physical testing at the ZMCC lab reception.
- **MOT & Contractor Equality**: Both MOT arrivals and Contractor arrivals share the exact same calculation engine and formula paths.
- **Read-Only Reference**: The upstream `MotJourneySummary` (when present on MOT arrivals) is displayed for reference only and is NEVER auto-copied, prefilled, or used to override physical reception measurements.
- **Auditable Contrast**: `MotJourneySummary` captures the field collection snapshot (what the MOT driver collected across shops), while `ZmccLabSession` captures the reception snapshot (what arrived and was physically tested at the ZMCC chiller). Both are immutable stage records.

### 19C. Core Test Parameter Resolution (Fail-Closed)
- **Measured Parameters**: LR and Fat remain measured test results in `ZmccLabResult`. No editable `session.lr` or `session.fat` columns are introduced.
- **Fail-Closed Resolution**: `resolveCoreMilkTestResults(testConfigs, results)` in `src/backend/utils/milkTestResolvers.ts` resolves core parameters using candidate matchers (`isLrTestCandidate`, `isFatTestCandidate`).
- **Ambiguity & Ratio Rejection**: Calculated ratio tests (e.g. SNF-to-Fat ratio) are excluded from Fat candidates. If 0 candidates or >1 candidates exist for LR or Fat, resolution fails closed and session completion is rejected.
- **Manual Input Prohibition**: Client requests attempting to submit manually calculated metrics (`density`, `gross_liters`, `snf`, `ts`, `at_13ts_liters`, `calculation_version`) are rejected by the backend.

### 19D. Supervisory Corrections & Historical Safety
- **Manager Correction**: ZMCC Managers (up to 5 saves) and Super Admins (unlimited) can correct `quantity_value`, `quantity_unit`, and test results on completed sessions.
- **Atomic Recalculation**: Derived metrics (`density`, `gross_liters`, `snf`, `ts`, `at_13ts_liters`) are recalculated atomically within the database transaction using the canonical formula engine.
- **Immutable Historical Records**: Completed sessions created prior to Stage 6G-C retain NULL metrics (`quantity_value`, `quantity_unit`, `density`, `gross_liters`, etc.) as a valid historical state. Synthetic data is never backfilled.
- **Database Migration**: Exactly 1 tracked migration `20260912210000_zmcc_final_milk_metrics` (repository migration count: 21).

---

## 20. Stage 6G-D ZMCC Tank Receipt & Immutable Inventory Ledger

### 20A. Domain Isolation & Dedicated Data Model
- **Strict Domain Separation**: ZMCC Tank storage and inventory are completely separate from Plant Silo and Unloading storage models. Plant `Silo`, `SiloInventoryTransaction`, `UnloadingLog`, and `VehicleVisit` are NEVER reused or referenced by ZMCC chillers.
- **Physical Gross Liters Only**: Physical tank inventory is strictly tracked in Gross Liters. Total Solids (@13% TS) is an accounting/commercial metric and is NEVER mixed into physical tank stock or capacity validation.
- **Dynamic Stock Aggregation**: Tank physical stock is strictly computed dynamically from the ledger: `SUM(RECEIPT) + SUM(ADJUSTMENT_IN) - SUM(ISSUE) - SUM(ADJUSTMENT_OUT)`. There is NO cached or redundant mutable `current_stock` column on `ZmccTank`.

### 20B. ZMCC Tank Master (`ZmccTank`)
- **Management Authority**: Managed exclusively by `SUPER_ADMIN` (Create, Update name/capacity, Toggle `is_active`).
- **Read Scoping**: Read-only access for `ZMCC_MANAGER` and `ZMCC_LAB_ATTENDANT`, strictly scoped to their assigned ZMCC (or all ZMCCs for `SUPER_ADMIN`).
- **Uniqueness & Constraints**: `[zmcc_id, tank_code]` is unique. `capacity_liters` must be strictly positive (`> 0`).

### 20C. ZMCC Tank Receipt (`ZmccTankReceipt`)
- **1-to-1 Lifecycle Snapshot**: Exactly one `ZmccTankReceipt` per `ZmccLabSession` when `decision = 'ACCEPTED'`. REJECTED sessions NEVER generate a tank receipt or ledger entry.
- **Authoritative Operational Snapshot**: Stores an operational snapshot of reception metrics (`quantity_value`, `quantity_unit`, `density`, `gross_liters`, `lr`, `fat`, `snf`, `ts`, `at_13ts_liters`, `calculation_version`). When an authorized supervisory correction updates measured parameters, the receipt snapshot is synchronized with the new metrics. Permanent immutable accounting history is maintained in the ledger (`ZmccTankInventoryTransaction`) and `AuditLog`.
- **Receiving Audit**: Tracks `received_at` and `received_by_user_id`.

### 20D. Immutable Inventory Ledger (`ZmccTankInventoryTransaction`)
- **Transaction Types**:
  - `RECEIPT`: Milk received from accepted lab session into tank.
  - `ISSUE`: Milk dispatched from tank (reserved for Stage 6G-E Dispatch).
  - `ADJUSTMENT_IN`: Positive volume correction from supervisory audit.
  - `ADJUSTMENT_OUT`: Negative volume correction from supervisory audit.
- **Immutability & Audit**: Ledger rows are append-only and cannot be updated or deleted. Every row tracks `quantity_liters`, `operational_timestamp`, `performed_by_user_id`, `idempotency_key`, and optional `notes`.

### 20E. Automatic "Accept & Receive" Workflow in `completeSession`
- **Atomic Execution**: When finalizing a lab session with `decision = 'ACCEPTED'`, the session completion, tank receipt creation, and ledger transaction creation occur within a single database transaction.
- **Destination Tank Resolution**:
  - 0 active tanks in ZMCC -> Fails closed with HTTP 400 (`"No active ZMCC tank is configured."`).
  - Exactly 1 active tank in ZMCC -> Auto-selected as the sole destination tank.
  - >1 active tanks in ZMCC (defensive guard) -> Fails closed with HTTP 400 (`"Configuration error: Multiple active tanks found for this ZMCC. Only one active tank is permitted."`).
- **Concurrency & Capacity Guard**: The selected tank row is locked `FOR UPDATE`. Inside the transaction, the tank is revalidated to ensure `is_active = true` and `zmcc_id = session.zmcc_id` (fails closed with HTTP 400 `"Destination ZMCC tank is inactive."` if deactivated concurrently). Real-time physical stock is aggregated under lock. If `gross_liters > (capacity_liters - current_stock)`, transaction fails closed with HTTP 400 (`"Tank capacity is insufficient..."`).

### 20F. Supervisory Corrections & Adjustment Transactions
- **Decision Safety Guards**:
  - `ACCEPTED -> REJECTED`: Prohibited once a tank receipt exists. Fails closed with HTTP 400 (`"Decision cannot be changed after milk has been received into a ZMCC tank."`). Tank receipts, ledger rows, and correction counts remain untouched.
  - `REJECTED -> ACCEPTED`: Prohibited in supervisory correction. Accepting milk carries physical tank receipt consequences and must go through the authorized Lab Attendant "Accept & Receive" workflow. Fails closed with HTTP 400 (`"Decision cannot be changed from REJECTED to ACCEPTED in correction."`).
- **Recalculation Delta Handling**: When a manager or super admin corrects quantity or quality parameters on a completed session with a tank receipt:
  - `delta > 0`: Creates an `ADJUSTMENT_IN` transaction for `+delta` L, verifying remaining tank capacity under lock.
  - `delta < 0`: Creates an `ADJUSTMENT_OUT` transaction for `|delta|` L, verifying that `current_stock >= |delta|` to prevent negative tank inventory.
  - `delta == 0`: Updates the tank receipt quality/metric snapshot; NO zero-volume ledger entry is created.
- **Receipt Snapshot Synchronization**: Updates `ZmccTankReceipt` metrics, `last_corrected_at`, `last_corrected_by_user_id`, and bumps correction counts.

### 20G. Controlled Historical Pre-6G-D Session Receipt
- **Authority**: Restricted to `ZMCC_LAB_ATTENDANT` (scoped to assigned active ZMCC) or `SUPER_ADMIN` (global override). `ZMCC_MANAGER` has read-only visibility into tanks and is strictly forbidden from historical receipt (HTTP 403).
- **No Fake Quality Fallbacks**: Core LR and Fat must be authoritatively resolved from frozen `ZmccLabResult` records via `resolveCoreMilkTestResults(...)`. If missing, ambiguous, or non-numeric, fails closed with HTTP 400 (`"Historical session does not contain authoritative LR/Fat values required for tank receipt."`). Synthetic defaults (e.g. 30 / 4) or derived values are never fabricated.
- **Authoritative Stage 6G-C Snapshot Required**: Requires stored non-null `quantity_value`, `quantity_unit`, `density`, `gross_liters`, `snf`, `ts`, `at_13ts_liters`, and non-empty `calculation_version`. If any are missing, fails closed with HTTP 400.
- **Stored Snapshot Verbatim**: Copies the stored historical metrics directly into `ZmccTankReceipt` without recalculation or defaulting `calculation_version` to `'1.0'`.
- **Active Tank Validation Under Lock**: Destination tank is locked `FOR UPDATE` and revalidated `is_active = true` and `zmcc_id = session.zmcc_id`.
- **Database Migration**: Exactly 1 tracked migration `20260913120000_zmcc_tank_receipt_and_ledger` (repository migration count: 22).

### 20H. HTTP Authentication Security
- **Canonical Signed Session Only**: Real HTTP requests must authenticate exclusively via signed session cookies / Bearer tokens verified by `getCurrentUser(req)`.
- **Zero Trust for Identity Headers**: Arbitrary headers like `x-user-id` are never trusted or parsed for HTTP authentication (returns HTTP 401 Unauthorized if no valid signed session exists). Internal testing may pass trusted `User` objects directly to backend service functions.

---

## 21. Stage 6G-D.1 Contractor RMR & Single Active ZMCC Tank Alignment

### 21A. Contractor RMR vs. System ZMCC Token
- **Contractor RMR Authority**: Contractor RMR/business token is manually entered by the PHE Operator from the physical slip/ticket.
- **Mandatory Submission & Numeric Digits Rule**: `rmr_number` is strictly required upon recording a Contractor arrival at ZMCC. Physical contractor RMR numbers are strictly numeric digits (`/^[0-9]+$/`), stored as a string (`VARCHAR(100)`), preserving any leading zeros (e.g. `"002345"`). Submissions without `rmr_number`, with blank values, or containing non-digit characters fail closed with HTTP 400 (`"rmr_number must contain digits only."`).
- **Database Defense-in-Depth**: Enforced at the database level by check constraint `zmcc_contractor_arrival_rmr_digits_check CHECK ("rmr_number" ~ '^[0-9]+$')` and `NOT NULL`.
- **String Identity Preservation**: Contractor RMR is never cast to a number or BigInt. `"002345"` and `"2345"` are preserved verbatim and treated as distinct identifier values.
- **ZMCC Token Independence**: Contractor RMR is separate from generated ZMCC token. The generated system ZMCC token is immutable.
- **MOT RMR Equivalence**: MOT route_milk_token remains MOT RMR/business token.
- **Supervisory Corrections**:
  - PHE cannot edit after submission.
  - Authorized ZMCC_MANAGER own-ZMCC / SUPER_ADMIN correction remains audited with mandatory reason (at least 5 characters).
  - Corrected `rmr_number` must also satisfy the digits-only rule (`/^[0-9]+$/`, max 100 characters).
  - All corrections are logged to `AuditLog` capturing previous and new `rmr_number`.
  - The internal `zmcc_token` remains strictly immutable across all corrections.

### 21B. Exactly One Active Tank Per ZMCC
- **Single Active Tank Rule**: Each ZMCC chiller facility is permitted to have **at most one active tank** (`is_active = true`) at any given time.
- **Database Partial Unique Index**: Enforced at the database level by the partial unique index `zmcc_tank_one_active_per_zmcc_idx` ON `zmcc_tank (zmcc_id) WHERE is_active = TRUE`.
- **Administrative Constraints**:
  - Attempting to create a new tank with `is_active = true` when an active tank already exists for that ZMCC fails closed with HTTP 400 (`"An active tank already exists for this ZMCC. Only one active tank is permitted per ZMCC."`).
  - Attempting to activate an inactive tank (`is_active: true`) when another active tank already exists fails closed with HTTP 400 (`"An active tank already exists for this ZMCC. Deactivate the current active tank before activating another."`).
  - Inactive historical or decommissioned tanks are permitted without limitation, provided `is_active = false`.
  - Capacity increases are accomplished by editing the capacity (`capacity_liters`) of the sole active tank, not by adding a second active tank.
- **Operational Reception Behavior**:
  - In "Accept & Receive" (`completeSession`) and historical receipt (`receiveHistoricalSession`), the system automatically resolves the sole active tank for the ZMCC. Operators do not choose between multiple active tanks.
  - If 0 active tanks exist: fails closed with HTTP 400 (`"No active ZMCC tank is configured."`).
  - If >1 active tanks exist (defensive code guard): fails closed with HTTP 400 (`"Configuration error: Multiple active tanks found for this ZMCC. Only one active tank is permitted."`).
  - Gross Liters remains the sole inventory basis for tank capacity and ledger balance calculations.
- **Database Migration**: Exactly 1 tracked migration `20260914100000_contractor_rmr_and_single_active_tank` (repository migration count: 23).

---

## 22. Stage 6G-D.2 User Email Foundation

### 22A. Canonical User Email Field & Normalization
- **Column Definition**: `users.email` is stored as `VARCHAR(254)`, nullable in the database for backward compatibility with historical seed/legacy accounts created prior to Stage 6G-D.2.
- **RFC 5321 Conformity**: Valid emails conform to standard email regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) and must not exceed 254 characters.
- **Deterministic Normalization**: All email values are trimmed and converted to lowercase (`trim().toLowerCase()`) before validation, uniqueness checking, and database persistence.
- **Database Partial Unique Index**: Case-insensitive uniqueness is enforced at the database level by PostgreSQL index `users_email_lower_uidx` on `LOWER("email") WHERE "email" IS NOT NULL`.
- **Historical Null Coexistence**: Multiple legacy/retired accounts with `email IS NULL` coexist without violating the unique constraint.

### 22B. Account Lifecycle & Administrative Governance
- **Mandatory on New Account Creation**: `POST /api/super-admin/users` strictly requires a non-empty, valid email address. Submissions missing an email, with empty/blank email, or with invalid format fail closed with HTTP 400.
- **Duplicate Prevention**: Attempting to create an account with an email already assigned to another user (case-insensitively) fails closed with HTTP 400 (`"Email \"...\" is already registered to another user."`).
- **Super Admin Email Updates**: Super Admin can update an existing account's email via `PATCH /api/super-admin/users/[id]`. The new email is validated, normalized, and checked for cross-account uniqueness.
- **Email Deletion Blocked**: Once set, an email address cannot be cleared or set to empty/null (fails closed with HTTP 400 `"Email address cannot be empty or cleared."`).
- **Legacy Inactive Activation Safety**:
  - Inactive accounts with `email === null` **cannot** be activated (`isActive: true`) without providing a valid email address.
  - Activation requests for an account lacking an email fail closed with HTTP 400 (`"Cannot activate user without a valid email address."`).
  - An inactive account can be activated and assigned an email in the same operation by including a valid `email` alongside `isActive: true`.
- **Legacy Active Edit Permissibility**: Active legacy accounts that currently have `email === null` can update non-email metadata (such as name or role) without failing or being forced to provide an email immediately.
- **Full Audit Trail**: `AuditLog` records all email additions (`USER_CREATED`), modifications (`USER_UPDATED`), and activations (`USER_ACTIVATED`), capturing previous and new email values.
- **Canonical Development Seed Policy**:
  - Development dummy fixtures declare explicit unique `@example.com` addresses directly on each record in `USERS_SEED` (e.g. `admin.superuser@example.com`, `phe.operator@example.com`).
  - `@gmail.com` and random/guessed real-company domains are strictly forbidden for dummy accounts.
- **Development Fixture Reset vs Production Migration**:
  - Development/test dummy data may be reset and rebuilt at any time during active development using safe DB reset scripts.
  - Production migrations must NEVER assume historical data is dummy, must NEVER fabricate or delete real user email identity, and must NEVER contain destructive data cleanups (`DELETE FROM users;`, `TRUNCATE users;`).
  - If historical users with unknown emails exist in production, their emails remain `NULL`.
- **Seed Idempotency Preservation**:
  - Seed creation (`prisma/seed.ts`) populates emails for new accounts.
  - Rerunning seed preserves existing user email values (whether populated or `NULL`) and never overwrites them.
- **Unique Error Classification**:
  - Prisma error `P2002` distinguishes between email collision (`users_email_lower_uidx`), username collision (`users_username_key`), and unknown unique conflicts. A duplicate username is never mislabeled as a duplicate email.
- **Strict Boundary Non-Goals**: Email verification, SMTP sending, automated notifications, subscriptions, and email-based login are deferred to subsequent stages and strictly prohibited in Stage 6G-D.2.
- **Database Migration**: Exactly 1 tracked migration `20260914160000_user_email_foundation` (total repository migration count: 24).

---

## 23. Stage 6G-D.3 ZMCC Local Supplier Directory & PHE Gate Workflow

### 23A. Plant Contractor vs. ZMCC Local Supplier Operational Domains
- **Formal Plant Contractor**: Managed centrally via `ProcurementSource` with `source_type = 'CONTRACTOR'`. Supplies milk DIRECTLY TO THE PLANT. Managed by Contractor Manager / Contractor Operator roles. Not a ZMCC local supplier; formal Plant Contractor master and workflows remain separate and unaffected.
- **ZMCC Local Supplier**: Any entity supplying milk DIRECTLY TO A ZMCC. Staff colloquial terms ("ZMCC contractor", "local contractor", "local supplier") refer to the single canonical business concept: **Local Supplier** (`ZmccLocalSupplier`).
- **Canonical Model for All New Direct-to-ZMCC Intake**: All new direct-to-ZMCC supply must be recorded as `ZmccLocalSupplier` and `ZmccLocalSupplierArrival`. There is only ONE active direct-to-ZMCC supply concept.

### 23B. Retirement of New ZMCC Contractor Arrival Creation
- **Historical Compatibility Only**: Existing `ZmccContractorArrival` records remain fully readable, searchable, and auditable. Historical in-progress arrivals can complete Lab testing and accepted Tank receipts without stranding data.
- **Fail Closed for New Writes (HTTP 410 Gone)**: No role may create a new `ZmccContractorArrival`. `POST /api/zmcc/arrivals/contractor` fails closed with HTTP 410 Gone and exact message: `"ZMCC Contractor Arrival is retired for new intake. Record direct-to-ZMCC suppliers through Local Supplier Arrival."`
- **PHE UI Simplified**: The active Contractor Arrival tab is removed from the PHE ZMCC Arrivals UI. Active intake choices are strictly **MOT Arrival** and **Local Supplier Arrival**.

### 23C. ZMCC Local Supplier Directory (`ZmccLocalSupplier`)
- **ZMCC Multi-Tenant Isolation & Role Allowlist**: Local suppliers belong strictly to their assigned ZMCC facility (`zmcc_id`).
  - Scoped roles (`PHE_OPERATOR`, `ZMCC_MANAGER`) are strictly restricted to supplying `{ name, phone, cnic, erp_reference }`. Supplying `zmcc_id` or `target_zmcc_id` is rejected with HTTP 400 (even if matching the user's assigned ZMCC). Scoping is derived solely from `auth.effectiveZmccId`.
  - `SUPER_ADMIN` requires an explicit, active `zmcc_id` in the payload (HTTP 400 if omitted).
- **Sequential Code**: Allocated via atomic PostgreSQL sequence `zmcc_local_supplier_code_seq`, formatted as `ZLS-000001` (6-digit zero-padded). Race-safe, immutable, client cannot supply it.
- **Mandatory Name**: `name` is required, trimmed, non-blank, max 150 characters.
- **Optional Contact Metadata**:
  - `phone`: Optional string (max 50). Validated against standard phone format.
  - `cnic`: Optional string (max 50). Validated against 13-digit CNIC format.
  - Blank or whitespace optional fields coerce to `NULL`.
- **Candidate ERP Reference (Pending Verification)**:
  - `erp_reference` is candidate/evidence data only (`VARCHAR(100)` text).
  - Leading zeros (e.g. `"00045231"`, `"00-2345"`) are preserved verbatim.
  - Blank/unknown values must be `NULL`.
  - Placeholder values are strictly rejected with HTTP 400 (`'New'`, `'Pending'`, `'Unknown'`, `'N/A'`, `'NA'`, `'TBD'`, `'None'`, `'Not Available'`, `'Not Known'`, `'-'`).
  - Status is locked to `erp_mapping_status = 'PENDING'` (enforced by DB check constraint `zmcc_local_supplier_erp_mapping_status_check`).
  - Mapping to the future canonical **Global ERP Source Master** is deferred to **Stage 6G-H** (NOT Stage 6G-E).
- **Role Permissions**:
  - `PHE_OPERATOR`: Can search active local suppliers and fast-create missing suppliers for own assigned ZMCC. Cannot edit or deactivate suppliers (HTTP 403).
  - `ZMCC_MANAGER`: Can create, edit (`name`, `phone`, `cnic`, `erp_reference`), and toggle `is_active` for own assigned ZMCC.
  - `SUPER_ADMIN`: Can manage suppliers across ZMCCs with explicit active target ZMCC.

### 23D. Canonical Local Supplier Arrival (`ZmccLocalSupplierArrival`)
- **Independent Domain Model**: Modeled independently via `ZmccLocalSupplierArrival` (`zmcc_local_supplier_arrival`), referencing `local_supplier_id`.
- **Mandatory RMR & Numeric Digits**: `rmr_number` is required from physical slip, digits only (`/^[0-9]+$/`), max 100 chars, preserving leading zeros (enforced by check constraint `zmcc_local_supplier_arrival_rmr_digits_check`).
- **Normalized Vehicle**: `vehicle_number` is trimmed, uppercased, and internal whitespace collapsed.
- **Replay Idempotency**: `client_event_id` with unique database index. Exact replay returns HTTP 200 with `is_replay: true`; mismatched payload returns HTTP 409 Conflict.
- **Daily Sequence Token**: Format `ZT-LS-<YYYYMMDD>-<sequence>` based on Pakistan calendar day (`Asia/Karachi`), sequence allocated atomically.
- **Supervisory Corrections**:
  - PHE Operators cannot edit submitted arrivals.
  - `ZMCC_MANAGER` (assigned ZMCC) or `SUPER_ADMIN` can correct editable fields (`local_supplier_id`, `rmr_number`, `vehicle_number`, `arrival_timestamp`, GPS coordinates) via `PATCH /api/zmcc/arrivals/local-supplier/[id]`.
  - Mandatory `reason` (minimum 5 characters). Max 2 corrections permitted. System token is immutable.
  - Audit trail recorded in `AuditLog` (`ZMCC_LOCAL_SUPPLIER_ARRIVAL_CORRECTED`).

### 23E. PHE ZMCC Gate Workflow & Gate Exit
- **Gate Entry**: The existing arrival submission (`arrival_timestamp`) IS the authoritative ZMCC Gate Entry timestamp. Uses normal Pakistan calendar time. NO Plant 08:00 AM business-day cutoff.
- **Gate Exit Schema**: Both `zmcc_mot_arrival` and `zmcc_local_supplier_arrival` track gate exit via:
  `gate_exit_required` (Boolean, default true), `exit_timestamp` (Timestamp, nullable), `exit_recorded_by_user_id` (BigInt FK, nullable), `exit_client_event_id` (VarChar unique, nullable), `exit_submitted_at` (Timestamp, nullable), `exit_correction_count` (Int, default 0).
- **Historical Cutover & Rejection of Pre-Cutover Gate Exit**:
  - Pre-feature historical arrival rows have `gate_exit_required = false`.
  - Migration #26 does NOT fabricate exit timestamps or guess historical departure times.
  - Recording gate exit on an arrival with `gate_exit_required !== true` fails closed with HTTP 409 Conflict (`GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL`). Pre-feature arrivals cannot be given fabricated exits.
  - All new arrivals created after feature activation have `gate_exit_required = true` and `exit_timestamp = null` while inside ZMCC.
- **Atomic Concurrency & Row Locking**:
  - Gate exit recording executes within a PostgreSQL transaction using parameterized `SELECT ... FOR UPDATE` row-level locking on `zmcc_mot_arrival` / `zmcc_local_supplier_arrival`.
  - Under the lock, arrival state is re-read authoritatively. If already exited:
    - Same `exit_client_event_id` + same `exit_timestamp`: returns HTTP 200 with `is_replay: true` without writing changes or duplicate audit rows.
    - Differing `exit_client_event_id` or timestamp: fails closed with HTTP 409 Conflict (`ALREADY_EXITED` or `IDEMPOTENCY_CONFLICT`).
  - Arrival exit update and `AuditLog` row (`ZMCC_MOT_GATE_EXIT_RECORDED` or `ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED`) are committed atomically within the same transaction.
- **Gate Exit Eligibility Rule**:
  - Gate exit can only be recorded after ZMCC Lab session is `COMPLETED`.
  - If milk is `ACCEPTED`: requires `ZmccTankReceipt` to exist. Attempting exit without tank receipt fails closed with HTTP 409 Conflict (`CANNOT_EXIT_ACCEPTED_WITHOUT_RECEIPT`).
  - If milk is `REJECTED`: gate exit is permitted immediately upon completed rejection.
  - No Lab session or in-progress Lab session fails closed with HTTP 409 Conflict (`LAB_NOT_COMPLETED`).
- **Gate Exit Chronology**: `exit_timestamp >= arrival_timestamp` and `exit_timestamp >= lab.completed_at`. Arrival corrections for exited vehicles must satisfy `arrival_timestamp <= exit_timestamp`.
- **Gate Exit Supervisory Correction**: `PATCH /api/zmcc/arrivals/mot/[id]/exit` and `PATCH /api/zmcc/arrivals/local-supplier/[id]/exit` permit `ZMCC_MANAGER` (own ZMCC) or `SUPER_ADMIN` to correct `exit_timestamp` with mandatory `reason` (minimum 5 characters), max 2 corrections, fully audited (`ZMCC_MOT_GATE_EXIT_CORRECTED`, `ZMCC_LOCAL_SUPPLIER_GATE_EXIT_CORRECTED`).
- **Vehicles Inside ZMCC (Bounded Server Query)**:
  - `GET /api/zmcc/arrivals/inside` returns vehicles where `gate_exit_required = true AND exit_timestamp IS NULL` for the user's assigned ZMCC across MOT and Local Supplier arrivals. Excludes historical contractor arrivals and exited vehicles.
  - Hard capped at a maximum limit of 100 per call (default 100).
  - Returns envelope `{ vehicles, items, limit, total_count, has_more }`.
  - The PHE workspace displays an alert banner when `has_more` is true to signal display truncation.
- **MOT Vehicle Physical Availability**: While an MOT journey completes at ZMCC Gate Entry, physical vehicle availability is tracked separately. A vehicle with an active gate-tracked arrival (`gate_exit_required = true AND exit_timestamp IS NULL`) cannot be assigned to or dispatched on a new journey (HTTP 409 Conflict). Recording Gate Exit immediately restores vehicle availability for dispatch. Historical `gate_exit_required = false` arrivals do not block reuse.
- **Deactivation Continuity**: Deactivating a Local Supplier blocks new arrival creation, but existing recorded arrivals proceed normally through Lab testing, Tank receipt, and Gate Exit without stranding.
- **Database Migrations**:
  - Migration #25: `20260915100000_zmcc_local_supplier_directory_and_arrival` (restored byte-for-byte to base HEAD `5c05973538b4f90e69abffeb45370e6e671f0521`).
  - Migration #26: `20260915120000_zmcc_gate_exit_and_canonical_local_supplier` (adds gate exit schema, cutover, and `zmcc_local_supplier_erp_mapping_status_check`).
  - Total repository migration count: **exactly 26**.

---

## 24. Stage 6G-D.4A Operational UI Data Retrieval & History Scalability

### 24A. Canonical Retrieval Modes
Data retrieval for operational records is strictly classified into four conceptual modes:
1. **`LIVE`**: Open, actionable operational records currently in progress (e.g. dispatched, token issued, in QA, weighing, unloading, awaiting exit).
   - Server-side scoped by role and assigned source.
   - Bounded with a hard maximum of 100 records per query.
   - May poll on a controlled interval (e.g. ~15 seconds) if operationally justified.
   - Excludes completed historical records and cancelled/retired states.
2. **`RECENT_HISTORY`**: Completed operational history for day-to-day supervision.
   - Default date range is strictly the **last 7 calendar days** (today and preceding 6 days).
   - Paginated server-side (default `pageSize: 20`, max `pageSize: 100`).
   - Background polling is strictly forbidden.
3. **`SEARCH`**: Targeted historical lookup across arbitrary date ranges.
   - Filtered and searched server-side in PostgreSQL using authoritative domain identifiers (vehicle number, token, RMR, local supplier code/name, visit number, etc.).
   - Can query older than 7 calendar days.
   - Server-side paginated; client-side filtering of complete history in React is forbidden.
4. **`REPORT`**: Frozen interface contract for analytical summaries and bulk extractions.
   - Dedicated heavy reporting, reporting SQL views, materialized views, and dynamic server-side Excel generation are deferred to **Stage 6G-M**.
   - Bulk Excel generation, reporting views, and Elasticsearch are not implemented in Stage 6G-D.4A.

### 24B. Standard Pagination Envelope
All paginated collection APIs must return a standardized pagination envelope:
```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalRecords": 0,
    "totalPages": 1
  },
  "serverBusinessDate": "YYYY-MM-DD",
  "metadata": {
    "serverBusinessDate": "YYYY-MM-DD",
    "serverTimestamp": "..."
  }
}
```
- Default `page`: `1` (1-indexed).
- Default `pageSize`: `20`. Maximum `pageSize`: `100`.
- When `totalRecords === 0`, `totalPages` is consistently `1` (or `0` when empty, but UI/API contracts must handle gracefully without division-by-zero).
- Changing filters, date ranges, or search terms must reset client state to `page = 1`.
- Silent hard limits without pagination metadata (e.g. silent `take: 50` or `take: 100`) are forbidden.

### 24C. Bounded Database Query & Anti-Load-All Rule
- Unrestricted `prisma.vehicleVisit.findMany(...)` or unbounded memory-mapping of operational records is strictly prohibited.
- Filtering, date-range bounding, and pagination (`skip`/`take`) must occur at the database level before loading models into Node memory.
- Source scoping and role authorization must remain database-side and fail-closed.
- List endpoints must project only the relations and fields required for display cards and tables. Rich deep detail must be fetched on demand when opening a record detail view (`getOperationalLogById`).

### 24D. Dashboard KPI Calculation Rule
- Dashboard KPI cards cannot claim a period, daily, or all-time total if calculated solely from the visible page.
- Aggregates must be computed at the database level (via `count`, `aggregate`, or `groupBy`) or explicitly labeled as scoped to the currently displayed filtered date range.
- Loading thousands of records into browser React state simply to sum them is strictly forbidden.

### 24E. Authoritative Time & Business Date Boundaries
- **Plant Business Date**: 08:00 AM cutoff applies **only at authoritative Plant Gate Exit** (`VehicleVisit.operational_date`).
- **No `created_at` Fallback**: `created_at` is a system audit timestamp and must never be used as a Business Date fallback.
- **Upstream Facilities**: ZMCC, MOT, Local Supplier, and Dispatch operational dates strictly use Pakistan calendar dates (`Asia/Karachi`).

### 24F. Source of Truth & Future Elasticsearch Boundary
- PostgreSQL remains the sole authoritative source of truth for all operational data, transactions, and audit logs.
- Elasticsearch, if introduced in future architectural stages, will exist solely as an asynchronous, read-only search projection fed via outbox / CDC. Elasticsearch will never be authoritative and will never be a synchronous dependency for operational intake or gate workflows.
- No Elasticsearch dependencies, clients, or configuration are permitted in Stage 6G-D.4A.

---

## 25. Development Demo Data Contract
- **Development-Only**: Operational demo data is strictly development-only. Production environments must never receive development demo records.
- **Safety Gates**: Demo seed and reset operations are strictly guarded by double gates: abort when `NODE_ENV === 'production'` and require `ALLOW_DEMO_RESET=true`. Both gates must be preserved in all seeding/resetting tools.
- **Single Reusable Infrastructure**: Operational demo data must be managed through the canonical seed and reset scripts (`scripts/seed_demo_operational_data.ts` and `scripts/reset_demo_operational_data.ts`). Do not create parallel seeding systems or pollute `prisma/seed.ts` (which remains reserved for master/reference data and system users).
- **No Frontend Fake Rows**: Frontend components must never create fake fallback rows or dummy placeholders to mask empty database states or API errors. Real role screens must display real PostgreSQL records via real services and APIs.
- **Evolution with Canonical Rules**: When a subsequent stage evolves a business rule, formula, lifecycle, role, terminology, schema relationship, or source authority, earlier demo data must be updated to align with the new canonical rules.
- **Definition of Done**: Meaningful, deterministic development demo data covering normal journeys and important exception cases for affected screens is a mandatory Definition-of-Done requirement for every implementation stage.

---

## 26. Stage 6G-E — Canonical Dispatch Quantity, Tank-Issue Truth & Dispatch Date Semantics
- **Authoritative Whole-Vehicle Measurement**: Whole-vehicle dispatch quantity (`VehicleVisit.vehicle_dispatch_quantity_*`) is strictly an authoritative measured fact (`vehicle_dispatch_quantity_basis = 'MEASURED'`). In ZMCC environments, this represents the measured tank / bulk issue from calibrated dipsticks or mass flow meters.
- **Portion Independence**: Composite portions represent independent collection facts and may be either `MEASURED` or `ESTIMATED`.
- **Anti-Derivation Invariant**: `Vehicle Issue = Sum(Portions)` is forbidden. Whole-vehicle quantity must never be derived, auto-prefilled, or overwritten from portion totals.
- **Reconciliation Transparency**: The dispatch summary displays Measured Vehicle Issue, Portion Total (labeled Estimated or Measured according to portion basis), and Difference (`Vehicle - Portions`) for comparison only. Any variance is an informational operational truth, never a validation error.
- **Dispatch Date Truth**:
  - Dispatch history date filters query `DispatchInfo.dispatch_timestamp` in Pakistan calendar date (`Asia/Karachi`), NOT `VehicleVisit.created_at` and NOT `VehicleVisit.operational_date`.
  - Serialized dispatches expose `dispatch_date` (PKT calendar date) and `dispatch_timestamp`.
  - `operational_date` strictly remains `null` until Plant Gate Exit completion (`READY_FOR_GATE_EXIT -> COMPLETED`).
  - Misleading UI badges such as fake "Live" indicators or fallback defaults (`operational_date || 'Today'`) are strictly prohibited.

