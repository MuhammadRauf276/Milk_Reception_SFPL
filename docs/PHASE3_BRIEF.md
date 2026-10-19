# Phase 3 brief (shared by all Phase 3 subagents)

Repo: C:\MilkReceptionApp (Windows, Git Bash + PowerShell). Branch feature/phase-3. Next.js 16.3 (READ node_modules/next/dist/docs/ for any Next API: ctx.params is a Promise, cookies()/headers() async, no middleware — it's proxy.ts and we don't add one), Prisma 7 (client generated; prisma/schema.prisma is truth; DB migrated to Phase 2), PostgreSQL.
Plan docs: docs/WORKFLOW_ALIGNMENT_PLAN.md (later sections override earlier: §8, §14, §16, §17, §18 win over §2, §11, §15), docs/PHASE2_SCHEMA_CHANGES.md, docs/IMPLEMENTATION_PROGRESS.md.

## Hard rules
- Edit/create ONLY the files in your task list. Other agents are editing other files in the same working tree at the same time. If you need something from a file you don't own, import the shared interface below (it may be landing in parallel) or report the need — do not edit it.
- No schema changes, no new migrations, no `prisma db push/seed/migrate`, nothing destructive on the database.
- Keep each file's existing line endings (most files are CRLF; check with `file <path>` or by reading bytes). New files: use CRLF to match the repo majority. TS strict, 2 spaces, single quotes. Match surrounding style and comment density.
- Server is the source of truth for every permission; never trust a role from the client (`x-acting-as` is only a *request* that the server validates via canActAs).
- Tests: `src/**/__tests__/*.test.ts` using `node:test` + `node:assert/strict`, run with `node --import tsx --test <file>`. Tests must NOT import `src/lib/db.ts` (or anything that imports it at module load) — core functions take an injected `db` param.
- UI: simple English, ≥44px touch targets (field primary buttons 56px), status = colour + icon + word. Field users are low-literacy: automatic everything.
- Finish with: `npm run typecheck` (fix errors in YOUR files; ignore errors clearly inside files owned by other in-flight agents but mention them), `npx eslint <your files>` (0 problems in your files), your tests passing. Report: files changed, exported API, tests added, anything you could not do.

## Owner decisions
- Hierarchy (src/backend/core/roles/hierarchy.ts already encodes it): Super Admin → {Senior Exec Mgmt, Data Executive, Finance, MPD Head, Admin Head, AVP-QA, Production Head}; MPD Head → {Contractor Manager → Contractor Operator, Zonal Manager → {PHE Operator, MDO, Zonal Lab Attendant, Mobile Tester}}; Admin Head → Admin Operator; AVP-QA → QAE; Production Head → {Weighbridge, Production Reception}. QA_MANAGER still exists until Phase 6 — keep it working.
- A superior can do ALL work of every role below them, own scope only (Zonal Manager = own ZMCC). No reason prompt. Records store real user + `*_as_role` + `*_is_delegated`.
- Super Admin & Data Executive are outside delegation rules (never "delegated").
- CORRECT and ADMINISTER are non-delegable: only DATA_EXECUTIVE + SUPER_ADMIN correct/edit records and control devices (register/release/block, diary, alerts).
- Test points (matrix columns): MOT_SHOP, ZMCC_LAB_MC (MOT collection milk at ZMCC lab), ZMCC_LAB_HC (local supplier = HC; legacy "ZMCC contractor/local supplier" codes map to HC), ZMCC_DISPATCH, CONTRACTOR_DISPATCH, PLANT_QA. Legacy `DISPATCH` maps by source type (ZMCC→ZMCC_DISPATCH, CONTRACTOR→CONTRACTOR_DISPATCH); legacy ZMCC_LAB_CONTRACTOR / local-supplier → ZMCC_LAB_HC; legacy MOT lab → ZMCC_LAB_MC.
- Defaults when no DB row: LR & Fat photo REQUIRED everywhere except CONTRACTOR_DISPATCH (OPTIONAL); "Lab report (hand-written)" document photo REQUIRED at ZMCC_DISPATCH and CONTRACTOR_DISPATCH.
- Matrix changes by Super Admin apply directly (versioned, ConfigChangeLog with reason, audit). Maker-checker comes in P7. Data Executive sees matrix read-only.
- Photos: live camera only (getUserMedia; NO <input type=file>, no gallery). Stamp band is added BELOW the photo (employee ID, role / acting-as, point, date/time PKT, GPS, vehicle/token, photo ID, OFFLINE marker) — never covering the image.
- Nothing is deleted from a phone until the server confirms (SAVED or DUPLICATE). Logout never deletes unsent work. Field users: no PIN/OTP/password changes; logout hidden. Shared station PCs: name card + 4-digit PIN set by SA/DE; 5 wrong tries lock.
- Activity diary ("black box") per device (DeviceActivityEvent).
- QA "correct-decision" route stays as is until P4d.

## Shared interfaces (code against these exactly)

