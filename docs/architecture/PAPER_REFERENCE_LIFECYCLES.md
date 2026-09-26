# Paper Reference Lifecycles

This document defines the business meaning and lifecycle of each physical paper reference. A paper number is never the database identity of its business record. Internal IDs remain immutable even when a paper is corrected, cancelled, or reprinted.

## Shared rules

- Store the internal record ID and the printed paper reference in separate fields.
- Preserve leading zeroes in every paper number.
- Issuance, correction, cancellation, duplicate detection, and reprint are audited events.
- Never delete or silently overwrite an issued reference. A correction preserves the previous value and reason.
- Cancellation retires the issued reference; it does not make the number reusable.
- A reprint retains the same issued identity and increments an audited reprint count.
- UI labels and API contracts must use the exact paper name instead of the generic word `token` or `RMR` where meanings could be confused.

## Shop RMR

| Property | Rule |
|---|---|
| Meaning | Physical receipt proving that the MOT collected milk from a shop. |
| Issuer / recorder | Issued to the shop during collection; the assigned MOT records the printed reference with the collection. |
| Issue point | When the shop collection is completed and locally saved/submitted. |
| Internal identity | `MotShopCollection.id` and its permanent system `collection_number`. |
| Paper field | `MotShopCollection.shop_rmr_number`. |
| Scope | A paper reference, not the system identity. Existing policy permits historical duplication; the collection system identity remains unique. |
| Correction | Submitted collection changes use correction governance. ZMCC Manager handles eligible source-scoped correction; MPD Head/Super Admin handles escalated or locked cases. |
| Cancellation | Collection cancellation retains the original collection and paper-reference history. |

## Local Supplier RMR

| Property | Rule |
|---|---|
| Meaning | Receipt proving the quantity of a Local Supplier delivery accepted into ZMCC stock. |
| Issuer | ZMCC Lab Attendant. |
| Issue point | Only after the ZMCC Manager records the final `ACCEPTED` decision and the accepted quantity is authoritative. It is not issued at gate arrival or while testing is pending. |
| Internal identity | A dedicated immutable issuance record linked to the Local Supplier arrival, final lab decision, accepted quantity, issuer, and issue timestamp. |
| Paper identity | Structured `year`, `series`, `book_number`, and `receipt_number`; the printable value is derived/presented from those fields. |
| Scope | Separate Local Supplier series per ZMCC and calendar year. The sequence resets for a new year without colliding with prior-year receipts. |
| Correction | ZMCC Manager may correct eligible paper-entry mistakes with a reason; MPD Head handles escalated/closed-period cases; Super Admin retains exceptional authority. The accepted milk decision and quantity are not changed merely by correcting paper metadata. |
| Rejection | No Local Supplier RMR is issued for a rejected delivery. Rejected arrival evidence remains in the system. |
| Cancellation | Allowed only through an audited action with reason. The number remains consumed and cannot be reassigned. |
| Reprint | Same issuance identity and number; record reprint actor, timestamp, reason, and count. |

The current `ZmccLocalSupplierArrival.rmr_number` field does not enforce this lifecycle because it is optional and can be supplied during arrival creation. It must remain legacy data until the dedicated issuance model and backfill policy are implemented.

### Local Supplier RMR issuance action

The issuance is an explicit application command, not an arrival-field update.

Proposed command contract:

```text
issueLocalSupplierRmr(
  actor,
  localSupplierArrivalId,
  finalLabDecisionId,
  series,
  bookNumber,
  receiptNumber,
  idempotencyKey
)
```

Server-authoritative values are the issuing ZMCC, calendar year, accepted quantity/unit, Local Supplier, issuer user ID, and issuance timestamp. The client cannot supply or override those values.

Preconditions:

1. Actor is an active ZMCC Lab Attendant assigned to the arrival's ZMCC, or Super Admin exercising the same legitimate action.
2. Arrival type is Local Supplier and the arrival exists in the actor's permitted scope.
3. ZMCC Manager has recorded a final `ACCEPTED` decision.
4. Accepted quantity is positive and the tank receipt/stock transaction succeeded in the same accepted workflow.
5. No active RMR issuance already exists for the arrival.
6. `series`, `bookNumber`, and `receiptNumber` pass configured formatting rules.
7. The composite paper identity is unused within the issuing ZMCC and calendar year.

Transaction effects:

1. Acquire a database/advisory lock for the ZMCC/year/series/book/receipt identity.
2. Re-read all preconditions inside the transaction.
3. Create one immutable RMR issuance row linked to arrival, final decision, accepted quantity, issuer, and issue time.
4. Record an immutable `LOCAL_SUPPLIER_RMR_ISSUED` audit event containing identifiers and masked/safe context.
5. Return both the system issuance ID and the structured printable paper reference as distinct response properties.

Idempotency and conflict behavior:

- Replaying the same `idempotencyKey` with the same command returns the original issuance.
- Reusing the key with different command data returns a conflict.
- A second paper identity for the same arrival returns a conflict and requires the correction/replacement workflow.
- A paper identity already consumed by another arrival returns a conflict; it is never silently reassigned.
- Concurrent requests are protected by database uniqueness plus the transaction lock.

