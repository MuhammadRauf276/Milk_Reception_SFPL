/**
 * Offline sync batch processing (Phase 3).
 *
 * One request carries up to SYNC_BATCH_MAX_ITEMS queued items from a field
 * device. Each item is processed on its own and gets its own result:
 * - SAVED / DUPLICATE: the server holds the record; the phone may delete it.
 * - REJECTED: validation or business rule failed; the phone keeps it as
 *   "needs office help".
 * - RETRY: transient failure (DB/network); the phone backs off and resends.
 *
 * Idempotency ledger: DeviceActivityEvent with client_event_id =
 * 'sync:' + clientUuid, unique per device. A ledger row is written only
 * after the handler succeeded, so a RETRY never leaves a ledger row and a
 * resend runs the handler again (domain tables have their own unique client
 * ids, so a resent domain write comes back as a replay -> DUPLICATE).
 *
 * The acting role is always re-resolved on the server from the owner's DB
 * user; a role sent by the client is only a request (requestedAs).
 *
 * Device housekeeping (DEVICE_EVENT / HEARTBEAT) on device auth may come
 * with an empty ownerUserId (no user signed in on the phone) or an owner
 * this device cannot vouch for: it is then attributed to the device and its
 * assigned user (never delegated) instead of being refused, because a
 * refused diary item would only sit on the phone as a false alarm.
 *
 * Pure orchestration: every DB access goes through injected deps, so this
 * module never imports the Prisma client at load time.
 */
import type { User } from '../../core/types';
import type { ActingContext } from '../../../types/acting';
import type { AuthenticatedDevice, DeviceStatus } from '../../../types/device';
import {
  SYNC_BATCH_MAX_ITEMS,
  type SyncBatchRequest,
  type SyncBatchResponse,
  type SyncItem,
  type SyncItemKind,
  type SyncItemResult,
} from '../../../types/sync';
import { primaryActorFields, resolveActingContext } from '../../core/acting-context';
import { touchDeviceLastSeen, type DeviceHeartbeat, type DeviceHeartbeatDb } from '../../core/device-auth';
import { getErrorCode, getErrorMessage, getErrorName } from '../../../lib/errors';

export const SYNC_LEDGER_PREFIX = 'sync:';
/** Default ledger event_type for a synced item: 'SYNC_' + kind. */
export const SYNC_LEDGER_EVENT_PREFIX = 'SYNC_';

export const SYNC_ITEM_KINDS: readonly SyncItemKind[] = [
  'DEVICE_EVENT',
  'HEARTBEAT',
  'MOT_COLLECTION',
  'MOT_GPS_BATCH',
  'MOT_STOP_SKIP',
  'ZMCC_MOT_ARRIVAL',
  'ZMCC_LOCAL_SUPPLIER_ARRIVAL',
];

/**
 * Roles whose work each kind is (passed to resolveActingContext with
 * ancestor delegation). null = device housekeeping: no acting role is
 * resolved, the owner's own role is recorded.
 */
export const SYNC_KIND_ALLOWED_ROLES: Record<SyncItemKind, readonly string[] | null> = {
  DEVICE_EVENT: null,
  HEARTBEAT: null,
  MOT_COLLECTION: ['MOT'],
  MOT_GPS_BATCH: ['MOT'],
  MOT_STOP_SKIP: ['MOT', 'ZMCC_MANAGER'],
  ZMCC_MOT_ARRIVAL: ['PHE_OPERATOR', 'MDO'],
  ZMCC_LOCAL_SUPPLIER_ARRIVAL: ['PHE_OPERATOR', 'MDO'],
};

/** Device housekeeping kinds: no acting role, may be attributed to the device itself. */
export function isHousekeepingKind(kind: SyncItemKind): boolean {
  return SYNC_KIND_ALLOWED_ROLES[kind] === null;
}

const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d+$/;

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

export interface SyncLedgerRow {
  id: bigint;
  device_id: bigint;
  user_id: bigint | null;
  event_type: string;
  entity_type: string | null;
  entity_id: bigint | null;
  client_event_id: string;
  payload: unknown;
}