```ts
// src/types/acting.ts
import type { CanonicalRole } from '@/backend/core/roles'; // or wherever CanonicalRole lives
export type DelegationMode = 'ancestors' | 'none';
export type ScopeFailure = 'OUTSIDE_SCOPE' | 'SOURCE_TYPE_MISMATCH' | 'NO_SCOPE_BOUND' | 'CANNOT_ACT_AS';
export type ActingScope =
  | { kind: 'SYSTEM' }
  | { kind: 'SOURCE'; sourceId: bigint; sourceType: 'ZMCC' | 'CONTRACTOR' }
  | { kind: 'DEPARTMENT'; departments: readonly string[] };
export interface ActingContext {
  userId: bigint; actorRole: CanonicalRole; actingAs: CanonicalRole;
  isDelegated: boolean;            // false when actingAs===actorRole or actor is SA/DE
  scope: ActingScope;
}
export interface ResourceRef { sourceId?: bigint | null; sourceType?: string | null; department?: string | null }

// src/backend/core/acting-context.ts (T1)
export function resolveActingContext(user: User, allowed: readonly string[],
  opts?: { delegation?: DelegationMode; requestedAs?: string | null; resource?: ResourceRef }
): { ok: true; ctx: ActingContext } | { ok: false; code: ScopeFailure | 'FORBIDDEN' };
export function assertResourceInScope(ctx: ActingContext, r: ResourceRef): { ok: true } | { ok: false; code: ScopeFailure };
export function targetSourceTypeFor(role: string): 'ZMCC' | 'CONTRACTOR' | null;
export function primaryActorFields(ctx: ActingContext): { performed_as_role: string; is_delegated: boolean };
export function asRoleFields<S extends string>(ctx: ActingContext, stem: S):
  Record<`${S}_as_role`, string> & Record<`${S}_is_delegated`, boolean>;

// src/backend/core/route-guards.ts (T1)
export type RoleGuardResult = { user: User; acting: ActingContext } | { response: NextResponse };
export function requireRoles(req: Request, roles: readonly string[],
  options?: { delegation?: DelegationMode /* default 'ancestors' */; requestedAs?: string | null /* else header x-acting-as */ }
): Promise<RoleGuardResult>;
export function requireCorrectionAuthority(req: Request): Promise<RoleGuardResult>; // SA, DE; never delegated
export function requireDeviceAdmin(req: Request): Promise<RoleGuardResult>;         // SA, DE (ADMINISTER)
export function scopeFailureResponse(code: ScopeFailure): NextResponse;              // 403 {error, code}
// (existing callers of requireRoles must keep working)

// src/backend/core/roles/capabilities.ts (T1)
export const NON_DELEGABLE_CAPABILITIES: readonly ['CORRECT', 'ADMINISTER'];
export function holdsNonDelegable(role: string, cap: 'CORRECT' | 'ADMINISTER'): boolean;
export function isCorrectionAuthority(role: string): boolean;  // SUPER_ADMIN | DATA_EXECUTIVE
export function isDeviceAdministrator(role: string): boolean;  // SUPER_ADMIN | DATA_EXECUTIVE

// src/backend/core/audit.ts (T2)
export interface AuditActor { userId: bigint | null; actorRole: string | null; performedAsRole?: string | null; isDelegated?: boolean; deviceId?: bigint | null }
export interface WriteAuditLogInput { tableName: string; recordId: bigint; action: string;
  oldValues?: Prisma.InputJsonValue | null; newValues?: Prisma.InputJsonValue | null; actor: AuditActor | ActingContext }
export type AuditDb = { auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'> };
export function buildAuditLogData(i: WriteAuditLogInput): Prisma.AuditLogUncheckedCreateInput;
export function writeAuditLog(db: AuditDb, i: WriteAuditLogInput): Promise<{ id: bigint }>;
export function auditActorFromUser(u: { id: string | bigint; role: string }, deviceId?: bigint | null): AuditActor;

// src/types/device.ts + src/backend/core/device-auth.ts (T2)
export const DEVICE_UID_HEADER = 'x-device-uid'; export const DEVICE_KEY_HEADER = 'x-device-key';
export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'RELEASED';
export interface AuthenticatedDevice { id: bigint; deviceUid: string; status: DeviceStatus; assignedUserId: bigint | null; procurementSourceId: bigint | null; isSharedStation: boolean }
export function generateDeviceKey(): string; export function hashDeviceKey(key: string): string;
export function authenticateDevice(req: Request, db?: DeviceDb): Promise<AuthenticatedDevice | null>; // ACTIVE only

// src/types/sync.ts
export type SyncItemKind = 'DEVICE_EVENT' | 'HEARTBEAT' | 'MOT_COLLECTION' | 'MOT_GPS_BATCH' | 'MOT_STOP_SKIP'
  | 'ZMCC_MOT_ARRIVAL' | 'ZMCC_LOCAL_SUPPLIER_ARRIVAL';          // P4 adds ZMCC_LAB_PORTION, DISPATCH
export interface SyncItem { clientUuid: string; kind: SyncItemKind; ownerUserId: string;
  requestedAs?: string | null; capturedAt: string; payload: unknown }
export interface SyncBatchRequest { deviceUid: string; appVersion: string; deviceSentAt: string; items: SyncItem[] } // ≤50
export type SyncItemStatus = 'SAVED' | 'DUPLICATE' | 'REJECTED' | 'RETRY';
export interface SyncItemResult { clientUuid: string; status: SyncItemStatus; receipt?: string;
  entityType?: string; entityId?: string; code?: string; message?: string }
export interface SyncBatchResponse { serverTime: string; deviceStatus: DeviceStatus; results: SyncItemResult[] }
// Client deletes ONLY on SAVED|DUPLICATE. REJECTED -> kept as "needs office help". RETRY/network -> backoff.
// Auth: device headers; fallback session cookie (then every ownerUserId must equal the session user).
// Server idempotency ledger: DeviceActivityEvent with client_event_id = 'sync:' + clientUuid (unique per device), plus domain tables' own unique client ids.

// src/types/captured-photo.ts
export interface CapturedPhotoMeta { captureId: string; sha256: string; testingPoint: TestPointCode;
  entityType: string; entityId: string; labTestId?: string | null; portionNumber?: number | null;
  photoKind: 'TEST_RESULT' | 'LAB_REPORT' | 'TANKER_WASH' | 'OTHER'; deviceCapturedAt: string;
  latitude?: number | null; longitude?: number | null; gpsAccuracyM?: number | null;
  wasOffline: boolean; width: number; height: number; policyVersion?: number | null; requestedAs?: string | null }
export interface CapturedPhotoUploadResult { captureId: string; photoId: string; status: 'SAVED' | 'DUPLICATE';
  hashReusedOnOtherRecord: boolean; clockDriftSeconds: number; clockMismatch: boolean }
// POST /api/photos multipart: file=<image/jpeg>, meta=<JSON CapturedPhotoMeta>. CapturedPhoto.entity_id is NOT NULL → photos upload after the record is ACKed.
export interface StampInfo { employeeCode: string; roleLabel: string; actingAsLabel?: string | null; pointLabel: string;
  vehicleNo?: string | null; tokenNo?: string | null; captureId: string; offline: boolean }
export interface LiveCameraResult { captureId: string; blob: Blob; sha256: string; width: number; height: number;
  capturedAt: string; gps: { lat: number; lng: number; accuracyM: number } | null }

// src/types/test-point-policy.ts
export type TestPointCode = 'MOT_SHOP' | 'ZMCC_LAB_MC' | 'ZMCC_LAB_HC' | 'ZMCC_DISPATCH' | 'CONTRACTOR_DISPATCH' | 'PLANT_QA';
export interface TestPointPolicyCell { labTestId: string; testCode: string; testName: string; point: TestPointCode;
  testMode: 'COMPULSORY' | 'OPTIONAL' | 'OFF'; ruleMode: 'APPLY' | 'WARN'; photoMode: 'REQUIRED' | 'OPTIONAL' | 'NONE';
  version: number; effectiveFrom: string; source: 'DB' | 'DEFAULT' }
// testPointPolicyService (T3)
export function getEffectivePolicy(point: TestPointCode, at?: Date, db?: PolicyDb): Promise<{ point: TestPointCode; version: number; cells: TestPointPolicyCell[] }>;
export function getPolicyMatrix(at?: Date, db?: PolicyDb): Promise<{ points: TestPointCode[]; cells: TestPointPolicyCell[] }>;
export function updatePolicyCells(ctx: ActingContext, changes: Array<Pick<TestPointPolicyCell, 'labTestId' | 'point' | 'testMode' | 'ruleMode' | 'photoMode'>>, reason: string): Promise<{ applied: number }>;
```
Adjust a type only if the real schema forces it (e.g. field names/enum values in prisma/schema.prisma) and say so in your report.

