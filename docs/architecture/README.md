# Architecture Documentation & Engineering Governance

This directory contains the Architectural Decision Records (ADRs), governance standards, and Definition of Done for the Milk Reception Application.

---

## 1. Status of Architecture Records

All technical contributors, developers, and AI coding agents must understand the distinction between accepted and draft records:

- **Accepted ADRs**: Active, binding architectural standards. Must be followed strictly during all implementation and maintenance tasks.
- **Draft ADRs**: Candidate proposals under discussion. Marked as `STATUS: DRAFT — NOT IMPLEMENTED — NOT AUTHORITATIVE`. Must not be consumed as live business logic.

---

## 2. Index of Architecture Records

| Document | Title | Status | Summary |
| :--- | :--- | :--- | :--- |
| [ADR-000](./ADR-000-schema-workflow.md) | Schema Change Workflow | **Accepted** | Tracked Prisma migrations only; `db push` forbidden; controlled dev reset. |
| [ADR-001](./ADR-001-dispatch-vs-plant-quantity.md) | Dispatch vs Plant Quantity & Final Receipt | **Accepted** | Weighbridge Gross/Second mass, accepted QA averaging, Physical Liters vs 13 TS, multi-silo guard. |
| [ADR-002](./ADR-002-lab-test-assignment-snapshot.md) | Stable Lab Test Assignment & Snapshotting | **Accepted** | Session snapshot isolation; immutable in-flight tests; forward-only master updates. |
| [ADR-003](./ADR-003-configurable-lab-result-options.md) | Configurable Qualitative Options | **Accepted** | Metadata-driven options, Pass/Fail/Neutral semantics, accessible radio controls. |
| [ADR-004](./ADR-004-development-data-lifecycle.md) | Development Data Lifecycle | **Accepted** | Development data is disposable; no fake legacy compatibility states; test DB isolation. |
| [ADR-005](./ADR-005-numeric-precision-and-rounding.md) | Numeric Precision, Calculation Chains & Rounding | **Accepted** | Unrounded intermediate chains, canonical formula authority, display-only visual rounding. |

---

## 3. Core Engineering Invariants

1. **Development Data Lifecycle**: Current database records are development-only and disposable. No fake legacy compatibility columns/enums are created to preserve dummy records. Superseded runtime code is removed promptly once replacements are verified.
2. **Frozen Business Rules**: Core business calculations (intake mass, milk formulas, snapshotting, three-state evaluation, silo ledgers) are verified and frozen. They must not be reopened or casually refactored.
3. **Migration Discipline**: Persistent schema changes must be applied via tracked Prisma migrations (`prisma/migrations/`). `prisma db push` is removed from standard package scripts.
4. **Environment Portability**: All scripts and orchestration runners must resolve paths portably using `path.resolve` / `path.join` and avoid machine-specific paths (e.g. `D:/` or `C:/`).
5. **Git Worktree Discipline**: Never execute destructive git commands (`git reset --hard`, `git clean`, `git restore .`, `git stash`) against active worktrees. Distinguish baseline pre-existing work from stage deliverables.
6. **Stage Definition of Done**: Every stage must comply with [STAGE_CHECKLIST.md](./STAGE_CHECKLIST.md) before closeout.