export interface SyncLedgerCreateData {
  device_id: bigint;
  user_id: bigint | null;
  performed_as_role: string | null;
  is_delegated: boolean;
  event_type: string;
  entity_type: string | null;
  entity_id: bigint | null;
  client_event_id: string;
  payload: SyncLedgerPayload;
  device_occurred_at: Date;
}

export interface SyncDb extends DeviceHeartbeatDb {
  deviceActivityEvent: {
    findUnique(args: {
      where: { device_id_client_event_id: { device_id: bigint; client_event_id: string } };
    }): Promise<SyncLedgerRow | null>;
    create(args: { data: SyncLedgerCreateData }): Promise<{ id: bigint }>;
  };
}

/** What a handler may return. Thrown errors are classified by the service. */
export interface SyncHandlerSuccess {
  status: 'SAVED' | 'DUPLICATE';
  receipt?: string;
  entityType?: string;
  entityId?: string;
  /** Diary event_type for the ledger row (default 'SYNC_' + kind). */
  eventType?: string;
  /** Extra data kept in the ledger row's payload (diary details). */
  diary?: Record<string, unknown>;
  /** Extra top-level fields kept in the ledger row's payload (e.g. online flag of a diary event). */
  ledgerExtra?: Record<string, unknown>;
  /** When the event happened on the device (default: the item's capturedAt). */
  occurredAt?: Date;
  /** Non-fatal note returned to the client (e.g. some GPS points dropped). */
  code?: string;
  message?: string;
}

export interface SyncHandlerFailure {
  status: 'REJECTED' | 'RETRY';
  code: string;
  message: string;
}

export type SyncHandlerOutcome = SyncHandlerSuccess | SyncHandlerFailure;

function isFailure(outcome: SyncHandlerOutcome): outcome is SyncHandlerFailure {
  return outcome.status === 'REJECTED' || outcome.status === 'RETRY';
}

export interface SyncHandlerContext {
  item: SyncItem;
  /**
   * The owner's DB user. Always set for business kinds; null only for device
   * housekeeping attributed to the device (no known / allowed owner).
   */
  owner: User | null;
  /** Server-resolved acting context; null for device housekeeping kinds. */
  acting: ActingContext | null;
  /** Authenticated device; null only for a session-auth batch from an unregistered device. */
  device: AuthenticatedDevice | null;
  db: SyncDb;
}

export type SyncHandler = (ctx: SyncHandlerContext) => Promise<SyncHandlerOutcome>;
export type SyncHandlerRegistry = Partial<Record<SyncItemKind, SyncHandler>>;

export interface SyncBatchDeps {
  db: SyncDb;
  handlers: SyncHandlerRegistry;
  /** Loads the owner from the DB; null when missing or inactive. */
  loadUser(userId: bigint): Promise<User | null>;
  now?: () => Date;
}

export type SyncAuth =
  /**
   * sessionUser: the user of a valid session cookie sent with the device headers (or null).
   * Business items are accepted for the device's assigned user or for this signed-in user only.
   */
  | { mode: 'DEVICE'; device: AuthenticatedDevice; sessionUser?: User | null }
  | { mode: 'SESSION'; user: User; device: AuthenticatedDevice | null };

export type SyncBatchOutcome =
  | { httpStatus: 200; body: SyncBatchResponse }
  | { httpStatus: 400 | 403; body: { error: string; code: string; deviceStatus?: DeviceStatus; serverTime: string } };

/** Thrown by handlers for a bad payload: becomes REJECTED with this code. */
export class SyncValidationError extends Error {
  readonly code: string;
  constructor(message: string, code = 'INVALID_PAYLOAD') {
    super(message);
    this.name = 'SyncValidationError';
    this.code = code;
  }
}

export interface SyncLedgerPayload {
  kind: SyncItemKind;
  result: { status: 'SAVED' | 'DUPLICATE'; receipt: string | null; entityType: string | null; entityId: string | null };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034']);
const TRANSIENT_NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);

export function isUniqueViolation(err: unknown): boolean {
  return getErrorCode(err) === 'P2002';
}

