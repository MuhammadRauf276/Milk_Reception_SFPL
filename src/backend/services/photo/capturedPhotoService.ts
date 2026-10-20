// Saves a live-camera photo: checks the file, writes it outside public/, records the CapturedPhoto row and audit.
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { CapturedPhotoMeta, CapturedPhotoUploadResult } from '@/types/captured-photo';
import type { TestPointCode } from '@/types/test-point-policy';
import type { ResourceRef } from '@/types/acting';
import { writeAuditLog, type AuditActor, type AuditDb } from '@/backend/core/audit';

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const CLOCK_MISMATCH_SECONDS = 600;

const TEST_POINTS: readonly TestPointCode[] = [
  'MOT_SHOP',
  'ZMCC_LAB_MC',
  'ZMCC_LAB_HC',
  'ZMCC_DISPATCH',
  'CONTRACTOR_DISPATCH',
  'PLANT_QA',
];
const PHOTO_KINDS = ['TEST_RESULT', 'LAB_REPORT', 'TANKER_WASH', 'OTHER'] as const;

/** Record types a photo may be attached to (stored lower case). Anything else is refused. */
export const PHOTO_ENTITY_TYPES = [
  'mot_shop_collection',
  'zmcc_lab_session',
  'zmcc_lab_portion',
  'zmcc_lab_result',
  'vehicle_visit',
  'visit_portion',
  'dispatch_info',
  'dispatch_portion',
  'plant_portion_test',
] as const;
export type PhotoEntityType = (typeof PHOTO_ENTITY_TYPES)[number];

export function normalizeEntityType(value: unknown): PhotoEntityType | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (PHOTO_ENTITY_TYPES as readonly string[]).includes(v) ? (v as PhotoEntityType) : null;
}

export type PhotoErrorCode = 'INVALID_META' | 'INVALID_FILE' | 'TOO_LARGE' | 'HASH_MISMATCH' | 'UNKNOWN_ENTITY';

export class PhotoError extends Error {
  constructor(public code: PhotoErrorCode, message: string, public status = 400) {
    super(message);
    this.name = 'PhotoError';
  }
}

export interface CapturedPhotoRow {
  id: bigint;
  capture_id: string;
  sha256: string;
  file_path: string;
  entity_type: string;
  entity_id: bigint;
  captured_by: bigint;
  device_id: bigint | null;
  clock_drift_seconds: number | null;
}

export interface PhotoDb extends AuditDb {
  /** Present on the real Prisma client; row + audit are written in one transaction. */
  $transaction?<T>(fn: (tx: PhotoDb) => Promise<T>): Promise<T>;
  capturedPhoto: {
    findUnique(args: { where: { capture_id: string } }): Promise<CapturedPhotoRow | null>;
    findFirst(args: {
      where: { sha256: string; NOT: { entity_type: string; entity_id: bigint } };
      select: { id: true };
    }): Promise<{ id: bigint } | null>;
    create(args: { data: Record<string, unknown> }): Promise<CapturedPhotoRow>;
  };
}

export interface PhotoFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: Buffer): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(file: string): Promise<unknown>;
}

type Row = Record<string, unknown>;
export interface EntityDb {
  [model: string]: { findUnique(args: unknown): Promise<Row | null> };
}

function pick(row: Row | null, ...keys: string[]): unknown {
  let cur: unknown = row;
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Row)[key];
  }
  return cur ?? null;
}

/**
 * Loads the record a photo is attached to and returns its owning source (ZMCC / contractor) for the scope check.
 * Returns null when the record does not exist.
 */
