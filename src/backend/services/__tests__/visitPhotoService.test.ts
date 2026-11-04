import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisitPhotos, type VisitPhotoDb } from '../photo/visitPhotoService';

const at = new Date('2026-11-04T05:00:00.000Z');

function row(over: Record<string, unknown>) {
  return {
    capture_id: 'cap-1',
    entity_type: 'visit_portion',
    entity_id: BigInt(11),
    lab_test_id: BigInt(1),
    portion_number: 1,
    photo_kind: 'TEST_RESULT',
    device_captured_at: at,
    lab_test: { testName: 'Fat' },
    capturer: { full_name: 'Ali', username: 'ali' },
    ...over,
  };
}

function fakeDb(rows: ReturnType<typeof row>[], savedUrls: Array<string | null> = []) {
  const calls: unknown[] = [];
  const db = {
    visitPortion: { findMany: async () => [{ id: BigInt(11), portion_number: 1 }, { id: BigInt(12), portion_number: 2 }] },
    plantLabResult: { findMany: async () => savedUrls.map((photo_url) => ({ photo_url })) },
    capturedPhoto: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return rows;
      },
    },
  } as unknown as VisitPhotoDb;
  return { db, calls };
}

const ids = (photos: Array<{ captureId: string }>) => photos.map((p) => p.captureId);

test('dispatch and plant photos are told apart by the record they are stored on', async () => {
  const { db } = fakeDb([
    row({ capture_id: 'd', entity_type: 'dispatch_portion' }),
    row({ capture_id: 'p', entity_type: 'visit_portion' }),
    row({ capture_id: 'q', entity_type: 'plant_portion_test', lab_test_id: BigInt(2) }),
  ]);
  const photos = await getVisitPhotos(BigInt(9), db);
  assert.deepEqual(photos.map((p) => [p.captureId, p.stage]), [['d', 'DISPATCH'], ['p', 'PLANT'], ['q', 'PLANT']]);
});

test('a retake replaces the earlier photo of the same test on the same portion', async () => {
  const { db } = fakeDb([row({ capture_id: 'first' }), row({ capture_id: 'retake' })]);
  assert.deepEqual(ids(await getVisitPhotos(BigInt(9), db)), ['retake']);
});

test('the photo saved on the plant result wins over a later retake that was never submitted', async () => {
  const { db } = fakeDb([row({ capture_id: 'saved' }), row({ capture_id: 'unsubmitted' })], ['/api/photos/saved']);
  assert.deepEqual(ids(await getVisitPhotos(BigInt(9), db)), ['saved']);
});

test('a saved address that is not a known photo falls back to the last received', async () => {
  const { db } = fakeDb([row({ capture_id: 'first' }), row({ capture_id: 'last' })], ['https://elsewhere/x.jpg', null]);
  assert.deepEqual(ids(await getVisitPhotos(BigInt(9), db)), ['last']);
});

test('the final photo is kept for each test, portion and stage separately', async () => {
  const { db } = fakeDb([
    row({ capture_id: 'fat-p1' }),
    row({ capture_id: 'lr-p1', lab_test_id: BigInt(2) }),
    row({ capture_id: 'fat-p2', entity_id: BigInt(12) }),
    row({ capture_id: 'fat-dispatch', entity_type: 'dispatch_portion' }),
  ]);
  assert.equal((await getVisitPhotos(BigInt(9), db)).length, 4);
});

test('photos of kind OTHER are not treated as retakes', async () => {
  const { db } = fakeDb([
    row({ capture_id: 'a', photo_kind: 'OTHER', lab_test_id: null }),
    row({ capture_id: 'b', photo_kind: 'OTHER', lab_test_id: null }),
  ]);
  assert.deepEqual(ids(await getVisitPhotos(BigInt(9), db)), ['a', 'b']);
});

test('the portion current number wins over the number stamped on the photo', async () => {
  const { db } = fakeDb([row({ entity_id: BigInt(12), portion_number: 5 })]);
  const [photo] = await getVisitPhotos(BigInt(9), db);
  assert.equal(photo.portionNumber, 2);
});

test('a lab report on the visit has no portion, even if one was stamped on it', async () => {
  const { db } = fakeDb([row({ entity_type: 'dispatch_info', entity_id: BigInt(9), lab_test_id: null, photo_kind: 'LAB_REPORT', lab_test: null })]);
  const [photo] = await getVisitPhotos(BigInt(9), db);
  assert.equal(photo.stage, 'DISPATCH');
  assert.equal(photo.portionNumber, null);
  assert.equal(photo.testName, null);
  assert.equal(photo.photoKind, 'LAB_REPORT');
});

test('the query only asks for this visit and its own portions', async () => {
  const { db, calls } = fakeDb([]);
  await getVisitPhotos(BigInt(9), db);
  const { where } = calls[0] as { where: { OR: Array<{ entity_id: unknown }> } };
  assert.deepEqual(where.OR[0].entity_id, { in: [BigInt(11), BigInt(12)] });
  assert.equal(where.OR[1].entity_id, BigInt(9));
});

test('the capturer falls back to the username', async () => {
  const { db } = fakeDb([row({ capturer: { full_name: null, username: 'ali' } })]);
  const [photo] = await getVisitPhotos(BigInt(9), db);
  assert.equal(photo.capturedBy, 'ali');
});
