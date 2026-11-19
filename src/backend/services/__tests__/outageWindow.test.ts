import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutageWindow } from '@prisma/client';
import {
  checkEnteredTime,
  parseOutageWindowInput,
  PAST_LIMIT_MESSAGE,
  windowCovers,
  windowOpen,
} from '@/backend/services/outageWindowService';

const now = new Date('2026-11-19T08:00:00.000Z');
const hours = (h: number) => h * 60 * 60 * 1000;
const ago = (h: number) => new Date(now.getTime() - hours(h));

function windowRow(over: Partial<OutageWindow> = {}): OutageWindow {
  return {
    id: BigInt(7),
    starts_at: ago(24 * 6),
    ends_at: ago(24 * 5),
    all_stations: false,
    plant_stations: ['GATE'],
    zmcc_ids: [BigInt(12)],
    reason: 'Internet down',
    catch_up_until: new Date(now.getTime() + hours(24)),
    closed_at: null,
    closed_by: null,
    created_by: BigInt(1),
    created_at: ago(1),
    updated_at: ago(1),
    ...over,
  };
}

/** A stand-in for the two tables the check reads and writes. */
function fakeDb(windows: OutageWindow[]) {
  const audits: unknown[] = [];
  return {
    audits,
    db: {
      outageWindow: {
        findMany: async ({ where }: { where: { starts_at: { lte: Date }; ends_at: { gte: Date }; catch_up_until: { gte: Date } } }) =>
          windows.filter(
            (w) =>
              !w.closed_at &&
              w.catch_up_until >= where.catch_up_until.gte &&
              w.starts_at <= where.starts_at.lte &&
              w.ends_at >= where.ends_at.gte
          ),
      },
      auditLog: {
        create: async (args: unknown) => {
          audits.push(args);
          return { id: BigInt(audits.length) };
        },
      },
    } as never,
  };
}

test('a window covers all stations, its plant stations, or its ZMCCs', () => {
  const w = windowRow();
  assert.equal(windowCovers(w, { plant: 'GATE' }), true);
  assert.equal(windowCovers(w, { plant: 'QA' }), false);
  assert.equal(windowCovers(w, { zmccId: '12' }), true);
  assert.equal(windowCovers(w, { zmccId: 13 }), false);
  assert.equal(windowCovers(windowRow({ all_stations: true, plant_stations: [], zmcc_ids: [] }), { plant: 'QA' }), true);
});

test('a window stays usable until its catch-up deadline or until closed early', () => {
  assert.equal(windowOpen(windowRow(), now), true);
  assert.equal(windowOpen(windowRow({ catch_up_until: ago(1) }), now), false);
  assert.equal(windowOpen(windowRow({ closed_at: ago(1) }), now), false);
});

test('up to 3 days earlier needs no window; older is refused without one', async () => {
  const { db } = fakeDb([]);
  const recent = await checkEnteredTime(ago(70), { plant: 'QA' }, { now, db });
  assert.ok(!('error' in recent) && recent.window === null);
  const old = await checkEnteredTime(ago(80), { plant: 'QA' }, { now, db });
  assert.deepEqual(old, { error: PAST_LIMIT_MESSAGE });
});

test('an older time inside an open window for that station is allowed and noted as entered late', async () => {
  const { db, audits } = fakeDb([windowRow()]);
  const inside = ago(24 * 5.5);
  const ok = await checkEnteredTime(inside, { zmccId: 12 }, { now, db });
  assert.ok(!('error' in ok) && ok.window?.id === BigInt(7));
  if (!('error' in ok)) await ok.record({ step: 'HC arrival', recordTable: 'zmcc_local_supplier_arrival', recordId: 99, actor: { id: BigInt(3), role: 'ZMCC_PHE' } }, db);
  assert.equal(audits.length, 1);
  const row = (audits[0] as { data: { table_name: string; action: string; record_id: bigint } }).data;
  assert.equal(row.table_name, 'outage_window');
  assert.equal(row.action, 'LATE_ENTRY');
  assert.equal(row.record_id, BigInt(7));

  // Another station, or outside the window's hours: refused.
  assert.ok('error' in (await checkEnteredTime(inside, { zmccId: 13 }, { now, db })));
  assert.ok('error' in (await checkEnteredTime(ago(24 * 4.5), { zmccId: 12 }, { now, db })));
});

test('a closed or expired window no longer allows older times', async () => {
  const { db } = fakeDb([windowRow({ closed_at: ago(2) })]);
  assert.ok('error' in (await checkEnteredTime(ago(24 * 5.5), { plant: 'GATE' }, { now, db })));
  const expired = fakeDb([windowRow({ catch_up_until: ago(1) })]);
  assert.ok('error' in (await checkEnteredTime(ago(24 * 5.5), { plant: 'GATE' }, { now, db: expired.db })));
});

test('opening a window: order, stations, reason and catch-up limits', () => {
  const base = { starts_at: ago(30).toISOString(), ends_at: ago(26).toISOString(), plant_stations: ['GATE'], reason: 'Internet down at plant' };
  const ok = parseOutageWindowInput(base, now);
  assert.ok(!('error' in ok));
  if (!('error' in ok)) assert.equal(ok.catch_up_until.getTime(), ago(26).getTime() + hours(48));

  assert.ok('error' in parseOutageWindowInput({ ...base, ends_at: ago(31).toISOString() }, now));
  assert.ok('error' in parseOutageWindowInput({ ...base, ends_at: new Date(now.getTime() + hours(2)).toISOString() }, now));
  assert.ok('error' in parseOutageWindowInput({ ...base, plant_stations: [] }, now));
  assert.ok('error' in parseOutageWindowInput({ ...base, reason: 'x' }, now));
  assert.ok('error' in parseOutageWindowInput({ ...base, catch_up_hours: 24 * 8 }, now));
  // An old outage whose catch-up time already ran out.
  assert.ok('error' in parseOutageWindowInput({ ...base, starts_at: ago(24 * 10).toISOString(), ends_at: ago(24 * 9).toISOString() }, now));
  const all = parseOutageWindowInput({ ...base, all_stations: true, zmcc_ids: ['5'] }, now);
  assert.ok(!('error' in all) && all.all_stations && all.zmcc_ids.length === 0);
});
