import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_EXPIRY_DAYS,
  DraftError,
  alreadyDecidedMessage,
  formatKarachi,
  clearDraftsForPortion,
  deleteOwnDraft,
  loadDraft,
  mergeDraftContent,
  sanitizeDraftContent,
  saveDraft,
  type DraftDb,
  type DraftKey,
  type DraftRow,
} from '../formDraftService';

// In-memory stand-in for the draft table and the user table.
function makeDb(hooks: { beforeCreate?: () => void; beforeUpdate?: () => void } = {}) {
  const rows: DraftRow[] = [];
  let nextId = 1;
  const users = [
    { id: BigInt(1), full_name: 'Amina Khan', username: 'amina' },
    { id: BigInt(2), full_name: null, username: 'bilal' },
  ];
  const matches = (r: DraftRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const val = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'not' in v) return val !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'lt' in v) return (val as Date) < (v as { lt: Date }).lt;
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(val);
      return val === v;
    });
  const db: DraftDb = {
    formDraft: {
      async findUnique({ where }) {
        const w = where.form_type_scope_id_portion_key_user_id;
        return rows.find((r) => r.form_type === w.form_type && r.scope_id === w.scope_id && r.portion_key === w.portion_key && r.user_id === w.user_id) ?? null;
      },
      async findMany({ where }) {
        return rows.filter((r) => matches(r, where));
      },
      async create({ data }) {
        hooks.beforeCreate?.();
        if (rows.some((r) => r.form_type === data.form_type && r.scope_id === data.scope_id && r.portion_key === data.portion_key && r.user_id === data.user_id)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: BigInt(nextId++), ...data };
        rows.push(row);
        return row;
      },
      async updateMany({ where, data }) {
        hooks.beforeUpdate?.();
        const row = rows.find((r) => r.id === where.id && r.version === where.version);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async deleteMany({ where }) {
        const gone = rows.filter((r) => matches(r, where));
        for (const g of gone) rows.splice(rows.indexOf(g), 1);
        return { count: gone.length };
      },
    },
    user: {
      async findMany({ where }) {
        return users.filter((u) => where.id.in.includes(u.id));
      },
    },
  };
  return { db, rows };
}

const key = (userId: number, portionKey = '10'): DraftKey => ({ formType: 'PLANT_QA', scopeId: BigInt(5), portionKey, userId: BigInt(userId) });
const content = (values: Record<string, string>, remarks = '') => ({ values, photos: {}, remarks });
const T0 = new Date('2026-11-04T08:00:00Z');

test('save then load returns the same values', async () => {
  const { db } = makeDb();
  const saved = await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  assert.equal(saved.version, 1);
  const loaded = await loadDraft(db, key(1), T0);
  assert.deepEqual(loaded.draft?.content.values, { '5': '0.10' });
  assert.equal(loaded.draft?.version, 1);
});

test('same user on a second device sees the draft and can continue it', async () => {
  const { db } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  const phone = await loadDraft(db, key(1), T0);
  const next = await saveDraft(db, key(1), content({ '5': '0.10', '6': 'NEGATIVE' }), phone.draft!.version, T0);
  assert.equal(next.version, 2);
  assert.deepEqual(next.content.values, { '5': '0.10', '6': 'NEGATIVE' });
});

test('another user cannot read or change it, and has their own', async () => {
  const { db, rows } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  const other = await loadDraft(db, key(2), T0);
  assert.equal(other.draft, null);
  await saveDraft(db, key(2), content({ '5': '0.20' }), null, T0);
  assert.equal(rows.length, 2);
  assert.deepEqual((await loadDraft(db, key(1), T0)).draft?.content.values, { '5': '0.10' });
  await deleteOwnDraft(db, key(2));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, BigInt(1), 'delete only touches the caller own draft');
});

test('an empty value never replaces a typed one', async () => {
  const { db } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }, 'note'), null, T0);
  const out = await saveDraft(db, key(1), content({ '5': '', '6': '' }, ''), 1, T0);
  assert.equal(out.content.values['5'], '0.10');
  assert.equal(out.content.remarks, 'note');
  assert.equal(mergeDraftContent(content({ a: 'x' }), content({ a: '  ' })).values.a, 'x');
  assert.equal(mergeDraftContent(content({ a: 'x' }), content({ a: 'y' })).values.a, 'y');
});

test('a stale version is rejected with a clear message and the newer draft', async () => {
  const { db } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  await saveDraft(db, key(1), content({ '5': '0.11' }), 1, T0); // laptop saves, now version 2
  await assert.rejects(
    () => saveDraft(db, key(1), content({ '5': '0.12' }), 1, T0), // phone is still on version 1
    (e: unknown) => {
      assert.ok(e instanceof DraftError);
      assert.equal(e.status, 409);
      assert.equal(e.code, 'DRAFT_STALE');
      assert.match(e.message, /changed on another device/);
      assert.equal(e.current?.content.values['5'], '0.11');
      return true;
    },
  );
});

test('a colleague sees name and time of an unexpired draft, never the values', async () => {
  const { db } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  await saveDraft(db, key(2), content({ '5': '0.20' }), null, new Date('2026-11-04T09:30:00Z'));
  const seen = await loadDraft(db, key(2), new Date('2026-11-04T10:00:00Z'));
  assert.deepEqual(seen.colleagues, [{ name: 'Amina Khan', startedAt: T0.toISOString() }]);
  assert.ok(!JSON.stringify(seen.colleagues).includes('0.10'));
  const reverse = await loadDraft(db, key(1), new Date('2026-11-04T10:00:00Z'));
  assert.equal(reverse.colleagues[0].name, 'bilal', 'falls back to the username');
});