## Planner findings to respect
- 96 direct auditLog.create calls in 39 files (services + 23 API routes) → replaced by writeAuditLog (T7 services, T8 routes).
- rolePolicies.ts gives ADMINISTER to HEAD_OF_MPD and QA_HEAD → remove (T1).
- zmccArrivalCore CORRECT_ARRIVAL/CORRECT_EXIT allow ZMCC_MANAGER; api/zmcc/manager/correction-requests lets ZM apply corrections → DE/SA only (T7/T8). ZM keeps read access to own requests.
- operationalReadModelService L724–754 and L1000–1004 fail open for unknown roles → fail closed (T9).
- Known trap: POST /api/dispatches validates source only inside `if (role === 'ZMCC_LAB_ATTENDANT')` → switch on ctx.actingAs + ctx.scope; SYSTEM scope requires procurementSourceId whose type matches targetSourceTypeFor(ctx.actingAs) (T9).
- Stage resolvers (resolveMotAuth, resolveZmccLabAuth, resolveZmccArrivalAuth, resolveZmccTankAuth, resolveZmccAuth) are NOT widened in P3 (P4).
- LiveCameraCapture.tsx has <input type=file> (L186); used in app/mot/page.tsx, QATestingSection.tsx, ZmccLabWorkspace.tsx → becomes thin wrapper over new LiveCamera with same props (T4).
