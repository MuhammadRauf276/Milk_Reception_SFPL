# ADR-000: Schema Change Workflow

## Status
Accepted

## Context
The Milk Reception Application manages high-stakes dairy operations, financial calculations, physical silo inventories, and regulatory audit trails. Schema changes must be reproducible, auditable, safe against data loss, and protected against drift across development, CI, staging, and production environments.

## Decision
Tracked Prisma migrations (`prisma/migrations/`) are the sole authoritative mechanism for applying schema changes.

### Normal Allowed Operations
- `npx prisma migrate dev` — Generate and apply tracked migrations during local schema development.
- `npx prisma migrate deploy` — Apply pending tracked migrations in automated deployment pipelines and test database provisioning.
- `npx prisma migrate status` — Verify migration synchronization status against the active database.
- `npx prisma validate` — Validate the schema syntax and relational constraints.

### Forbidden Normal Workflows
- `prisma db push` — **FORBIDDEN** for normal development or deployment. Schema changes must never bypass tracked migration history.
- `prisma migrate reset` — **FORBIDDEN** against production, shared staging, or any database containing real operational data.

### Controlled Development-Phase Database Resets
- During the current development phase (per [ADR-004](./ADR-004-development-data-lifecycle.md)), `npx prisma migrate reset` **MAY** be used against the explicitly confirmed disposable **DEVELOPMENT database** when:
  1. The active stage explicitly authorizes a development reset;
  2. The target database identity is confirmed to be the local disposable development database;
  3. The reset is followed immediately by deterministic seeding (`prisma/seed.ts`);
  4. The reset is explicitly documented in stage reports and never executed silently.

### Database Environment Note
- Current local development operates against a local PostgreSQL instance.
- Deployment configurations (such as Neon serverless PostgreSQL referenced in `.env.example`) may have distinct connection pooling, SSL, and serverless lifecycle behaviors.
- Validation against local PostgreSQL does not automatically certify Neon-specific behaviors. Neon deployment readiness is evaluated separately prior to cloud deployment.

### Migration Immutability Rule
Tracked Prisma migrations (`prisma/migrations/`) are the sole authoritative mechanism for database schema changes. `prisma db push` is strictly **FORBIDDEN**.

Once a migration has been applied in shared, CI, staging, or operational migration history, its `migration.sql` bytes are strictly **immutable**.
Do not:
- re-encode it;
- strip BOM;
- reformat it;
- modify comments;
- edit DDL statements;
- manually update Prisma checksum metadata.

If an already-applied migration must be corrected:
You must use a **NEW tracked migration** (e.g. adding a subsequent migration).
Controlled development database reset (`npx prisma migrate reset`) is permitted **only** against explicitly confirmed disposable development/test databases per [ADR-004](./ADR-004-development-data-lifecycle.md).
**Crucial Governance Boundary**: A disposable database reset does **NOT** authorize rewriting, mutating, deleting, or reordering accepted migration history. The tracked migration sequence on disk remains permanent.

## Rationale
- **Reproducibility**: Migrations guarantee that every environment transitions through the exact same DDL history.
- **Drift Protection**: Prevents undocumented or out-of-band schema changes.
- **Safety**: Prevents accidental table drops or column truncations during active workflows.
- **Agent Governance**: Ensures automated coding assistants adhere to strict schema evolution discipline.

## Emergency Exceptions
Any manual schema intervention or exception must be explicitly reviewed, approved by the system owner, and documented with an architectural addendum.

