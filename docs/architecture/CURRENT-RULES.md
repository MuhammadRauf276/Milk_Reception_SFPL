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
- **Cutoff Boundary**: `08:00:00 AM Asia/Karachi` through `07:59:59 AM` next calendar day.
  - Example 1: `23-Aug 07:30 AM PKT` => Business Date `22-Aug`
  - Example 2: `23-Aug 08:00 AM PKT` => Business Date `23-Aug`
  - Example 3: `24-Aug 02:30 AM PKT` => Business Date `23-Aug`
  - Example 4: `24-Aug 08:00 AM PKT` => Business Date `24-Aug`
- **Data Type**: Business Date is **DATE-only** (YYYY-MM-DD).
- **Independence**: Event timestamps and Business Date remain strictly separate concepts. No fake shifted business timestamps are created.
- **Internal Storage**: Existing database column `operational_date` remains the storage field.

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