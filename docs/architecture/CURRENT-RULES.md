# Current Approved Business Rules (Current Truth)

This document records the authoritative business rules approved for the Milk Reception Application. It is not historical; it defines active engineering truth.

---

## 1. Business Date
- **Terminology**: User-facing term is **Business Date**.
- **Timezone**: `Asia/Karachi` (PKT, UTC+5).
- **Day Cutoff**: `08:00 AM` (shifts after 08:00 AM belong to the new Business Date).
- **Independence**: Event Date/Time and Audit Date/Time remain strictly separate timestamps.
- **Internal Storage**: Existing database column `operational_date` remains until a dedicated migration pass.

---

## 2. Dispatch Source Authority
- **Bound Operator**: Source-bound users automatically and immutably use their assigned `procurement_source_id`.
- **Unbound Operator / Admin**: Unbound authorized users must explicitly select an operating source from available active sources.
- **Zero Fallback**: Silent fallback to the "first active source" is strictly forbidden across frontend and backend.

---

## 3. Dispatch Draft Scoping & Lifecycle
- **Draft Key Scoping**: Client storage keys are strictly scoped: `mpd_active_draft_visit_id:<USER_ID>:<SOURCE_ID>`.
- **Server Validation**: Backend validates creator ownership (`created_by === user.id`), source match (`procurement_source_id === requestedSource`), and lifecycle status (`DRAFT_DISPATCH`).
- **Configuration Freeze**: Starting a Dispatch draft immutably freezes all required configuration snapshots (Lab Test Catalog and Quantity Policy) for the lifetime of that draft.

---

## 4. Dispatch Quantity (Architecture Target)
- **Separation**: Vehicle quantity and portion quantities are separate logical entities.
- **Unit Independence**: Vehicle and portion units are independent (KG or LITER).
- **Measurement Basis**: `ESTIMATED` or `MEASURED`.
- **Measurement Method**: `MANUAL_ESTIMATE`, `WEIGHING`, `FLOW_METER`, or `OTHER`.
- **Conversion Policy**: No automatic KG ↔ LITER conversion during dispatch creation.
- **Source Policy Engine**: Source-level Quantity Policy controls allowed combinations of units, bases, and methods.

---

## 5. Contractor vs. ZMCC Alignment
- **Quantity Policy**: Uses the exact same generic quantity policy architecture as ZMCC (no `if (source_type === 'Contractor')` branching in quantity rules).
- **Lab Accountability**: Contractor-specific behavior is strictly isolated to Dispatch lab testing accountability (default `NOT_PERFORMED` with reason "Contract Vehicle").

---

## 6. Plant Final Receipt
- **Vehicle-Wise Finalization**: Final Net KG is calculated strictly at the vehicle level as `Gross Weight - Second Weight (Tare)`.
- **Quality Averaging**: Accepted Plant QA quantitative results are averaged arithmetically across accepted compartments/portions.
- **No Fallback**: Zero fallback to Dispatch lab results or Dispatch quantities for plant inventory receipts.
- **Silo Allocation**: Multi-silo unallocated receipts remain blocked until explicit allocation.

---

## 7. User & Access Administration
- **Super Admin Exclusive**: Only Super Admin can create, edit, deactivate, or assign roles/sources to login accounts.
- **Source Managers**: Managers do NOT create or administer users.

---

## 8. Operational Corrections (Future)
- **Scope-Constrained**: Corrections will be permitted only within explicit permission boundaries and role scopes.
- **Immutable Evidence**: Any correction requires structured, immutable `AuditLog` evidence with rationale.
- **Current State**: Not implemented in Stage 4C-3.