import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMotProfilesForUsers, type MotProfileSyncDb } from '../mot/motProfileSync';

const ashraf = { id: BigInt(71), username: 'ashraf', full_name: 'Ashraf Ali', procurement_source_id: BigInt(1) };

function fakeDb(users: Array<typeof ashraf | Record<string, unknown>>, takenCodes: string[] = [], failFor: string[] = []) {
  const created: Array<Record<string, unknown>> = [];
  const queries: unknown[] = [];
  const db = {
    user: {
      findMany: async (args: unknown) => {
        queries.push(args);
        return users;
      },
    },
    motProfile: {
      findUnique: async ({ where }: { where: { mot_code: string } }) => (takenCodes.includes(where.mot_code) ? { id: 1 } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (failFor.includes(String(data.mot_code))) throw new Error('create failed');
        created.push(data);
        return data;
      },
    },
  } as unknown as MotProfileSyncDb;
  return { db, created, queries };
}

const noWarnings = async (fn: () => Promise<void>) => {
  const original = console.warn;
  console.warn = () => undefined;
  try {
    await fn();
  } finally {
    console.warn = original;
  }
};

test('a new Mobile Tester gets a profile linked to their user and ZMCC', async () => {
  const { db, created } = fakeDb([ashraf]);
  await ensureMotProfilesForUsers(db, BigInt(1));
  assert.equal(created.length, 1);
  assert.equal(created[0].mot_code, 'ASHRAF');
  assert.equal(created[0].name, 'Ashraf Ali');
  assert.equal(created[0].user_id, BigInt(71));
  assert.equal(created[0].zmcc_id, BigInt(1));
  assert.equal(created[0].is_active, true);
});

test('the placeholder phone and CNIC match the formats the profile accepts', async () => {
  const { db, created } = fakeDb([ashraf]);
  await ensureMotProfilesForUsers(db);
  assert.match(String(created[0].phone_number), /^0300-\d{7}$/);
  assert.match(String(created[0].cnic), /^\d{5}-\d{7}-\d$/);
});

test('a code already in use gets the user id, so the user still appears', async () => {
  const { db, created } = fakeDb([ashraf], ['ASHRAF']);
  await ensureMotProfilesForUsers(db);
  assert.equal(created[0].mot_code, 'ASHRAF-71');
});

test('one failure does not stop the next user', async () => {
  const other = { ...ashraf, id: BigInt(72), username: 'kashif', full_name: 'Kashif' };
  const { db, created } = fakeDb([ashraf, other], [], ['ASHRAF']);
  await noWarnings(() => ensureMotProfilesForUsers(db));
  assert.deepEqual(created.map((c) => c.mot_code), ['KASHIF']);
});

test('only active, unlinked Mobile Testers bound to a ZMCC are looked for', async () => {
  const { db, queries } = fakeDb([]);
  await ensureMotProfilesForUsers(db, BigInt(5));
  const { where } = queries[0] as { where: Record<string, unknown> };
  assert.deepEqual(where.role, { in: ['MOT', 'MOT_OPERATOR'] });
  assert.equal(where.is_active, true);
  assert.equal(where.mot_profile, null);
  assert.equal(where.procurement_source_id, BigInt(5));
  assert.deepEqual(where.procurement_source, { source_type: 'ZMCC' });
});

test('with no source given it covers every ZMCC, but never a user with no source', async () => {
  const { db, queries } = fakeDb([]);
  await ensureMotProfilesForUsers(db);
  const { where } = queries[0] as { where: Record<string, unknown> };
  assert.deepEqual(where.procurement_source_id, { not: null });
});
