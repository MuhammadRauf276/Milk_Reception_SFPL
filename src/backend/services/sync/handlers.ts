/**
 * Sync item handlers (Phase 3): one per SyncItemKind.
 *
 * Domain kinds call the existing service functions with the owner's DB user
 * (they accept `Request | User` and re-check role/scope themselves), so the
 * rules are exactly the same as the online endpoints. Each payload is the
 * JSON body the matching endpoint accepts today. When the payload has no
 * client_event_id, the item's clientUuid is used, so the domain table's own
 * unique client id also guards against double saves.
 *
 * This module imports the Prisma-backed services; tests inject fake
 * handlers into processSyncBatch instead of importing this file.
 */
import { recordGpsBatch, resolveMotAuth, skipJourneyStop, submitShopCollection } from '../mot/motCore';
import type { GpsLocationItem, ServiceResult, SubmitCollectionPayload } from '../mot/motCore';
import { submitLocalSupplierArrival, submitMotArrival } from '../zmccArrival/zmccArrivalCore';
import type { SubmitLocalSupplierArrivalPayload, SubmitMotArrivalPayload } from '../zmccArrival/zmccArrivalCore';
import { touchDeviceLastSeen, type DeviceHeartbeat } from '../../core/device-auth';
import {
  SyncValidationError,
  type SyncHandler,
  type SyncHandlerContext,
  type SyncHandlerOutcome,
  type SyncHandlerSuccess,
  type SyncHandlerRegistry,
} from './syncBatchService';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payloadObject(ctx: SyncHandlerContext): Json {
  if (!isRecord(ctx.item.payload)) throw new SyncValidationError('payload must be an object.');
  return ctx.item.payload;
}

