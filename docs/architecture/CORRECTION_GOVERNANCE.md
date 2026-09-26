# Correction governance

## Lifecycle

Operational records move through `DRAFT`, `SUBMITTED`, `APPROVED`, `CLOSED`, `FINANCIALLY_POSTED`, `SETTLED`, or `CANCELLED`.

Operators may edit only their own permitted draft records. After submission they request a correction with a reason. A manager may apply an eligible in-scope correction. A high-impact correction requires Head approval. Super Admin may exercise exceptional authority, but never removes the original evidence.

`FINANCIALLY_POSTED` and `SETTLED` records are financially locked. They use an adjustment, reversal, or superseding version; the historic record is not overwritten.

## Field policy

The policy is defined in `src/backend/modules/correction-governance/fieldPolicy.ts` and is intentionally module-specific.

| Module | Direct operator editing | Manager correction | High-impact fields |
|---|---|---|---|
| ZMCC Lab Session | Draft only | remarks, rejection reason, results, decision | results and decision |
| MOT Shop Collection | Draft only | remarks, quantity, lab result | quantity and lab result |
| ZMCC arrivals | Draft/submitted where applicable | gate exit and raw milk token | none in current allowlist |
| Vehicle Visit | Draft only | Raw Milk Dispatch Note and dispatch quantity | dispatch quantity |
| Local Supplier RMR issuance | Never after issue | cancellation workflow only | issuance status |

Derived values such as density, SNF, TS, gross liters, 13TS, stock balances, and payable values are never direct correction fields. A correction changes a permitted authoritative input and then invokes recalculation or an adjustment workflow.

## Audit event

Every correction event has an immutable event type, correlation ID, actor ID and role, source scope, timestamp, record module/ID/lifecycle, reason, resolution, and field-level before/after values. The initial implementation maps this payload to the existing append-only `AuditLog` model. A successful correction must write both the corrected record and its audit event in one transaction.

## Implementation boundary

The module is a foundation, not a replacement for working feature-specific correction flows. ZMCC Lab, MOT, arrivals, dispatch, and plant workflows must each adopt the transaction contract before they can claim full Phase 2 compliance. Tests remain deferred until the project-wide test pass requested by the product owner.
