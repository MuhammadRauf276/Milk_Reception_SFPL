# ADR-002: Stable Lab Test Assignment & Snapshotting

## Status
Accepted

## Context
Master lab test definitions (names, required flags, result types, sort order) may be modified by Super Admins over time. In-flight dispatches and QA sessions must remain stable and immutable once created.

## Decision
1. **Dispatch Session Snapshot**: When a dispatch is initiated, active master lab tests are atomically snapshotted into `LabTestAssignment` records (`workflow = 'DISPATCH'`) linked to the visit.
2. **Plant QA Session Snapshot**: When Plant QA begins testing, active Plant master tests are atomically snapshotted into `LabTestAssignment` records (`workflow = 'PLANT_QA'`).
3. **In-Flight Immutability**:
   - Subsequent activations, deactivations, renamings, or rule changes in master data do NOT mutate existing in-flight assignment snapshots.
   - Form inputs, validation rules, and payload verification adhere strictly to the visit's frozen assignment snapshot.
4. **Master Change Forward Scope**:
   - Master catalog mutations only apply forward to newly initiated visits.
5. **Historical Preservation**:
   - Historical test results and audit logs preserve original test names and result types indefinitely.
