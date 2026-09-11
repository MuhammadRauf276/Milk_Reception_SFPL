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

## 4. Stage 4C-5 Quantity Contract

### 4A. Vehicle Dispatch Quantity
- `VehicleVisit` remains the sole authoritative whole-vehicle Dispatch Quantity.
- Model fields: `Value`, `Unit` (`KG` or `LITER`), `Basis` (`ESTIMATED` or `MEASURED`).
- Independently editable; Vehicle Unit and Basis do NOT have to match portion Unit and Basis (e.g. Vehicle `19,500 KG MEASURED` with Portions `9,800 LITER ESTIMATED` and `9,150 LITER ESTIMATED` is completely valid without forced conversion).

### 4B. Portion Quantity Profile
- Portion 1 establishes the shared portion `Unit` and `Basis` for all portions of that vehicle.
- Portions 2, 3, etc. automatically inherit Unit and Basis from Portion 1 and cannot independently contradict Portion 1.
- The numeric quantity `Value` remains independent per portion.
- **Unit Change Guard**: If the shared Unit/Basis is changed after quantities exist, old numbers must NOT be reinterpreted (e.g. `9,800 LITER` must not silently transform into `9,800 KG`). Changing Unit requires safe clear/re-entry.

### 4C. Portion Total
- Total Portion Quantity is calculated when all relevant portions have valid quantity values.
- If any portion quantity is missing, Total Portion Quantity is incomplete and unauthoritative (missing is NOT zero).

### 4D. Measured Vehicle Assistance
- If all portions have valid quantities AND the shared portion Basis is `MEASURED`, the Total Portion Quantity may assist/prefill an empty Vehicle Dispatch Quantity.
- `VehicleVisit` remains the authoritative field. Once manually edited by an operator, portions do NOT continuously overwrite vehicle quantity (no bidirectional auto-sync).

### 4E. Difference Display
- **Same Unit**: If Vehicle Unit == Portion Unit, `Difference = Vehicle Dispatch Quantity - Total Portion Quantity` (informational only; NO tolerance bands or hard blocks like ±50kg or ±1%).
- **Different Units**: If Vehicle Unit != Portion Unit, display: `"Different units — no direct comparison"` (never convert KG ↔ LITER merely for comparison).

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