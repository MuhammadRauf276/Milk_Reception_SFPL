import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  saveCapturedPhoto,
  PhotoError,
  type CapturedPhotoRow,
  type PhotoDb,
  type PhotoFs,
} from '../capturedPhotoService';
import type { CapturedPhotoMeta } from '@/types/captured-photo';

const NOW = new Date('2026-10-20T09:00:00Z');
const actor = { userId: BigInt(7), actorRole: 'MDO', performedAsRole: 'MDO', isDelegated: false };

function jpeg(extra = 'a'): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(extra)]);
}
function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}
function metaFor(b: Buffer, over: Partial<CapturedPhotoMeta> = {}): CapturedPhotoMeta {
  return {
    captureId: 'cap-00000001',
    sha256: sha(b),
    testingPoint: 'MOT_SHOP',
    entityType: 'MOT_SHOP_COLLECTION',
    entityId: '100',
    photoKind: 'TEST_RESULT',
    deviceCapturedAt: NOW.toISOString(),
    wasOffline: false,
    width: 100,
    height: 120,
    ...over,
  };
}

function fakes() {
  const rows: CapturedPhotoRow[] = [];
  const audits: unknown[] = [];
  const written: string[] = [];
  const db = {
    capturedPhoto: {
      async findUnique(args: { where: { capture_id: string } }) {
        return rows.find((r) => r.capture_id === args.where.capture_id) ?? null;
      },
      async findFirst(args: { where: { sha256: string; NOT: { entity_type: string; entity_id: bigint } } }) {
        const { sha256, NOT } = args.where;
        const hit = rows.find(
          (r) => r.sha256 === sha256 && !(r.entity_type === NOT.entity_type && r.entity_id === NOT.entity_id)
        );
        return hit ? { id: hit.id } : null;
      },
      async create(args: { data: Record<string, unknown> }) {
        const d = args.data;
        const row: CapturedPhotoRow = {
          id: BigInt(rows.length + 1),
          capture_id: d.capture_id as string,
          sha256: d.sha256 as string,
          file_path: d.file_path as string,
          entity_type: d.entity_type as string,
          entity_id: d.entity_id as bigint,
          captured_by: d.captured_by as bigint,
          device_id: null,
          clock_drift_seconds: d.clock_drift_seconds as number,
        };
        rows.push(row);
        return row;
      },
    },
    auditLog: {
      async create(args: unknown) {
        audits.push(args);
        return { id: BigInt(audits.length) };
      },
    },
  } as unknown as PhotoDb;
  const fs: PhotoFs = {
    async mkdir() {
      return undefined;
    },
    async writeFile(file) {
      written.push(file);
    },
    async rename() {
      return undefined;
    },
    async unlink() {
      return undefined;
    },
  };
  return { rows, audits, written, db, fs };
}

test('saves a valid JPEG, writes file and audit', async () => {
  const f = fakes();
  const b = jpeg();
  const r = await saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs);
  assert.equal(r.status, 'SAVED');
  assert.equal(r.hashReusedOnOtherRecord, false);
  assert.equal(r.clockMismatch, false);
  assert.equal(f.rows.length, 1);
  assert.equal(f.audits.length, 1);
  assert.equal(f.written.length, 1);
  assert.match(f.rows[0].file_path, /^2026\/10\/MOT_SHOP\/cap-00000001\.jpg$/);
});

test('rejects bad magic bytes', async () => {
  const f = fakes();
  const b = Buffer.from('not a jpeg at all');
  await assert.rejects(
    () => saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs),
    (e: unknown) => e instanceof PhotoError && e.code === 'INVALID_FILE'
  );
  assert.equal(f.rows.length, 0);
});

test('rejects hash mismatch', async () => {
  const f = fakes();
  const b = jpeg();
  await assert.rejects(
    () => saveCapturedPhoto({ meta: metaFor(b, { sha256: 'a'.repeat(64) }), bytes: b, actor, now: NOW }, f.db, f.fs),
    (e: unknown) => e instanceof PhotoError && e.code === 'HASH_MISMATCH'
  );
  assert.equal(f.written.length, 0);
});

test('rejects files over 4 MB', async () => {
  const f = fakes();
  const b = Buffer.concat([jpeg(), Buffer.alloc(4 * 1024 * 1024)]);
  await assert.rejects(
    () => saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs),
    (e: unknown) => e instanceof PhotoError && e.code === 'TOO_LARGE'
  );
});

test('same capture_id again returns DUPLICATE and saves nothing new', async () => {
  const f = fakes();
  const b = jpeg();
  await saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs);
  const again = await saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs);
  assert.equal(again.status, 'DUPLICATE');
  assert.equal(f.rows.length, 1);
  assert.equal(f.audits.length, 1);
});

test('same bytes on a different record are flagged as reused', async () => {
  const f = fakes();
  const b = jpeg();
  await saveCapturedPhoto({ meta: metaFor(b), bytes: b, actor, now: NOW }, f.db, f.fs);
  const r = await saveCapturedPhoto(
    { meta: metaFor(b, { captureId: 'cap-00000002', entityId: '200' }), bytes: b, actor, now: NOW },
    f.db,
    f.fs
  );
  assert.equal(r.status, 'SAVED');
  assert.equal(r.hashReusedOnOtherRecord, true);
});

test('clock drift over 600 seconds sets clockMismatch', async () => {
  const f = fakes();
  const b = jpeg();
  const old = new Date(NOW.getTime() - 601 * 1000).toISOString();
  const r = await saveCapturedPhoto({ meta: metaFor(b, { deviceCapturedAt: old }), bytes: b, actor, now: NOW }, f.db, f.fs);
  assert.equal(r.clockDriftSeconds, 601);
  assert.equal(r.clockMismatch, true);

  const b2 = jpeg('b');
  const ok = new Date(NOW.getTime() - 600 * 1000).toISOString();
  const r2 = await saveCapturedPhoto(
    { meta: metaFor(b2, { captureId: 'cap-00000003', deviceCapturedAt: ok }), bytes: b2, actor, now: NOW },
    f.db,
    f.fs
  );
  assert.equal(r2.clockMismatch, false);
});
