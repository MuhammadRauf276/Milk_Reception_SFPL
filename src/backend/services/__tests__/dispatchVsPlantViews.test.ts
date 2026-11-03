import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@core/db';

// Hand-checked fixture, built inside a transaction that is always rolled back (nothing is left in the database).
class Rollback extends Error {}

test('vw_dispatch_vs_plant_visit and _test give the hand-checked numbers and keep the visit filter', async () => {
  const tests = await prisma.labTest.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 2 });
  assert.equal(tests.length, 2, 'needs two lab tests in the database');
  const [tA, tB] = tests;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const code = `T-VIEW-${Date.now()}`;
      const src = await tx.procurementSource.create({ data: { code, name: 'View test ZMCC', source_type: 'ZMCC' } });
      const visit = await tx.vehicleVisit.create({
        data: {
          visit_number: `${code}-V`,
          vehicle_number: 'VIEW-1',
          operational_date: new Date('2030-01-15T00:00:00Z'),
          procurement_source_id: src.id,
          vehicle_dispatch_gross_liters: 10000,
          vehicle_dispatch_lr: 28,
          vehicle_dispatch_fat: 4,
          vehicle_dispatch_at_13ts_liters: 9800,
        },
      });
      const p1 = await tx.visitPortion.create({ data: { visit_id: visit.id, portion_number: 1 } });
      const p2 = await tx.visitPortion.create({ data: { visit_id: visit.id, portion_number: 2 } });
      const d = (portion_id: bigint, test_id: bigint, numeric_value: number | null, performance_status = 'PERFORMED') =>
        tx.dispatchLabResult.create({ data: { visit_id: visit.id, portion_id, test_id, numeric_value, performance_status } });
      const p = (portion_id: bigint, test_id: bigint, numeric_value: number | null, performance_status = 'PERFORMED') =>
        tx.plantLabResult.create({ data: { visit_id: visit.id, portion_id, test_id, numeric_value, performance_status } });
      await d(p1.id, tA.id, 4);
      await d(p2.id, tA.id, 3.8); // test A dispatch average = 3.9
      await d(p1.id, tB.id, 7); // test B only at dispatch
      await d(p1.id, tB.id, 99, 'NOT_PERFORMED'); // never counted
      await p(p1.id, tA.id, 3.7); // test A plant = 3.7
      await p(p1.id, tA.id, null); // empty value never counted

      const rows = (await tx.$queryRawUnsafe(
        'SELECT * FROM vw_dispatch_vs_plant_test WHERE visit_id = $1 ORDER BY test_id',
        visit.id
      )) as Array<{ test_id: bigint; dispatch_value: unknown; plant_value: unknown }>;
      assert.equal(rows.length, 2);
      const a = rows.find((r) => r.test_id === tA.id)!;
      const b = rows.find((r) => r.test_id === tB.id)!;
      assert.equal(Number(a.dispatch_value), 3.9);
      assert.equal(Number(a.plant_value), 3.7);
      assert.equal(Number(b.dispatch_value), 7);
      assert.equal(b.plant_value, null);

      const other = (await tx.$queryRawUnsafe('SELECT 1 FROM vw_dispatch_vs_plant_test WHERE visit_id = $1', visit.id + BigInt(1000000))) as unknown[];
      assert.equal(other.length, 0, 'the visit filter must not return another visit');

      const v = (await tx.$queryRawUnsafe('SELECT * FROM vw_dispatch_vs_plant_visit WHERE visit_id = $1', visit.id)) as Array<Record<string, unknown>>;
      assert.equal(v.length, 1);
      assert.equal(v[0].is_received, false);
      assert.equal(Number(v[0].dispatch_gross_liters), 10000);
      assert.equal(Number(v[0].dispatch_at_13ts_liters), 9800);
      assert.equal(v[0].plant_gross_liters, null);
      assert.equal(v[0].zmcc_code, code);

      throw new Rollback();
    }),
    Rollback
  );

  const left = await prisma.procurementSource.count({ where: { code: { startsWith: 'T-VIEW-' } } });
  assert.equal(left, 0, 'the fixture must be rolled back');
});

test('the report views exist and the date/source indexes are in place', async () => {
  const idx = (await prisma.$queryRawUnsafe(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'vehicle_visit' AND indexname IN ('idx_vehicle_visit_source_opdate','idx_vehicle_visit_opdate')"
  )) as unknown[];
  assert.equal(idx.length, 2);
  const views = (await prisma.$queryRawUnsafe(
    "SELECT viewname FROM pg_views WHERE viewname IN ('vw_dispatch_vs_plant_visit','vw_dispatch_vs_plant_test')"
  )) as unknown[];
  assert.equal(views.length, 2);
});

test.after(async () => {
  await prisma.$disconnect();
});