Corrections create a superseding event/version and retain the issued value. Cancellation changes issuance status to `CANCELLED`, records actor/reason/time, and leaves the paper identity consumed. Reprint does not create a new issuance and cannot change accepted quantity or the manager's decision.

## Raw Milk Token

| Property | Rule |
|---|---|
| Meaning | ZMCC entry/duty token for a vehicle arriving at ZMCC. It is not an RMR and not the plant token. |
| Issuer | PHE Operator. |
| Issue point | At ZMCC arrival according to the vehicle's assigned duty. |
| Internal identity | The applicable MOT or Local Supplier arrival ID. |
| Paper fields | `ZmccMotArrival.raw_milk_token_number` or `ZmccLocalSupplierArrival.raw_milk_token_number`. |
| Scope | Unique within the issuing ZMCC according to the active paper-reference policy. |
| Correction | Eligible corrections belong to ZMCC Manager; MPD Head/Super Admin handles escalation or locked records. |
| Cancellation | Cancelling an arrival does not erase or reuse its token. |

## Raw Milk Dispatch Note

| Property | Rule |
|---|---|
| Meaning | The only confirmed printed dispatch document travelling with milk from ZMCC/contractor source to the plant. `Dispatch Milk Token` is not a separate paper. |
| Issuer | Authorized dispatch operator for the source: ZMCC Lab Attendant for ZMCC dispatch or Contractor Operator for contractor dispatch. |
| Issue point | When the dispatch is finalized and leaves the procurement source. |
| Internal identity | `VehicleVisit.id` and `visit_number`. |
| Paper field | `VehicleVisit.raw_milk_dispatch_note_number`. |
| Scope | Unique per issuing procurement source according to the active paper-reference policy. |
| Correction | ZMCC/Contractor Manager within lifecycle rules; MPD Head/Super Admin for escalation or locked records. |
| Cancellation | Retain the cancelled visit and consumed reference. A replacement dispatch receives its own internal identity and authorized paper reference. |

## Plant Gate Token

| Property | Rule |
|---|---|
| Meaning | Token assigned by plant Security when a dispatched vehicle physically enters the plant. It is separate from the Raw Milk Token and Raw Milk Dispatch Note. |
| Issuer | Security Operator; Admin Head and Super Admin retain supervisory authority. |
| Issue point | Successful plant gate entry. |
| Internal identity | `VehicleVisit.id` plus `GateLog.id`; neither is the printed token. |
| Paper field | Current implementation uses `VehicleVisit.token_number`. API contracts should rename/alias it explicitly as `plant_gate_token_number` during migration. |
| Scope | Must be unique among active in-plant vehicles. Historical reuse policy after completed exit remains a separate configurable/business decision. |
| Correction | Security branch correction governance applies; a change cannot fabricate or reverse physical entry/exit timestamps. |
| Cancellation | A cancelled/void token remains in audit history and is not silently reassigned while active. |

## Current schema mapping and required separation

| Paper | Current system ID | Current paper field | Required change |
|---|---|---|---|
| Shop RMR | `mot_shop_collection.id`, `collection_number` | `shop_rmr_number` | Keep separate; make API names explicit and preserve correction history. |
| Local Supplier RMR | `zmcc_local_supplier_arrival.id` | Legacy optional `rmr_number` | Add dedicated post-acceptance issuance entity with year/series/book/receipt structure; classify legacy values. |
| Raw Milk Token | MOT/Local Supplier arrival `id` | `raw_milk_token_number` | Keep separate and expose the arrival system ID alongside the paper value. |
| Raw Milk Dispatch Note | `vehicle_visit.id`, `visit_number` | `raw_milk_dispatch_note_number` | Keep separate and remove ambiguous `dispatch token` labels. |
| Plant Gate Token | `vehicle_visit.id`, `gate_log.id` | Generic `token_number` | Introduce explicit contract naming while retaining a compatibility adapter during migration. |

## Prisma change boundary

Do not make `ZmccLocalSupplierArrival.rmr_number` non-null and do not reinterpret it as the new issuance record. The focused Phase 7 migration must follow an inventory of legacy values and must add the approved structured issuance model without mixing unrelated schema work. Forward recovery retains issued identities and corrects them through superseding/audit events rather than destructive rollback.

## Legacy Local Supplier RMR migration policy

Existing non-empty `ZmccLocalSupplierArrival.rmr_number` values are evidence from the old workflow, not authoritative structured issuances. Migration copies each value into one `LocalSupplierRmrLegacyClassification` row and initially marks it `NEEDS_REVIEW`. It does not parse the text or create a `LocalSupplierRmrIssuance` automatically.

An authorized reviewer may later classify a legacy value as:

- `VERIFIED_HISTORICAL` when paper evidence and the linked accepted lab/stock records agree;
- `DUPLICATE_VALUE` when the same apparent paper number was recorded for more than one arrival;
- `INVALID_VALUE` for placeholders, malformed values, or records unsupported by evidence.

Every completed classification requires the reviewer and review timestamp. The original arrival value and classification row remain preserved. New operational issuance uses only `LocalSupplierRmrIssuance`; it never writes a new value into the legacy arrival field.