/** Transient DB/network failure: the same request may succeed later. */
export function isTransientError(err: unknown): boolean {
  const code = getErrorCode(err);
  if (code && (TRANSIENT_PRISMA_CODES.has(code) || TRANSIENT_NETWORK_CODES.has(code) || code.startsWith('P1'))) return true;
  const name = getErrorName(err);
  if (name === 'PrismaClientInitializationError' || name === 'PrismaClientRustPanicError') return true;
  if (name === 'PrismaClientUnknownRequestError') return true;
  return false;
}

/** Maps a thrown handler error to an item result (never SAVED). */
function classifyThrown(clientUuid: string, err: unknown): SyncItemResult {
  if (err instanceof SyncValidationError) {
    return { clientUuid, status: 'REJECTED', code: err.code, message: err.message };
  }
  if (isTransientError(err)) {
    return { clientUuid, status: 'RETRY', code: 'TRANSIENT', message: 'Server busy. Will try again.' };
  }
  const code = getErrorCode(err);
  if (code && /^P2\d{3}$/.test(code)) {
    // Data errors (bad reference, value too long, ...) will not fix themselves.
    return { clientUuid, status: 'REJECTED', code: `DB_${code}`, message: getErrorMessage(err) || 'Record could not be saved.' };
  }
  // Unknown server failure: keep the item on the phone and try again later.
  return { clientUuid, status: 'RETRY', code: 'SERVER_ERROR', message: 'Server error. Will try again.' };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ownerId is null only for a housekeeping kind sent with an empty ownerUserId. */
type ValidItem = { ok: true; item: SyncItem; ownerId: bigint | null; capturedAt: Date } | { ok: false; result: SyncItemResult };

function validateItem(raw: unknown): ValidItem {
  const rec = isRecord(raw) ? raw : {};
  const clientUuid = typeof rec.clientUuid === 'string' ? rec.clientUuid.trim() : '';
  const reject = (code: string, message: string): ValidItem => ({
    ok: false,
    result: { clientUuid: clientUuid || String(rec.clientUuid ?? ''), status: 'REJECTED', code, message },
  });

  if (!isRecord(raw)) return reject('INVALID_ITEM', 'Item must be an object.');
  if (!UUID_RE.test(clientUuid)) return reject('INVALID_CLIENT_UUID', 'clientUuid must be a UUID.');
  const kind = rec.kind;
  if (typeof kind !== 'string' || !SYNC_ITEM_KINDS.includes(kind as SyncItemKind)) {
    return reject('UNKNOWN_KIND', `Unknown item kind '${String(kind)}'.`);
  }
  const ownerRaw = typeof rec.ownerUserId === 'string' ? rec.ownerUserId.trim() : '';
  const ownerless = ownerRaw === '' && (rec.ownerUserId === '' || rec.ownerUserId === undefined || rec.ownerUserId === null);
  if (!(ownerless && isHousekeepingKind(kind as SyncItemKind)) && !NUMERIC_ID_RE.test(ownerRaw)) {
    return reject('INVALID_OWNER', 'ownerUserId must be a numeric user id.');
  }
  const capturedAt = typeof rec.capturedAt === 'string' ? new Date(rec.capturedAt) : new Date(NaN);
  if (Number.isNaN(capturedAt.getTime())) return reject('INVALID_CAPTURED_AT', 'capturedAt must be an ISO date-time.');
  if (rec.requestedAs !== undefined && rec.requestedAs !== null && typeof rec.requestedAs !== 'string') {
    return reject('INVALID_REQUESTED_AS', 'requestedAs must be a string.');
  }

  return {
    ok: true,
    ownerId: ownerRaw ? BigInt(ownerRaw) : null,
    capturedAt,
    item: {
      clientUuid: clientUuid.toLowerCase(),
      kind: kind as SyncItemKind,
      ownerUserId: ownerRaw,
      requestedAs: (rec.requestedAs as string | null | undefined) ?? null,
      capturedAt: rec.capturedAt as string,
      payload: rec.payload,
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

export function ledgerClientEventId(clientUuid: string): string {
  return SYNC_LEDGER_PREFIX + clientUuid.toLowerCase();
}

function resultFromLedger(clientUuid: string, kind: SyncItemKind, row: SyncLedgerRow): SyncItemResult {
  const payload = isRecord(row.payload) ? row.payload : {};
  const storedKind = payload.kind;
  if (typeof storedKind === 'string' && storedKind !== kind) {
    return {
      clientUuid,
      status: 'REJECTED',
      code: 'CLIENT_UUID_REUSED',
      message: `This item id was already used for ${storedKind}.`,
    };
  }
  const stored = isRecord(payload.result) ? payload.result : {};
  const result: SyncItemResult = { clientUuid, status: 'DUPLICATE' };
  if (typeof stored.receipt === 'string') result.receipt = stored.receipt;
  const entityType = typeof stored.entityType === 'string' ? stored.entityType : row.entity_type;
  const entityId = typeof stored.entityId === 'string' ? stored.entityId : row.entity_id?.toString() ?? null;
  if (entityType) result.entityType = entityType;
  if (entityId) result.entityId = entityId;
  return result;
}

// ---------------------------------------------------------------------------
// Owner check
// ---------------------------------------------------------------------------

/** retry: the owner may become valid later (signs in on this phone) -> RETRY, never parked as REJECTED. */
type OwnerCheck = { ok: true; user: User } | { ok: false; code: string; message: string; retry?: boolean };

async function checkOwner(auth: SyncAuth, ownerId: bigint, deps: SyncBatchDeps): Promise<OwnerCheck> {
  if (auth.mode === 'SESSION') {
    if (String(auth.user.id).trim() !== ownerId.toString()) {
      return { ok: false, code: 'OWNER_NOT_ALLOWED', message: 'Items must belong to the signed-in user.' };
    }
  } else {
    // Device mode: the assigned user, or the user signed in on this phone right now (same request
    // carries the session cookie; a station PIN login creates that session). Earlier diary rows or a
    // station PIN alone never authorise an owner: the key alone must not let anyone submit as anyone.
    const device = auth.device;
    const assigned = device.assignedUserId !== null && device.assignedUserId === ownerId;
    const signedIn = auth.sessionUser != null && String(auth.sessionUser.id).trim() === ownerId.toString();
    const allowedOnDevice = assigned || signedIn || device.isSharedStation;
    if (!allowedOnDevice) {
      return {
        ok: false,
        code: 'OWNER_SESSION_REQUIRED',
        message: 'This work is sent when its owner is signed in on this phone.',
        retry: true,
      };
    }
  }

  const user = await deps.loadUser(ownerId);
  if (!user) return { ok: false, code: 'OWNER_NOT_FOUND', message: 'User not found or not active.' };
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function parseEntityId(value: string | undefined): bigint | null {
  return value && NUMERIC_ID_RE.test(value) ? BigInt(value) : null;
}

function clockDriftSeconds(deviceSentAt: unknown, now: Date): number | null {
  if (typeof deviceSentAt !== 'string') return null;
  const sent = new Date(deviceSentAt);
  if (Number.isNaN(sent.getTime())) return null;
  const drift = Math.round((sent.getTime() - now.getTime()) / 1000);
  // Column is INT; clamp absurd clocks.
  return Math.max(-2_000_000_000, Math.min(2_000_000_000, drift));
}

export async function processSyncBatch(request: unknown, auth: SyncAuth, deps: SyncBatchDeps): Promise<SyncBatchOutcome> {
  const now = deps.now ?? (() => new Date());
  const serverTime = () => now().toISOString();
  const device = auth.device;

  // Blocked / released / pending device: nothing is processed or written.
  if (device && device.status !== 'ACTIVE') {
    return {
      httpStatus: 403,
      body: { error: 'This device is not allowed to send data. Contact the office.', code: 'DEVICE_NOT_ACTIVE', deviceStatus: device.status, serverTime: serverTime() },
    };
  }

  if (!isRecord(request) || !Array.isArray(request.items)) {
    return { httpStatus: 400, body: { error: 'Body must be a sync batch with an items array.', code: 'INVALID_BATCH', serverTime: serverTime() } };
  }
  const batch = request as unknown as SyncBatchRequest;
  if (batch.items.length > SYNC_BATCH_MAX_ITEMS) {
    return {
      httpStatus: 400,
      body: { error: `At most ${SYNC_BATCH_MAX_ITEMS} items per batch.`, code: 'BATCH_TOO_LARGE', serverTime: serverTime() },
    };
  }
  if (device && typeof batch.deviceUid === 'string' && batch.deviceUid.trim() && batch.deviceUid.trim() !== device.deviceUid) {
    return { httpStatus: 400, body: { error: 'deviceUid does not match the authenticated device.', code: 'DEVICE_MISMATCH', serverTime: serverTime() } };
  }

  const ownerCache = new Map<string, OwnerCheck>();
  const results: SyncItemResult[] = [];

  for (const raw of batch.items) {
    const valid = validateItem(raw);
    if (!valid.ok) {
      results.push(valid.result);
      continue;
    }
    const { item, ownerId, capturedAt } = valid;
    const clientUuid = item.clientUuid;
    try {
      results.push(await processItem(item, ownerId, capturedAt, auth, deps, ownerCache));
    } catch (err) {
      results.push(classifyThrown(clientUuid, err));
    }
  }

  if (device) {
    const heartbeat: DeviceHeartbeat = {};
    if (typeof batch.appVersion === 'string' && batch.appVersion.trim()) heartbeat.last_app_version = batch.appVersion.trim().slice(0, 30);
    const drift = clockDriftSeconds(batch.deviceSentAt, now());
    if (drift !== null) heartbeat.last_clock_drift_seconds = drift;
    try {
      await touchDeviceLastSeen(deps.db, device.id, heartbeat);
    } catch {
      // last_seen is best effort; item results are already final.
    }
  }

  return {
    httpStatus: 200,
    body: { serverTime: serverTime(), deviceStatus: device?.status ?? 'PENDING', results },
  };
}

async function processItem(
  item: SyncItem,
  ownerId: bigint | null,
  capturedAt: Date,
  auth: SyncAuth,
  deps: SyncBatchDeps,
  ownerCache: Map<string, OwnerCheck>
): Promise<SyncItemResult> {
  const { clientUuid, kind } = item;
  const device = auth.device;
  const ledgerId = ledgerClientEventId(clientUuid);

  // 1. Ledger: already processed on this device?
  if (device) {
    const existing = await deps.db.deviceActivityEvent.findUnique({
      where: { device_id_client_event_id: { device_id: device.id, client_event_id: ledgerId } },
    });
    if (existing) return resultFromLedger(clientUuid, kind, existing);
  }

  // 2. Owner must be allowed on this device (or be the session user).
  //    Housekeeping on device auth falls back to the device's assigned user.
  const housekeeping = isHousekeepingKind(kind);
  let ownerUser: User | null = null;
  let ledgerUserId: bigint | null = null;
  let claimedOwnerUserId: string | null = null;
  if (ownerId !== null) {
    const cacheKey = ownerId.toString();
    let owner = ownerCache.get(cacheKey);
    if (!owner) {
      owner = await checkOwner(auth, ownerId, deps);
      ownerCache.set(cacheKey, owner);
    }
    if (owner.ok) {
      ownerUser = owner.user;
      ledgerUserId = ownerId;
    } else if (housekeeping && auth.mode === 'DEVICE') {
      // Kept as a claim only; never used as user_id (that would vouch for this owner on the device).
      claimedOwnerUserId = cacheKey;
    } else {
      return { clientUuid, status: owner.retry ? 'RETRY' : 'REJECTED', code: owner.code, message: owner.message };
    }
  } else if (auth.mode !== 'DEVICE') {
    return { clientUuid, status: 'REJECTED', code: 'INVALID_OWNER', message: 'ownerUserId must be a numeric user id.' };
  }
  const attributedToDevice = ledgerUserId === null;
  if (attributedToDevice && auth.mode === 'DEVICE' && auth.device.assignedUserId !== null) {
    const assignedId = auth.device.assignedUserId;
    const cacheKey = `assigned:${assignedId.toString()}`;
    let assigned = ownerCache.get(cacheKey);
    if (!assigned) {
      const user = await deps.loadUser(assignedId);
      assigned = user ? { ok: true, user } : { ok: false, code: 'OWNER_NOT_FOUND', message: 'User not found or not active.' };
      ownerCache.set(cacheKey, assigned);
    }
    ledgerUserId = assignedId;
    ownerUser = assigned.ok ? assigned.user : null;
  }

  // 3. Acting role, re-resolved on the server from the owner's DB user.
  const allowed = SYNC_KIND_ALLOWED_ROLES[kind];
  let acting: ActingContext | null = null;
  if (allowed) {
    if (!ownerUser) return { clientUuid, status: 'REJECTED', code: 'INVALID_OWNER', message: 'ownerUserId must be a numeric user id.' };
    const resolved = resolveActingContext(ownerUser, allowed, { requestedAs: item.requestedAs ?? null });
    if (!resolved.ok) {
      return { clientUuid, status: 'REJECTED', code: resolved.code, message: 'This user may not do this work.' };
    }
    acting = resolved.ctx;
  }

  const handler = deps.handlers[kind];
  if (!handler) return { clientUuid, status: 'REJECTED', code: 'NOT_SUPPORTED_YET', message: `${kind} is not supported yet.` };

  // 4. Run the domain handler.
  const handled = await handler({ item, owner: ownerUser, acting, device, db: deps.db });
  if (isFailure(handled)) {
    return { clientUuid, status: handled.status, code: handled.code, message: handled.message };
  }
  const outcome: SyncHandlerSuccess = handled;

  const result: SyncItemResult = { clientUuid, status: outcome.status };
  if (outcome.receipt) result.receipt = outcome.receipt;
  if (outcome.entityType) result.entityType = outcome.entityType;
  if (outcome.entityId) result.entityId = outcome.entityId;
  if (outcome.code) result.code = outcome.code;
  if (outcome.message) result.message = outcome.message;

  // No registered device (session fallback): domain idempotency only, no ledger row.
  if (!device) return result;

  // 5. Ledger row (also the diary entry for this item).
  const actor: { performed_as_role: string | null; is_delegated: boolean } = acting
    ? primaryActorFields(acting)
    : { performed_as_role: ownerUser ? String(ownerUser.role) : null, is_delegated: false };
  const payload: SyncLedgerPayload = {
    ...(outcome.ledgerExtra ?? {}),
    kind,
    result: {
      status: outcome.status,
      receipt: outcome.receipt ?? null,
      entityType: outcome.entityType ?? null,
      entityId: outcome.entityId ?? null,
    },
  };
  if (outcome.diary) payload.data = outcome.diary;
  if (attributedToDevice) payload.attributedTo = 'DEVICE';
  if (claimedOwnerUserId) payload.claimedOwnerUserId = claimedOwnerUserId;

  try {
    const row = await deps.db.deviceActivityEvent.create({
      data: {
        device_id: device.id,
        user_id: ledgerUserId,
        performed_as_role: actor.performed_as_role,
        is_delegated: actor.is_delegated,
        event_type: (outcome.eventType ?? SYNC_LEDGER_EVENT_PREFIX + kind).slice(0, 50),
        entity_type: outcome.entityType ? outcome.entityType.slice(0, 50) : null,
        entity_id: parseEntityId(outcome.entityId),
        client_event_id: ledgerId,
        payload,
        device_occurred_at: outcome.occurredAt ?? capturedAt,
      },
    });
    if (!result.entityType) {
      // Device housekeeping items: the diary row itself is the record.
      result.entityType = 'device_activity_event';
      result.entityId = row.id.toString();
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Another request for the same item won the race: report its stored result.
      const stored = await deps.db.deviceActivityEvent.findUnique({
        where: { device_id_client_event_id: { device_id: device.id, client_event_id: ledgerId } },
      });
      if (stored) return resultFromLedger(clientUuid, kind, stored);
      return { ...result, status: 'DUPLICATE' };
    }
    throw err;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Device housekeeping handlers (no Prisma import: testable with an injected db)
// ---------------------------------------------------------------------------

function payloadRecord(ctx: SyncHandlerContext): Record<string, unknown> {
  if (!isRecord(ctx.item.payload)) throw new SyncValidationError('payload must be an object.');
  return ctx.item.payload;
}

function requireDevice(ctx: SyncHandlerContext) {
  if (!ctx.device) throw new SyncValidationError('This item needs a registered device.', 'DEVICE_REQUIRED');
  return ctx.device;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SyncValidationError(`${field} must be a number.`);
  return n;
}

function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new SyncValidationError(`${field} must be an ISO date-time.`);
  return d;
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Diary event types the server writes itself (login routes, deviceService, stationPinService,
 * this service's own ledger rows). A client-sent DEVICE_EVENT never uses them as is.
 */
export const SERVER_ONLY_EVENT_TYPES: readonly string[] = [
  'LOGIN',
  'HEARTBEAT',
  'REGISTERED',
  'ASSIGNED',
  'RELEASED',
  'BLOCKED',
  'KEY_ROTATED',
  'DEVICE_REGISTERED',
  'DEVICE_ASSIGNED',
  'DEVICE_RELEASED',
  'DEVICE_BLOCKED',
  'DEVICE_KEY_ROTATED',
  ...SYNC_ITEM_KINDS.map((k) => SYNC_LEDGER_EVENT_PREFIX + k),
];
const SERVER_ONLY_EVENT_PREFIXES: readonly string[] = ['STATION_PIN_'];

/** Reserved (server-only) types are kept with a CLIENT_ prefix (e.g. LOGIN -> CLIENT_LOGIN), not refused. */
export function clientDiaryEventType(eventType: string): string {
  const reserved = SERVER_ONLY_EVENT_TYPES.includes(eventType) || SERVER_ONLY_EVENT_PREFIXES.some((p) => eventType.startsWith(p));
  return reserved ? ('CLIENT_' + eventType).slice(0, 50) : eventType;
}

/**
 * DEVICE_EVENT: one activity-diary entry. The ledger row written by the
 * batch service IS the diary event (event_type = payload.eventType; server-only types get a
 * CLIENT_ prefix, see clientDiaryEventType).
 * payload: { eventType: string (A-Z, 0-9, _; <= 50), entityType?: string,
 *            entityId?: string (numeric), details?: object | null (<= 8 KB JSON),
 *            occurredAt?: ISO string (device time; becomes device_occurred_at),
 *            online?: boolean | null (navigator.onLine when logged) }
 * The client (pwa/diary.ts) sends { eventType, details, occurredAt, online }.
 */
export const handleDeviceEvent: SyncHandler = async (ctx) => {
  requireDevice(ctx);
  const payload = payloadRecord(ctx);
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(eventType)) {
    throw new SyncValidationError('eventType must be 2-50 letters, digits or underscores.');
  }
  const details = payload.details === undefined || payload.details === null ? undefined : payload.details;
  if (details !== undefined && !isRecord(details)) throw new SyncValidationError('details must be an object.');
  if (details !== undefined && JSON.stringify(details).length > 8192) {
    throw new SyncValidationError('details is too large (max 8 KB).');
  }
  const entityType = optionalString(payload.entityType, 50);
  const entityId = typeof payload.entityId === 'string' && /^\d+$/.test(payload.entityId.trim()) ? payload.entityId.trim() : null;

  const occurredAt = optionalDate(payload.occurredAt, 'occurredAt');
  const online = typeof payload.online === 'boolean' ? payload.online : null;

  const outcome: SyncHandlerSuccess = {
    status: 'SAVED',
    eventType: clientDiaryEventType(eventType),
    diary: details ?? {},
    ledgerExtra: { occurredAt: occurredAt ? occurredAt.toISOString() : null, online },
  };
  if (occurredAt) outcome.occurredAt = occurredAt;
  if (entityType && entityId) {
    outcome.entityType = entityType;
    outcome.entityId = entityId;
  }
  return outcome;
};

/**
 * HEARTBEAT: device health into Device.last_* columns.
 * payload: { appVersion?: string, unsentCount?: number, oldestUnsentAt?: ISO string | null,
 *            freeStorageMb?: number, batteryPercent?: number, charging?: boolean,
 *            latitude?: number, longitude?: number, gpsAccuracyM?: number }
 * Device has no battery/GPS columns (prisma/schema.prisma), so those are
 * kept only in the diary row's payload.
 */
export const handleHeartbeat: SyncHandler = async (ctx) => {
  const device = requireDevice(ctx);
  const payload = payloadRecord(ctx);

  const update: DeviceHeartbeat = {};
  const appVersion = optionalString(payload.appVersion, 30);
  if (appVersion) update.last_app_version = appVersion;
  const unsent = optionalNumber(payload.unsentCount, 'unsentCount');
  if (unsent !== null) update.last_unsent_count = Math.max(0, Math.round(unsent));
  if ('oldestUnsentAt' in payload) update.last_oldest_unsent_at = optionalDate(payload.oldestUnsentAt, 'oldestUnsentAt');
  const freeMb = optionalNumber(payload.freeStorageMb, 'freeStorageMb');
  if (freeMb !== null) update.last_free_storage_mb = Math.max(0, Math.round(freeMb));

  const battery = optionalNumber(payload.batteryPercent, 'batteryPercent');
  const latitude = optionalNumber(payload.latitude, 'latitude');
  const longitude = optionalNumber(payload.longitude, 'longitude');
  const gpsAccuracyM = optionalNumber(payload.gpsAccuracyM, 'gpsAccuracyM');
  if (latitude !== null && (latitude < -90 || latitude > 90)) throw new SyncValidationError('latitude out of range.');
  if (longitude !== null && (longitude < -180 || longitude > 180)) throw new SyncValidationError('longitude out of range.');

  await touchDeviceLastSeen(ctx.db, device.id, update);

  return {
    status: 'SAVED',
    eventType: 'HEARTBEAT',
    diary: {
      appVersion,
      unsentCount: update.last_unsent_count ?? null,
      oldestUnsentAt: update.last_oldest_unsent_at ? update.last_oldest_unsent_at.toISOString() : null,
      freeStorageMb: update.last_free_storage_mb ?? null,
      batteryPercent: battery,
      charging: typeof payload.charging === 'boolean' ? payload.charging : null,
      latitude,
      longitude,
      gpsAccuracyM,
    },
  };
};

/**
 * Default dependencies for the API route (lazy Prisma import so tests that
 * inject their own deps never load the DB client).
 */
export async function createDefaultSyncDeps(handlers: SyncHandlerRegistry): Promise<SyncBatchDeps> {
  const { prisma } = await import('../../core/db');
  return {
    db: prisma as unknown as SyncDb,
    handlers,
    loadUser: (userId) => loadActiveUser(prisma as unknown as LoadUserDb, userId),
  };
}

interface LoadUserDb {
  user: {
    findUnique(args: {
      where: { id: bigint };
      select: Record<string, unknown>;
    }): Promise<{
      id: bigint;
      username: string;
      full_name: string | null;
      role: string;
      department: string | null;
      scope_type: string;
      procurement_source_id: bigint | null;
      is_active: boolean;
      last_login_at: Date | null;
      procurement_source: { id: bigint; code: string; name: string; source_type: string; is_active: boolean } | null;
    } | null>;
  };
}

/** Same User shape getCurrentUser builds, read from the DB by id; null when missing or inactive. */
export async function loadActiveUser(db: LoadUserDb, userId: bigint): Promise<User | null> {
  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      full_name: true,
      role: true,
      department: true,
      scope_type: true,
      procurement_source_id: true,
      is_active: true,
      last_login_at: true,
      procurement_source: { select: { id: true, code: true, name: true, source_type: true, is_active: true } },
    },
  });
  if (!dbUser || !dbUser.is_active) return null;
  return {
    id: dbUser.id.toString(),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as User['role'],
    department: dbUser.department || '',
    zone: null,
    scope_type: dbUser.scope_type,
    procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
    procurement_source: dbUser.procurement_source
      ? {
          id: dbUser.procurement_source.id.toString(),
          code: dbUser.procurement_source.code,
          name: dbUser.procurement_source.name,
          source_type: dbUser.procurement_source.source_type,
          is_active: dbUser.procurement_source.is_active,
        }
      : null,
    last_login_at: dbUser.last_login_at ? dbUser.last_login_at.toISOString() : null,
  };
}
