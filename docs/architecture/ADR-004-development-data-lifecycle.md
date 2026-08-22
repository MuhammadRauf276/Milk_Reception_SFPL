# ADR-004: Development-Phase Data Lifecycle & Disposable Test Data

## Status
Accepted

## Context
The Milk Reception Application is currently in active development. There are no real production users, no live commercial financial transactions, and no historical operational data that must be preserved. Current operational and master data records in local databases consist solely of synthetic test, demo, and dummy records.

Applying production-grade schema migration complexity (such as multi-phase backward compatibility columns, temporary nullable transitions, or synthetic legacy enum states) during early development creates unnecessary technical debt and obfuscates the canonical domain model.

## Decision

1. **Development & Disposable Data Classification**:
   - All current transactional and operational database records are classified as **development-only and disposable**.
   - Preserving existing dummy records across fundamental architectural schema changes is **NOT required**.

2. **No Fictional Legacy Compatibility States**:
   - Future schema redesigns may cleanly remove obsolete tables, columns, or dummy records rather than inventing fictional compatibility states (e.g. `LEGACY_UNSPECIFIED`, `MIGRATED_UNKNOWN`, `OLD_VERSION_FALLBACK`) unless such states represent genuine business concepts.

3. **Controlled Development Database Resets**:
   - `prisma migrate reset` is permitted against the explicitly confirmed disposable **DEVELOPMENT database** only when:
     - The active development stage explicitly authorizes the reset;
     - The database identity is explicitly confirmed prior to execution;
     - The reset is followed immediately by deterministic automated seeding (`prisma/seed.ts`);
     - The reset is transparently documented in the stage report and never executed silently.

4. **Preserved Invariants**:
   - `prisma db push` remains strictly **FORBIDDEN** for normal development and deployment. Tracked Prisma migrations (`prisma/migrations/`) remain mandatory.
   - Destructive resets against production, staging, or any shared real-data environment remain strictly **FORBIDDEN**.
   - Automated testing regression suites must execute against an isolated **TEST database** (`TEST_DATABASE_URL`) to prevent test data pollution in the development UI.

5. **Formal Production Revocation Trigger**:
   - As soon as the application transitions to real operational users, live commercial transactions, or persistent historical data, the relaxed rules in this ADR **MUST be formally revoked** and replaced with rigorous production zero-downtime data-preservation policies.
