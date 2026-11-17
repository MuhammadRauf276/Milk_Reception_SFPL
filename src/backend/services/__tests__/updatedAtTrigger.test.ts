import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';

test('the database sets updated_at on a raw SQL update, in UTC like the app', async () => {
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
  const old = new Date('2020-01-01T00:00:00Z');
  const row = await prisma.formDraft.create({
    data: { form_type: 'TEST_TRIGGER', scope_id: BigInt(0), portion_key: `trigger-${Date.now()}`, user_id: user.id, content: {}, updated_at: old },
  });
  try {
    // Prisma's @updatedAt is not involved here: only the database trigger can move the value.
    await prisma.$executeRawUnsafe(`UPDATE form_draft SET version = version + 1 WHERE id = ${row.id}`);
    const after = await prisma.formDraft.findUniqueOrThrow({ where: { id: row.id } });
    const drift = Math.abs(after.updated_at.getTime() - Date.now());
    assert.ok(after.updated_at.getTime() > old.getTime(), 'updated_at moved');
    assert.ok(drift < 10 * 60 * 1000, `updated_at is the current UTC time (off by ${Math.round(drift / 1000)} s)`);
  } finally {
    await prisma.formDraft.delete({ where: { id: row.id } });
  }
});

test('the two unused materialized views are gone', async () => {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM pg_matviews WHERE schemaname = 'public'`);
  assert.equal(rows[0].n, 0);
});

test.after(async () => {
  await prisma.$disconnect();
});