/** Payload copy with client_event_id defaulting to the item's clientUuid. */
function withClientEventId(ctx: SyncHandlerContext): Json {
  const payload = payloadObject(ctx);
  const given = typeof payload.client_event_id === 'string' ? payload.client_event_id.trim() : '';
  return { ...payload, client_event_id: given || ctx.item.clientUuid };
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

// ---------------------------------------------------------------------------
// ServiceResult -> outcome
// ---------------------------------------------------------------------------

/** Leading 'CODE:' in an error message (e.g. 'QUALITY_REJECTED: ...'). */
function codeFromMessage(message: string): string | null {
  const match = /^([A-Z][A-Z0-9_]{2,}):/.exec(message);
  return match ? match[1] : null;
}

/** Maps a non-2xx ServiceResult to REJECTED (business/validation) or RETRY (server/transient). */
export function failureOutcome(res: ServiceResult<unknown>): SyncHandlerOutcome {
  const message = res.error || 'Request failed.';
  const embedded = codeFromMessage(message);
  if (res.status >= 500) return { status: 'RETRY', code: 'SERVER_ERROR', message };
  if (res.status === 409 && /retry/i.test(message)) return { status: 'RETRY', code: 'CONFLICT_RETRY', message };
  let code: string;
  if (res.status === 401 || res.status === 403) code = 'FORBIDDEN';
  else if (res.status === 404) code = 'NOT_FOUND';
  else if (res.status === 409) code = 'CONFLICT';
  else if (res.status === 422) code = 'BUSINESS_RULE';
  else code = 'VALIDATION';
  return { status: 'REJECTED', code: embedded ?? code, message };
}

interface SuccessMapping {
  entityType: string;
  /** Field of the response data holding the human receipt number. */
  receiptField?: string;
  /** True when the 2xx response is a replay of an earlier save. */
  isReplay(res: ServiceResult<unknown>, data: Json): boolean;
}

export function mapServiceResult(res: ServiceResult<unknown>, mapping: SuccessMapping): SyncHandlerOutcome {
  if (res.error || res.status < 200 || res.status >= 300) return failureOutcome(res);
  const data = isRecord(res.data) ? res.data : {};
  const outcome: SyncHandlerSuccess = {
    status: mapping.isReplay(res, data) ? 'DUPLICATE' : 'SAVED',
    entityType: mapping.entityType,
  };
  if (data.id !== undefined && data.id !== null) outcome.entityId = String(data.id);
  const receipt = mapping.receiptField ? data[mapping.receiptField] : undefined;
  if (typeof receipt === 'string' && receipt) outcome.receipt = receipt;
  return outcome;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * DEVICE_EVENT: one activity-diary entry. The ledger row written by the
 * batch service IS the diary event (event_type = payload.eventType).
 * payload: { eventType: string (A-Z, 0-9, _; <= 50), entityType?: string,
 *            entityId?: string (numeric), details?: object (<= 8 KB JSON) }
 */
export const handleDeviceEvent: SyncHandler = async (ctx) => {
  requireDevice(ctx);
  const payload = payloadObject(ctx);
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

  const outcome: SyncHandlerSuccess = { status: 'SAVED', eventType, diary: details ?? {} };
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
  const payload = payloadObject(ctx);

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
 * MOT_COLLECTION -> submitShopCollection. Same body as
 * POST /api/zmcc/mot/journeys/current/collections (offlineStore.ts sends):
 * { client_event_id, journey_id, stop_id | journey_stop_id, shop_rmr_number?, milk_source_id?,
 *   quantity | quantity_value, unit | quantity_unit ('LITER'|'KG'), lr, fat,
 *   recorded_latitude | latitude, recorded_longitude | longitude, recorded_gps_accuracy | gps_accuracy,
 *   notes | collection_notes, request_exception?, exception_reason?, offline_created_at | device_collected_at }
 * Replay of the same client_event_id returns 200 (new = 201) -> DUPLICATE.
 */
export const handleMotCollection: SyncHandler = async (ctx) => {
  const body = withClientEventId(ctx) as unknown as SubmitCollectionPayload;
  const res = await submitShopCollection(ctx.owner, body);
  return mapServiceResult(res, {
    entityType: 'mot_shop_collection',
    receiptField: 'collection_number',
    isReplay: (r) => r.status === 200,
  });
};

/**
 * MOT_GPS_BATCH -> recordGpsBatch. Same body as
 * POST /api/zmcc/mot/journeys/current/locations/batch:
 * { journey_id, locations: [{ client_location_id, journey_id, latitude, longitude, gps_accuracy?, device_recorded_at }] } (<= 500 points)
 * Per point the service is idempotent on client_location_id. All points
 * ALREADY_PROCESSED -> DUPLICATE; none accepted -> REJECTED; some dropped -> SAVED with code PARTIAL.
 */
export const handleMotGpsBatch: SyncHandler = async (ctx) => {
  const body = payloadObject(ctx) as unknown as { locations: GpsLocationItem[]; journey_id?: string | number | bigint };
  const res = await recordGpsBatch(ctx.owner, body);
  if (res.error || res.status < 200 || res.status >= 300) return failureOutcome(res);

  const data = isRecord(res.data) ? res.data : {};
  const items = Array.isArray(data.results) ? (data.results as Array<{ status?: string }>) : [];
  const total = items.length;
  const accepted = items.filter((p) => p.status === 'ACCEPTED').length;
  const replayed = items.filter((p) => p.status === 'ALREADY_PROCESSED').length;
  const dropped = total - accepted - replayed;
  const journeyId = body.journey_id ?? body.locations?.[0]?.journey_id;

  if (accepted + replayed === 0) {
    return { status: 'REJECTED', code: 'GPS_POINTS_REJECTED', message: `All ${total} GPS points were rejected.` };
  }
  const outcome: SyncHandlerSuccess = {
    status: accepted === 0 ? 'DUPLICATE' : 'SAVED',
    entityType: 'mot_journey',
    diary: { total, accepted, replayed, dropped },
  };
  if (journeyId !== undefined && journeyId !== null) outcome.entityId = String(journeyId);
  if (dropped > 0) {
    outcome.code = 'PARTIAL';
    outcome.message = `${dropped} of ${total} GPS points were rejected.`;
  }
  return outcome;
};

/**
 * MOT_STOP_SKIP -> resolveMotAuth(owner, 'SKIP_STOP') + skipJourneyStop.
 * Body of POST /api/zmcc/mot/journeys/stops/[id]/skip plus the stop id
 * (offlineStore QueuedSkip): { stop_id, skip_reason | reason, journey_id?, client_event_id? }
 * Re-skipping with the same reason returns 200 again; the sync ledger reports repeats as DUPLICATE.
 */
export const handleMotStopSkip: SyncHandler = async (ctx) => {
  const payload = payloadObject(ctx);
  const stopId = payload.stop_id ?? payload.journey_stop_id;
  if (stopId === undefined || stopId === null || !/^\d+$/.test(String(stopId).trim())) {
    throw new SyncValidationError('stop_id is required.');
  }
  const reason = typeof payload.skip_reason === 'string' ? payload.skip_reason : typeof payload.reason === 'string' ? payload.reason : '';

  const { auth, errorResponse } = await resolveMotAuth(ctx.owner, 'SKIP_STOP');
  if (errorResponse) return failureOutcome(errorResponse);
  if (!auth) return { status: 'REJECTED', code: 'FORBIDDEN', message: 'Unauthorized.' };

  const res = await skipJourneyStop(auth, String(stopId).trim(), reason);
  return mapServiceResult(res, { entityType: 'mot_journey_stop', isReplay: () => false });
};

/**
 * ZMCC_MOT_ARRIVAL -> submitMotArrival. Same body as POST /api/zmcc/arrivals/mot:
 * { journey_id, route_milk_token?, raw_milk_token_number?, arrival_timestamp, client_event_id,
 *   phe_latitude?, phe_longitude?, phe_gps_accuracy?, zmcc_id? }
 * Replay (same client_event_id, same values) returns 200 + is_replay -> DUPLICATE.
 */
export const handleZmccMotArrival: SyncHandler = async (ctx) => {
  const body = withClientEventId(ctx) as unknown as SubmitMotArrivalPayload;
  const res = await submitMotArrival(ctx.owner, body);
  return mapServiceResult(res, {
    entityType: 'zmcc_mot_arrival',
    receiptField: 'zmcc_token',
    isReplay: (_r, data) => data.is_replay === true,
  });
};

/**
 * ZMCC_LOCAL_SUPPLIER_ARRIVAL -> submitLocalSupplierArrival. Same body as
 * POST /api/zmcc/arrivals/local-supplier:
 * { local_supplier_id, milk_source_id?, rmr_number?, raw_milk_token_number?, vehicle_number,
 *   arrival_timestamp?, client_event_id, phe_latitude?, phe_longitude?, phe_gps_accuracy?,
 *   zmcc_id?, target_zmcc_id? }
 * Replay returns 200 + is_replay -> DUPLICATE.
 */
export const handleZmccLocalSupplierArrival: SyncHandler = async (ctx) => {
  const body = withClientEventId(ctx) as unknown as SubmitLocalSupplierArrivalPayload;
  const res = await submitLocalSupplierArrival(ctx.owner, body);
  return mapServiceResult(res, {
    entityType: 'zmcc_local_supplier_arrival',
    receiptField: 'zmcc_token',
    isReplay: (_r, data) => data.is_replay === true,
  });
};

export const SYNC_HANDLERS: SyncHandlerRegistry = {
  DEVICE_EVENT: handleDeviceEvent,
  HEARTBEAT: handleHeartbeat,
  MOT_COLLECTION: handleMotCollection,
  MOT_GPS_BATCH: handleMotGpsBatch,
  MOT_STOP_SKIP: handleMotStopSkip,
  ZMCC_MOT_ARRIVAL: handleZmccMotArrival,
  ZMCC_LOCAL_SUPPLIER_ARRIVAL: handleZmccLocalSupplierArrival,
};
