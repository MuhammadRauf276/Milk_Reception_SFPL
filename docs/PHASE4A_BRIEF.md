# Phase 4a brief: Stage 1 (MOT / MDO)

Binding for all Phase 4a agents. Also read docs/PHASE3_BRIEF.md (rules, decisions, Phase 3 interfaces, notes).

## Owner rules (in addition to PHASE3_BRIEF)
- NO tests: do not create or edit any `__tests__` file. Testing happens after all phases.
- Edit/create ONLY your task's files. Other agents edit other files at the same time.
- Do not run `prisma migrate`, `db push`, `db seed` or anything on the database. Do not run `prisma generate` unless your task says so.
- Keep each file's line endings (most CRLF). TS strict, 2 spaces, single quotes.
- Simple English UI, ≥44px targets, field primary buttons 56px, status = colour + icon + word.
- "If you can approve it, you can decide it": a superior doing subordinate work decides an exception on the same screen (DECIDE_NOW). Data Executive is outside approval rules (cannot decide exceptions).
- Exceptions in Stage 1 go to the Zonal Manager. PHE loses Stage 1 writes (route request, shop approval, dispatch); PHE keeps read of MOT tracking. MDO has PHE-equivalent rights plus Stage 1 writes; MDO routes stay pending until a Zonal Manager (or above) approves.
- Finish: `npm run typecheck` (0 errors in non-test files you own; test-file errors are known and ignored), `npx eslint <your files>` (no new problems).

## Defaults chosen
1. PHE loses Stage 1 writes; keeps read of journeys/map/SMS/shop details.
2. MDO keeps the /phe station, titled "MDO Station" for MDO. No /mdo page in 4a.
3. A pending shop exception does not block ZMCC arrival; it is excluded from accepted totals until decided; summary recomputed after review.
4. Stage 2 GPS cache ages and area loss are P4b.

## Schema (T0): migration prisma/migrations/20261021100000_phase4a_stage1_mot (additive, idempotent)
```sql
ALTER TABLE "mot_shop_collection" ADD COLUMN IF NOT EXISTS "decision_details" JSONB;
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "assigned_as_role" VARCHAR(64);
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "assigned_is_delegated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "cancelled_as_role" VARCHAR(64);
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "cancelled_is_delegated" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "mot_shop_collection_zmcc_id_review_status_idx" ON "mot_shop_collection"("zmcc_id","review_status");
```
Matching schema.prisma fields: `decision_details Json? @db.JsonB`, `@@index([zmcc_id, review_status])`, the four mot_journey fields. NOTE: the real DB needs `npx prisma migrate deploy` before the app runs with the regenerated client (owner will run it).