export async function resolveEntityRef(
  type: PhotoEntityType,
  entityId: bigint,
  db: EntityDb
): Promise<ResourceRef | null> {
  const where = { id: entityId };
  const visitSource = { visit: { select: { procurement_source_id: true } } };
  let sourceId: unknown;
  let zmcc = false;
  switch (type) {
    case 'mot_shop_collection': {
      const r = await db.motShopCollection.findUnique({ where, select: { zmcc_id: true } });
      if (!r) return null;
      sourceId = pick(r, 'zmcc_id');
      zmcc = true;
      break;
    }
    case 'zmcc_lab_session': {
      const r = await db.zmccLabSession.findUnique({ where, select: { zmcc_id: true } });
      if (!r) return null;
      sourceId = pick(r, 'zmcc_id');
      zmcc = true;
      break;
    }
    case 'zmcc_lab_portion': {
      const r = await db.zmccLabPortion.findUnique({ where, select: { lab_session: { select: { zmcc_id: true } } } });
      if (!r) return null;
      sourceId = pick(r, 'lab_session', 'zmcc_id');
      zmcc = true;
      break;
    }
    case 'zmcc_lab_result': {
      const r = await db.zmccLabResult.findUnique({ where, select: { session: { select: { zmcc_id: true } } } });
      if (!r) return null;
      sourceId = pick(r, 'session', 'zmcc_id');
      zmcc = true;
      break;
    }
    case 'vehicle_visit': {
      const r = await db.vehicleVisit.findUnique({ where, select: { procurement_source_id: true } });
      if (!r) return null;
      sourceId = pick(r, 'procurement_source_id');
      break;
    }
    case 'dispatch_info': {
      const r = await db.dispatchInfo.findUnique({ where, select: { portion: { select: visitSource } } });
      if (!r) return null;
      sourceId = pick(r, 'portion', 'visit', 'procurement_source_id');
      break;
    }
    default: {
      // visit_portion, dispatch_portion, plant_portion_test
      const r = await db.visitPortion.findUnique({ where, select: visitSource });
      if (!r) return null;
      sourceId = pick(r, 'visit', 'procurement_source_id');
    }
  }
  if (typeof sourceId !== 'bigint') return { sourceId: null, sourceType: zmcc ? 'ZMCC' : null };
  if (zmcc) return { sourceId, sourceType: 'ZMCC' };
  const src = await db.procurementSource.findUnique({ where: { id: sourceId }, select: { source_type: true } });
  const st = pick(src, 'source_type');
  return { sourceId, sourceType: typeof st === 'string' ? st : null };
}

export type OwnerDecision =
  | { ok: true; ownerId: string; useSession: boolean }
  | { ok: false; status: number; code: 'NO_OWNER' | 'OWNER_SESSION_REQUIRED' | 'OWNER_MISMATCH' | 'UNAUTHORIZED'; message: string };

/**
 * Who owns the photo. With a device: the device assigned user, or another user only when that
 * user also holds a valid session on this request. Session only: the session user (a different ownerUserId is refused).
 */
export function decidePhotoOwner(i: {
  hasDevice: boolean;
  assignedUserId: string | null;
  formOwnerId: string | null;
  sessionUserId: string | null;
}): OwnerDecision {
  if (i.hasDevice) {
    const candidate = i.formOwnerId ?? i.assignedUserId;
    if (!candidate) return { ok: false, status: 403, code: 'NO_OWNER', message: 'This device is not linked to a user.' };
    if (candidate === i.assignedUserId) {
      return { ok: true, ownerId: candidate, useSession: i.sessionUserId === candidate };
    }
    if (i.sessionUserId === candidate) return { ok: true, ownerId: candidate, useSession: true };
    return { ok: false, status: 403, code: 'OWNER_SESSION_REQUIRED', message: 'Sign in on this device as the photo owner first.' };
  }
  if (!i.sessionUserId) return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized.' };
  if (i.formOwnerId && i.formOwnerId !== i.sessionUserId) {
    return { ok: false, status: 403, code: 'OWNER_MISMATCH', message: 'Photo owner does not match the signed-in user.' };
  }
  return { ok: true, ownerId: i.sessionUserId, useSession: true };
}

