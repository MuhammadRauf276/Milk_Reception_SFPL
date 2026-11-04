import test from 'node:test';
import assert from 'node:assert/strict';
import { clearHandledNotifications } from '../notificationService';

function fakeDb(count = 2) {
  const calls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const db = {
    notification: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.push(args);
        return { count };
      },
    },
  };
  return { db: db as never, calls };
}

test('it clears one kind of item for one record, for everyone who received it', async () => {
  const { db, calls } = fakeDb();
  const cleared = await clearHandledNotifications(db, ['DISPATCH_APPROVAL_PENDING'], BigInt(14));
  assert.equal(cleared, 2);
  assert.deepEqual(calls[0].where, {
    event_key: { in: ['DISPATCH_APPROVAL_PENDING'] },
    source_id: '14',
    read_at: null,
  });
  assert.equal('recipient_user_id' in calls[0].where, false);
  assert.ok(calls[0].data.read_at instanceof Date);
});

test('the same id on a different kind of item is not touched', async () => {
  const { db, calls } = fakeDb();
  await clearHandledNotifications(db, ['MOT_SHOP_EXCEPTION_PENDING'], '14');
  assert.deepEqual(calls[0].where.event_key, { in: ['MOT_SHOP_EXCEPTION_PENDING'] });
});

test('no kinds means nothing is cleared', async () => {
  const { db, calls } = fakeDb();
  assert.equal(await clearHandledNotifications(db, [], '14'), 0);
  assert.equal(calls.length, 0);
});