test('a draft on another portion is not reported', async () => {
  const { db } = makeDb();
  await saveDraft(db, key(1, '11'), content({ '5': '1' }), null, T0);
  assert.deepEqual((await loadDraft(db, key(2, '10'), T0)).colleagues, []);
});

test('expired drafts are ignored and removed', async () => {
  const { db, rows } = makeDb();
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  const later = new Date(T0.getTime() + (DRAFT_EXPIRY_DAYS * 24 + 1) * 3600 * 1000);
  const loaded = await loadDraft(db, key(1), later);
  assert.equal(loaded.draft, null);
  assert.equal(rows.length, 0);
  const justInside = new Date(T0.getTime() + (DRAFT_EXPIRY_DAYS * 24 - 1) * 3600 * 1000);
  await saveDraft(db, key(1), content({ '5': '1' }), null, T0);
  assert.ok((await loadDraft(db, key(1), justInside)).draft);
  assert.equal(DRAFT_EXPIRY_DAYS, 7);
});

test('a draft can only hold values, photos and remarks', () => {
  assert.throws(() => sanitizeDraftContent({ values: {}, decision: 'ACCEPT' }), DraftError);
  assert.throws(() => sanitizeDraftContent({ values: { a: 5 } }), DraftError);
  assert.throws(() => sanitizeDraftContent([]), DraftError);
  assert.deepEqual(sanitizeDraftContent({ values: { a: '1' } }), { values: { a: '1' }, photos: {}, remarks: '' });
});

test('final submit clears every draft for that portion only', async () => {
  const { db, rows } = makeDb();
  await saveDraft(db, key(1, '10'), content({ a: '1' }), null, T0);
  await saveDraft(db, key(2, '10'), content({ a: '2' }), null, T0);
  await saveDraft(db, key(1, '11'), content({ a: '3' }), null, T0);
  assert.equal(await clearDraftsForPortion(db, 'PLANT_QA', BigInt(5), '10'), 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].portion_key, '11');
});

test('a late submit gets a 409 text with who decided and when; the draft is untouched', async () => {
  const { db, rows } = makeDb();
  await saveDraft(db, key(2), content({ a: '1' }), null, T0);
  const msg = alreadyDecidedMessage('Amina Khan', new Date('2026-11-04T09:05:00Z'));
  // 09:05 UTC is 2:05 PM in Pakistan (UTC+5)
  assert.match(msg, /already decided by Amina Khan at 4 Nov 2026, 2:05 PM./);
  assert.equal(formatKarachi(new Date('2026-11-14T10:12:00Z')), '14 Nov 2026, 3:12 PM');
  assert.equal(formatKarachi(new Date('2026-11-14T19:30:00Z')), '15 Nov 2026, 12:30 AM', 'crosses midnight into the next Pakistan day');
  assert.match(msg, /draft is kept/);
  assert.equal(rows.length, 1);
  assert.match(alreadyDecidedMessage(null, null), /already decided\./);
});

test('two devices creating the same draft at once: the loser continues as an update, no error', async () => {
  let raced = false;
  const { db, rows } = makeDb({
    beforeCreate: () => {
      if (raced) return;
      raced = true;
      // the other device's create lands between our read and our create
      rows.push({ id: BigInt(99), form_type: 'PLANT_QA', scope_id: BigInt(5), portion_key: '10', user_id: BigInt(1), content: content({ '5': '0.10' }), version: 1, created_at: T0, updated_at: T0 });
    },
  });
  // baseVersion null: this device had no draft. The re-read row is version 1, so the save is judged stale.
  await assert.rejects(
    () => saveDraft(db, key(1), content({ '6': 'NEGATIVE' }), null, T0),
    (e: unknown) => e instanceof DraftError && e.code === 'DRAFT_STALE' && e.current?.content.values['5'] === '0.10',
  );
  assert.equal(rows.length, 1, 'no duplicate row');
  // with the matching version the same save goes through as an update
  const ok = await saveDraft(db, key(1), content({ '6': 'NEGATIVE' }), 1, T0);
  assert.equal(ok.version, 2);
  assert.deepEqual(ok.content.values, { '5': '0.10', '6': 'NEGATIVE' });
});

test('a save that loses the version race gets 409 with the winning draft, and does not overwrite it', async () => {
  let injected = false;
  const { db, rows } = makeDb({
    beforeUpdate: () => {
      if (injected) return;
      injected = true;
      const r = rows[0]; // another device saves between our read and our update
      r.version += 1;
      r.content = content({ '5': 'winner' });
    },
  });
  await saveDraft(db, key(1), content({ '5': '0.10' }), null, T0);
  await assert.rejects(
    () => saveDraft(db, key(1), content({ '5': 'loser' }), 1, T0),
    (e: unknown) => {
      assert.ok(e instanceof DraftError);
      assert.equal(e.status, 409);
      assert.equal(e.code, 'DRAFT_STALE');
      assert.equal(e.current?.version, 2);
      assert.equal(e.current?.content.values['5'], 'winner');
      return true;
    },
  );
  assert.equal((rows[0].content as { values: Record<string, string> }).values['5'], 'winner');
});

test('a create error that is not a unique clash is not swallowed', async () => {
  const { db } = makeDb({ beforeCreate: () => { throw new Error('db down'); } });
  await assert.rejects(() => saveDraft(db, key(1), content({ a: '1' }), null, T0), /db down/);
});