export interface SaveCapturedPhotoInput {
  meta: CapturedPhotoMeta;
  bytes: Buffer;
  actor: AuditActor & { userId: bigint };
  now?: Date;
}

export function photoStorageRoot(): string {
  return process.env.PHOTO_STORAGE_DIR?.trim() || path.join(process.cwd(), 'storage', 'photos');
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function validateMeta(meta: CapturedPhotoMeta): bigint {
  if (!meta || typeof meta !== 'object') throw new PhotoError('INVALID_META', 'Photo details are missing.');
  if (typeof meta.captureId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(meta.captureId)) {
    throw new PhotoError('INVALID_META', 'Photo ID is not valid.');
  }
  if (typeof meta.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(meta.sha256)) {
    throw new PhotoError('INVALID_META', 'Photo check code is not valid.');
  }
  if (!TEST_POINTS.includes(meta.testingPoint)) throw new PhotoError('INVALID_META', 'Testing point is not valid.');
  if (!(PHOTO_KINDS as readonly string[]).includes(meta.photoKind)) {
    throw new PhotoError('INVALID_META', 'Photo type is not valid.');
  }
  if (!normalizeEntityType(meta.entityType)) {
    throw new PhotoError('UNKNOWN_ENTITY', 'This kind of record cannot have photos.');
  }
  if (typeof meta.entityId !== 'string' || !/^\d{1,18}$/.test(meta.entityId)) {
    throw new PhotoError('INVALID_META', 'Record ID is not valid.');
  }
  if (Number.isNaN(Date.parse(meta.deviceCapturedAt))) {
    throw new PhotoError('INVALID_META', 'Photo time is not valid.');
  }
  if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width <= 0 || meta.height <= 0) {
    throw new PhotoError('INVALID_META', 'Photo size is not valid.');
  }
  if (meta.labTestId != null && !/^\d{1,18}$/.test(meta.labTestId)) {
    throw new PhotoError('INVALID_META', 'Test ID is not valid.');
  }
  return BigInt(meta.entityId);
}

async function defaultDb(): Promise<PhotoDb> {
  const { prisma } = await import('@core/db');
  return prisma as unknown as PhotoDb;
}

async function defaultFs(): Promise<PhotoFs> {
  const fs = await import('node:fs/promises');
  return fs;
}

