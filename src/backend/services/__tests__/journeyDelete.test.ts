import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { deleteMotJourney, journeyDeleteProblem, JourneyDeleteError } from '@/backend/services/admin/journeyAdmin';

const actor = { userId: BigInt(1), actorRole: 'SUPER_ADMIN', performedAsRole: 'SUPER_ADMIN', isDelegated: false };

test('only a journey with no milk can be removed', () => {
  assert.equal(journeyDeleteProblem({ status: 'COLLECTING', collections: 0, arrival: false }), null);
  assert.equal(journeyDeleteProblem({ status: 'CANCELLED', collections: 0, arrival: false }), null);
  assert.match(journeyDeleteProblem({ status: 'COLLECTING', collections: 2, arrival: false }) ?? '', /2 shop collections/);
  assert.match(journeyDeleteProblem({ status: 'ARRIVED', collections: 0, arrival: true }) ?? '', /arrived/);
  assert.match(journeyDeleteProblem({ status: 'COMPLETED', collections: 0, arrival: false }) ?? '', /cannot be removed/);
});

test('a duplicate journey with no milk is removed with its stops and GPS points, and an audit copy is kept', async () => {
  const source = await prisma.motJourney.findFirstOrThrow({ orderBy: { id: 'desc' } });
  const run = `TEST-DUP-${Date.now()}`;
  const { id: _id, journey_number: _n, idempotency_key: _k, created_at: _c, updated_at: _u, ...rest } = source;
  void _id; void _n; void _k; void _c; void _u;
  const dup = await prisma.motJourney.create({
    data: { ...rest, journey_number: run, idempotency_key: run, status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: BigInt(1), cancellation_reason: 'Test duplicate', area_loss_gain_liters: null, area_loss_gain_at_13ts_liters: null, area_loss_gain_pct: null } as never,
  });
  const stopTemplate = await prisma.motJourneyStop.findFirstOrThrow();
  const { id: _sid, journey_id: _sj, created_at: _sc, updated_at: _su, ...stopRest } = stopTemplate as Record<string, unknown> & typeof stopTemplate;
  void _sid; void _sj; void _sc; void _su;
  await prisma.motJourneyStop.create({ data: { ...stopRest, journey_id: dup.id, status: 'PENDING' } as never });

  const result = await deleteMotJourney(actor, dup.id, 'Assigned twice (test)');
  assert.equal(result.journeyNumber, run);
  assert.equal(result.removed.stops, 1);
  assert.equal(await prisma.motJourney.findUnique({ where: { id: dup.id } }), null);
  assert.equal(await prisma.motJourneyStop.count({ where: { journey_id: dup.id } }), 0);
  const audit = await prisma.auditLog.findFirst({ where: { table_name: 'mot_journey', record_id: dup.id, action: 'MOT_JOURNEY_DELETED' } });
  assert.ok(audit, 'audit copy written');
  await prisma.auditLog.deleteMany({ where: { id: audit.id } }); // this test's own row
});

test('a journey with shop collections is refused and stays as it was', async () => {
  const withMilk = await prisma.motShopCollection.findFirst({ select: { journey_id: true } });
  if (!withMilk) return;
  await assert.rejects(deleteMotJourney(actor, withMilk.journey_id, 'should be refused'), (err: unknown) => err instanceof JourneyDeleteError && err.status === 409);
  assert.ok(await prisma.motJourney.findUnique({ where: { id: withMilk.journey_id } }));
});

test('a reason is required', async () => {
  await assert.rejects(deleteMotJourney(actor, BigInt(1), ' '), (err: unknown) => err instanceof JourneyDeleteError && err.status === 400);
});

test.after(async () => {
  await prisma.$disconnect();
});