## Shared interfaces
```ts
// src/types/stage1-decision.ts (T0)
export type PersonDecision = 'ACCEPT' | 'REJECT';
export type SystemOutcome = 'PASS' | 'FAIL';
export type ExceptionReason = 'MISMATCH' | 'PICTURE_MISSING' | 'MISSING_FIELD' | 'AWAY_FROM_SHOP' | `RULE_FAIL:${string}`;
export type DecisionRoute = 'PROCEED' | 'REJECT' | 'SEND_TO_APPROVER' | 'DECIDE_NOW';
export type FinalDecision = 'ACCEPTED' | 'REJECTED' | 'PENDING';
export type ReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export interface DecisionInput {
  ruleFailures: string[];          // APPLY-mode failures (test codes); WARN failures go in warnings only
  missingCompulsory: string[]; missingPhotos: string[];
  extraReasons?: ExceptionReason[]; // e.g. AWAY_FROM_SHOP
  personDecision: PersonDecision; remarks?: string | null;
  deciderCanApprove: boolean;      // canActAs(actor,'ZMCC_MANAGER') && actor !== DATA_EXECUTIVE
}
export interface DecisionResult {
  route: DecisionRoute; systemOutcome: SystemOutcome; exceptionReasons: ExceptionReason[];
  remarksRequired: boolean; remarksOk: boolean; finalDecision: FinalDecision; reviewStatus: ReviewStatus;
}
// Rules: systemPass = no ruleFailures && no missingCompulsory.
// MISMATCH = (pass && REJECT) || (!pass && ACCEPT). PICTURE_MISSING if missingPhotos; MISSING_FIELD if missingCompulsory; RULE_FAIL:<code> per failure.
// REJECT with !pass and no other exception reason -> route REJECT (REJECTED/NONE, remarks required).
// No exception and ACCEPT -> PROCEED (ACCEPTED/NONE).
// Any exception -> SEND_TO_APPROVER (PENDING/PENDING), or DECIDE_NOW when deciderCanApprove
//   (final = person decision; review APPROVED for ACCEPT, REJECTED for REJECT).
// Remarks (>=3 chars) required for REJECT and for every exception.

export interface GeofenceInput { shopLat: number | null; shopLng: number | null; radiusM: number | null;
  lat: number; lng: number; accuracyM: number | null; approximate?: boolean }
export interface GeofenceResult { status: 'INSIDE' | 'OUTSIDE' | 'NO_SHOP_GPS' | 'WEAK_GPS'; distanceM: number | null; radiusM: number }
// OUTSIDE when distance - min(accuracy, 50) > radius -> AWAY_FROM_SHOP.
// WEAK_GPS = accuracy > 150 m (or approximate) and not clearly outside: recorded, no exception.

export interface MotShopPolicyTest extends TestPointPolicyCell { resultType: string; isLr: boolean; isFat: boolean;
  options?: string[] | null; rule: { min: number | null; max: number | null; allowed?: string[] | null } | null }
export interface MotShopPolicySnapshot { point: 'MOT_SHOP'; version: number; fetchedAt: string; tests: MotShopPolicyTest[] }
export interface MotShopTestInput { labTestId: string; value?: number | null; textValue?: string | null; photoCaptureId?: string | null }
export interface MotShopDecisionDetails { policyVersion: number;
  tests: Array<{ labTestId: string; testCode: string; testName: string; value: number | null; textValue: string | null;
    testMode: string; ruleMode: string; photoMode: string; outcome: 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED'; photoCaptureId: string | null }>;
  geofence: GeofenceResult & { accuracyM: number | null; approximate: boolean }; warnings: string[] }

// src/backend/services/decision/decisionRule.ts (T1, pure)
export function evaluateDecision(i: DecisionInput): DecisionResult;
// src/backend/services/mot/geofence.ts (T1, pure)
export const DEFAULT_SHOP_GEOFENCE_M = 100;
export function evaluateGeofence(i: GeofenceInput): GeofenceResult;
// src/backend/services/mot/motShopDecision.ts (T1, pure, client-importable: NO prisma / db imports)
export function buildMotShopDecision(p: MotShopPolicySnapshot, i: { lr: number; fat: number; tests: MotShopTestInput[];
  photos: Array<{ labTestId: string; captureId: string }>; personDecision: PersonDecision; remarks?: string | null;
  geofence: GeofenceResult & { accuracyM: number | null; approximate: boolean }; deciderCanApprove: boolean }):
  { decision: DecisionResult; details: MotShopDecisionDetails };
// src/backend/services/mot/motShopPolicy.ts (T1, server)
export function loadMotShopPolicy(at?: Date, db?: unknown): Promise<MotShopPolicySnapshot>;
// GET /api/zmcc/mot/shop-policy -> MotShopPolicySnapshot

// MOT_COLLECTION payload additions (motCore SubmitCollectionPayload; T2 accepts, T5 sends)
//   person_decision?: PersonDecision; decision_remarks?: string | null; gps_approximate?: boolean;
//   test_results?: Array<{ lab_test_id: string; value?: number | null; text_value?: string | null }>;
//   photos?: Array<{ lab_test_id: string; capture_id: string }>; policy_version?: number | null;
// Response data adds: final_decision, review_status, exception_reasons, system_outcome (id, collection_number unchanged).
// Photo meta: testingPoint 'MOT_SHOP', photoKind 'TEST_RESULT', labTestId set; entityType 'mot_shop_collection', entityId from the ACK.

// motCore (T2)
export interface MotAuthContext { /* existing fields */ acting: ActingContext; isSystemScope: boolean; canDecideStage1: boolean; isMdoOrAbove: boolean }
export const MOT_ACTION_ROLES: Record<MotAction, { roles: readonly string[]; delegation: DelegationMode }>;
// READ / READ_MAP / READ_SMS_OUTBOX: [MDO, PHE_OPERATOR, DATA_EXECUTIVE]; READ_COLLECTIONS: + MOT;
// ASSIGN_DISPATCH: [MDO]; CANCEL_JOURNEY / WRITE_PROFILE / WRITE_VEHICLE: [ZMCC_MANAGER] (+DE as today);
// SUBMIT_COLLECTION, SKIP_STOP, READ_CURRENT_JOURNEY: [MOT]; UPLOAD_GPS: [MOT] with 'none';
// TRANSFER_VEHICLE: [DATA_EXECUTIVE] with 'none'; CORRECT_COLLECTION: isCorrectionAuthority.
export function resolveMotAuth(r?: Request | User, action?: MotAction, opts?: { requestedAs?: string | null }): Promise<{ auth?: MotAuthContext; errorResponse?: { error: string; status: number } }>;
export function isInMotScope(auth: MotAuthContext, zmccId: bigint): boolean;
export function submitShopCollection(r: Request | User, p: SubmitCollectionPayload, opts?: { requestedAs?: string | null }): Promise<ServiceResult<Record<string, unknown>>>;
export function getCurrentMotJourney(auth: MotAuthContext, opts?: { journeyId?: bigint }): Promise<ServiceResult<unknown>>;

// motShopReviewService (T3)
export interface MotShopExceptionItem { id: string; collectionNumber: string; zmccId: string; journeyNumber: string; shopName: string;
  motName: string; submittedAt: string; performedAsRole: string | null; isDelegated: boolean; grossLiters: number; lr: number; fat: number;
  personDecision: PersonDecision; decisionRemarks: string | null; exceptionReasons: ExceptionReason[]; details: MotShopDecisionDetails | null;
  photos: Array<{ captureId: string; labTestId: string | null; received: boolean }>; reviewStatus: ReviewStatus; finalDecision: FinalDecision; version: number }
export function listMotShopExceptions(ctx: ActingContext, q: { status?: 'PENDING' | 'DECIDED'; limit?: number }): Promise<MotShopExceptionItem[]>;
export function reviewMotShopException(ctx: ActingContext, id: bigint, i: { verdict: 'OKAY' | 'NO'; remarks?: string | null; version: number }): Promise<ServiceResult<MotShopExceptionItem>>;
// OKAY -> final = person decision; NO -> final = opposite (remarks required). review_status APPROVED (OKAY) / REJECTED (NO).
// GET /api/zmcc/mot/collections/exceptions?status=PENDING|DECIDED ; POST /api/zmcc/mot/collections/[id]/review {verdict, remarks, version}

// zmccMasterDataService (T4)
export type RequiredMasterDataAction = /* existing */ | 'APPROVE_ROUTE' | 'APPROVE_SHOP';
export interface ZmccAuthContext { /* existing */ acting: ActingContext; isMdo: boolean; canApproveStage1: boolean; isSystemScope: boolean }
// WRITE_ROUTE: [MDO]; APPROVE_ROUTE: [ZMCC_MANAGER]; APPROVE_SHOP: [MDO]; WRITE_SHOP: [MDO, PHE_OPERATOR];
// REQUEST_SHOP: [MOT, MDO]; READ: unchanged set (+ ancestors).

// src/frontend/modules/zmcc/stage1Capabilities.ts (T0, client-safe; imports only role hierarchy helpers)
// canCreateRoute(role) MDO+; routeNeedsApproval(role) !ZM+; canApproveRoute(role) ZM+; canApproveShop(role) MDO+;
// canAssignJourney(role) MDO+; canDecideMotException(role) ZM+ and not DATA_EXECUTIVE; canCoverMotWork(role) role!=='MOT' && canActAs(role,'MOT');
// isFieldStationRole(role) PHE_OPERATOR | MDO | ZMCC_LAB_ATTENDANT | MOBILE_TESTER.
// src/frontend/modules/shared/decision/DecisionStatusBadge.tsx (T0)
export function DecisionStatusBadge(p: { status: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'EXCEPTION' | 'APPROVED'; label?: string; size?: 'md' | 'lg' }): JSX.Element;
// green ✓ "Accepted" · red ✗ "Rejected" · violet ⏱ "Waiting for Zonal Manager" · amber ⚠ "Needs decision" · green ✓ "Approved"
```

