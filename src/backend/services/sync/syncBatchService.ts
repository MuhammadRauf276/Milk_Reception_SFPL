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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    findFirst(args: { where: { device_id: bigint; user_id: bigint }; select: { id: true } }): Promise<{ id: bigint } | null>;
    create(args: { data: SyncLedgerCreateData }): Promise<{ id: bigint }>;
  };
  stationPin: {
    findFirst(args: { where: { device_id: bigint; user_id: bigint }; select: { id: true } }): Promise<{ id: bigint } | null>;
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
  owner: User;
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
  | { mode: 'DEVICE'; device: AuthenticatedDevice }
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

type ValidItem = { ok: true; item: SyncItem; ownerId: bigint; capturedAt: Date } | { ok: false; result: SyncItemResult };

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
  if (!NUMERIC_ID_RE.test(ownerRaw)) return reject('INVALID_OWNER', 'ownerUserId must be a numeric user id.');
  const capturedAt = typeof rec.capturedAt === 'string' ? new Date(rec.capturedAt) : new Date(NaN);
  if (Number.isNaN(capturedAt.getTime())) return reject('INVALID_CAPTURED_AT', 'capturedAt must be an ISO date-time.');
  if (rec.requestedAs !== undefined && rec.requestedAs !== null && typeof rec.requestedAs !== 'string') {
    return reject('INVALID_REQUESTED_AS', 'requestedAs must be a string.');
  }

  return {
    ok: true,
    ownerId: BigInt(ownerRaw),
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

type OwnerCheck = { ok: true; user: User } | { ok: false; code: string; message: string };

async function checkOwner(auth: SyncAuth, ownerId: bigint, deps: SyncBatchDeps): Promise<OwnerCheck> {
  if (auth.mode === 'SESSION') {
    if (String(auth.user.id).trim() !== ownerId.toString()) {
      return { ok: false, code: 'OWNER_NOT_ALLOWED', message: 'Items must belong to the signed-in user.' };
    }
  } else {
    const device = auth.device;
    let allowed = device.assignedUserId !== null && device.assignedUserId === ownerId;
    if (!allowed) {
      const pin = await deps.db.stationPin.findFirst({ where: { device_id: device.id, user_id: ownerId }, select: { id: true } });
      allowed = pin !== null;
    }
    if (!allowed) {
      const prior = await deps.db.deviceActivityEvent.findFirst({
        where: { device_id: device.id, user_id: ownerId },
        select: { id: true },
      });
      allowed = prior !== null;
    }
    if (!allowed) {
      return { ok: false, code: 'OWNER_NOT_ALLOWED', message: 'This user has never worked on this device.' };
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
  ownerId: bigint,
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
  const cacheKey = ownerId.toString();
  let owner = ownerCache.get(cacheKey);
  if (!owner) {
    owner = await checkOwner(auth, ownerId, deps);
    ownerCache.set(cacheKey, owner);
  }
  if (!owner.ok) return { clientUuid, status: 'REJECTED', code: owner.code, message: owner.message };

  // 3. Acting role, re-resolved on the server from the owner's DB user.
  const allowed = SYNC_KIND_ALLOWED_ROLES[kind];
  let acting: ActingContext | null = null;
  if (allowed) {
    const resolved = resolveActingContext(owner.user, allowed, { requestedAs: item.requestedAs ?? null });
    if (!resolved.ok) {
      return { clientUuid, status: 'REJECTED', code: resolved.code, message: 'This user may not do this work.' };
    }
    acting = resolved.ctx;
  }

  const handler = deps.handlers[kind];
  if (!handler) return { clientUuid, status: 'REJECTED', code: 'NOT_SUPPORTED_YET', message: `${kind} is not supported yet.` };

  // 4. Run the domain handler.
  const handled = await handler({ item, owner: owner.user, acting, device, db: deps.db });
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
  const actor = acting
    ? primaryActorFields(acting)
    : { performed_as_role: String(owner.user.role), is_delegated: false };
  const payload: SyncLedgerPayload = {
    kind,
    result: {
      status: outcome.status,
      receipt: outcome.receipt ?? null,
      entityType: outcome.entityType ?? null,
      entityId: outcome.entityId ?? null,
    },
  };
  if (outcome.diary) payload.data = outcome.diary;

  try {
    const row = await deps.db.deviceActivityEvent.create({
      data: {
        device_id: device.id,
        user_id: ownerId,
        performed_as_role: actor.performed_as_role,
        is_delegated: actor.is_delegated,
        event_type: (outcome.eventType ?? `SYNC_${kind}`).slice(0, 50),
        entity_type: outcome.entityType ? outcome.entityType.slice(0, 50) : null,
        entity_id: parseEntityId(outcome.entityId),
        client_event_id: ledgerId,
        payload,
        device_occurred_at: capturedAt,
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
