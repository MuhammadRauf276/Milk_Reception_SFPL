# ADR-003: Configurable Qualitative Lab Result Options & Three-State Semantics

## Status
Accepted

## Context
Qualitative/categorical lab tests (e.g. Alcohol Test, COB, MBRT, Antibiotic) require configurable choices rather than hardcoded binary strings, while preserving clear evaluation semantics.

## Decision
1. **Metadata-Driven Configuration**:
   - Super Admins configure discrete qualitative result options (`value`, `label`, `isPassing`) for categorical test definitions.
   - Persisted on master test records in `LabTest.result_options` (Prisma property: `resultOptions`).
   - Raw exact `option.value` is stored in the database, while user-friendly `option.label` is displayed in the UI.

2. **Exact Three-State Evaluation Semantics**:
   - `isPassing = true`  -> **PASS** (Evaluated as Passing)
   - `isPassing = false` -> **FAIL** (Evaluated as Failing)
   - `isPassing = null`  -> **NEUTRAL / INFORMATIONAL** (No pass/fail classification)
   - Neutral options must never silently evaluate to PASS.

3. **Snapshot Preservation**:
   - Configured option sets are snapshotted into `LabTestAssignment.result_options_snapshot` at session creation.
   - In-flight sessions adhere strictly to their frozen snapshot.

4. **Contractor Accountability**:
   - Contractor dispatches default to `NOT_PERFORMED` with default reason `"Contract Vehicle"`.
   - When switched to `PERFORMED`, native metadata-driven radio buttons render unselected (`null`) by default.
   - Switching back to `NOT_PERFORMED` immediately clears selected values and restores the accountability reason.

5. **Accessible Radio Controls**:
   - Rendered using native `<input type="radio">` grouped under `role="radiogroup"`.
   - Accessible labels dynamically include the specific **Test Name** and **Portion Number** (e.g., `aria-label="Portion 1 Alcohol Test result"`).
   - Validation errors connect via `aria-describedby`.