## Tasks and file ownership
- T0 (haiku): prisma/schema.prisma, the migration, src/types/stage1-decision.ts, stage1Capabilities.ts, DecisionStatusBadge.tsx. Runs `npx prisma validate` and `npx prisma generate` (client only, no DB).
- T1 (sonnet): decisionRule.ts, geofence.ts, motShopDecision.ts, motShopPolicy.ts, src/app/api/zmcc/mot/shop-policy/route.ts.
- T2 (opus): src/backend/services/mot/motCore.ts, src/backend/services/sync/handlers.ts, src/backend/services/motJourneySummaryService.ts, src/app/api/zmcc/mot/journeys/current/route.ts.
- T3 (sonnet): motShopReviewService.ts, the two review API routes, MotShopExceptionQueue.tsx, ZMCCManagerWorkspace.tsx.
- T4 (opus): zmccMasterDataService.ts, route approve/reject routes, shop approve/reject routes, PendingApprovalsPanel.tsx.
- T5 (opus): src/app/mot/page.tsx, src/frontend/modules/mot/offlineStore.ts, DecisionRulePanel.tsx, MotShopTestsStep.tsx.
- T6 (sonnet): MotOperationsWorkspace.tsx, src/app/phe/page.tsx, roleNavConfig.ts, ZmccMasterDataWorkspace.tsx, ManagerJourneyMap.tsx.