export async function saveCapturedPhoto(
  input: SaveCapturedPhotoInput,
  db?: PhotoDb,
  fs?: PhotoFs
): Promise<CapturedPhotoUploadResult> {
  const { meta, bytes, actor } = input;
  const entityId = validateMeta(meta);
  const entityType = normalizeEntityType(meta.entityType) as PhotoEntityType;
  const now = input.now ?? new Date();

  if (!isJpeg(bytes)) throw new PhotoError('INVALID_FILE', 'Only live camera photos (JPEG) are accepted.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError('TOO_LARGE', 'Photo is too big (limit 4 MB).', 413);

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== meta.sha256.toLowerCase()) {
    throw new PhotoError('HASH_MISMATCH', 'Photo was damaged while sending. Please send it again.');
  }

  const store = db ?? (await defaultDb());
  const capturedAt = new Date(meta.deviceCapturedAt);
  const clockDriftSeconds = Math.round((now.getTime() - capturedAt.getTime()) / 1000);
  const clockMismatch = Math.abs(clockDriftSeconds) > CLOCK_MISMATCH_SECONDS;

  const reusedElsewhere = async (): Promise<boolean> =>
    !!(await store.capturedPhoto.findFirst({
      where: { sha256, NOT: { entity_type: entityType, entity_id: entityId } },
      select: { id: true },
    }));

  const existing = await store.capturedPhoto.findUnique({ where: { capture_id: meta.captureId } });
  if (existing) {
    return {
      captureId: existing.capture_id,
      photoId: existing.id.toString(),
      status: 'DUPLICATE',
      hashReusedOnOtherRecord: await reusedElsewhere(),
      clockDriftSeconds: existing.clock_drift_seconds ?? clockDriftSeconds,
      clockMismatch: Math.abs(existing.clock_drift_seconds ?? clockDriftSeconds) > CLOCK_MISMATCH_SECONDS,
    };
  }

  const hashReusedOnOtherRecord = await reusedElsewhere();

  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const relPath = `${yyyy}/${mm}/${meta.testingPoint}/${meta.captureId}.jpg`;
  const fileSystem = fs ?? (await defaultFs());
  const fullPath = path.join(photoStorageRoot(), ...relPath.split('/'));
  const tmpPath = `${fullPath}.${randomBytes(6).toString('hex')}.tmp`;
  await fileSystem.mkdir(path.dirname(fullPath), { recursive: true });
  await fileSystem.writeFile(tmpPath, bytes);

  const rowData = {
    capture_id: meta.captureId,
    sha256,
    file_path: relPath,
    mime: 'image/jpeg',
    width: meta.width,
    height: meta.height,
    bytes: bytes.length,
    testing_point: meta.testingPoint,
    entity_type: entityType,
    entity_id: entityId,
    lab_test_id: meta.labTestId != null ? BigInt(meta.labTestId) : null,
    portion_number: meta.portionNumber ?? null,
    photo_kind: meta.photoKind,
    captured_by: actor.userId,
    performed_as_role: actor.performedAsRole ?? actor.actorRole ?? null,
    is_delegated: actor.isDelegated ?? false,
    device_id: actor.deviceId ?? null,
    device_captured_at: capturedAt,
    server_received_at: now,
    latitude: meta.latitude ?? null,
    longitude: meta.longitude ?? null,
    gps_accuracy: meta.gpsAccuracyM ?? null,
    was_offline: !!meta.wasOffline,
    clock_drift_seconds: clockDriftSeconds,
    policy_version: meta.policyVersion ?? null,
  };

  const work = async (tx: PhotoDb): Promise<CapturedPhotoRow> => {
    const created = await tx.capturedPhoto.create({ data: rowData });
    await writeAuditLog(tx, {
      tableName: 'captured_photo',
      recordId: created.id,
      action: 'CAPTURE',
      newValues: {
        captureId: meta.captureId,
        sha256,
        testingPoint: meta.testingPoint,
        entityType,
        entityId: meta.entityId,
        photoKind: meta.photoKind,
        wasOffline: !!meta.wasOffline,
        clockDriftSeconds,
        clockMismatch,
        hashReusedOnOtherRecord,
      },
      actor,
    });
    // Only after the row insert succeeded: a racing loser fails above and never touches the final file.
    await fileSystem.rename(tmpPath, fullPath);
    return created;
  };

  let row: CapturedPhotoRow;
  try {
    row = store.$transaction ? await store.$transaction(work) : await work(store);
  } catch (err) {
    await Promise.resolve(fileSystem.unlink(tmpPath)).catch(() => undefined);
    // Two uploads of the same capture raced: the other one won, so this is a duplicate.
    if ((err as { code?: string } | null)?.code === 'P2002') {
      const winner = await store.capturedPhoto.findUnique({ where: { capture_id: meta.captureId } });
      if (winner) {
        return {
          captureId: winner.capture_id,
          photoId: winner.id.toString(),
          status: 'DUPLICATE',
          hashReusedOnOtherRecord,
          clockDriftSeconds,
          clockMismatch,
        };
      }
    }
    throw err;
  }

  return {
    captureId: meta.captureId,
    photoId: row.id.toString(),
    status: 'SAVED',
    hashReusedOnOtherRecord,
    clockDriftSeconds,
    clockMismatch,
  };
}

/** Absolute path of a stored photo; refuses paths that escape the storage folder. */
export function resolvePhotoPath(relPath: string): string | null {
  const root = path.resolve(photoStorageRoot());
  const full = path.resolve(root, relPath);
  return full.startsWith(root + path.sep) ? full : null;
}
