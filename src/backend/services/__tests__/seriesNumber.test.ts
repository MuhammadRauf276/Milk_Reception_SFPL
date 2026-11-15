import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { formatSeriesNumber, highestInSeries, nextSeriesNumber } from '@/backend/services/numbering/seriesNumber';

test('the next number is one above the highest real number; drafts and other days are ignored', () => {
  const existing = ['MJ-20261115-0001', 'MJ-20261115-0005', 'MJ-20261114-0099', 'DRAFT-3f2a', 'MJ-20261115-ABCD', null, undefined];
  assert.equal(highestInSeries('MJ-20261115-', existing), 5);
  assert.equal(formatSeriesNumber('MJ-20261115-', highestInSeries('MJ-20261115-', existing) + 1, 4), 'MJ-20261115-0006');
  // Three people opened a form and left it: nothing was saved, so the next real record is still 6.
  assert.equal(highestInSeries('MJ-20261115-', [...existing, 'DRAFT-a', 'DRAFT-b', 'DRAFT-c']), 5);
  assert.equal(highestInSeries('MJ-20261116-', existing), 0, 'a new day starts again at 1');
  assert.equal(formatSeriesNumber('SHP-', 12, 6), 'SHP-000012');
  assert.equal(formatSeriesNumber('MJ-20261115-', 12345, 4), 'MJ-20261115-12345', 'a long number is never cut');
});

test('a save that fails gives its number back: the next save gets the same number', async () => {
  // A day far in the future, so nothing real uses this prefix. Nothing is inserted: both transactions end without a row.
  const prefix = 'MJ-29990101-';
  class Undo extends Error {}

  let taken = '';
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      taken = await nextSeriesNumber(tx, 'MOT_JOURNEY', prefix, 4);
      throw new Undo('the submit failed after the number was taken');
    }),
    Undo
  );
  assert.equal(taken, 'MJ-29990101-0001');

  const again = await prisma.$transaction((tx) => nextSeriesNumber(tx, 'MOT_JOURNEY', prefix, 4));
  assert.equal(again, 'MJ-29990101-0001', 'the number was not used up by the failed save');
});

test('every series continues from the highest number already saved', async () => {
  const cases = [
    { series: 'MOT_JOURNEY', rows: () => prisma.motJourney.findMany({ select: { journey_number: true } }).then((r) => r.map((x) => x.journey_number)) },
    { series: 'MOT_COLLECTION', rows: () => prisma.motShopCollection.findMany({ select: { collection_number: true } }).then((r) => r.map((x) => x.collection_number)) },
    { series: 'ZMCC_MOT_TOKEN', rows: () => prisma.zmccMotArrival.findMany({ select: { zmcc_token: true } }).then((r) => r.map((x) => x.zmcc_token)) },
    { series: 'ZMCC_HC_TOKEN', rows: () => prisma.zmccLocalSupplierArrival.findMany({ select: { zmcc_token: true } }).then((r) => r.map((x) => x.zmcc_token)) },
    { series: 'HC_SUPPLIER_CODE', rows: () => prisma.zmccLocalSupplier.findMany({ select: { local_supplier_code: true } }).then((r) => r.map((x) => x.local_supplier_code)) },
    { series: 'SHOP_CODE', rows: () => prisma.zmccShop.findMany({ select: { shop_code: true } }).then((r) => r.map((x) => x.shop_code)) },
    { series: 'ROUTE_CODE', rows: () => prisma.zmccRoute.findMany({ select: { route_code: true } }).then((r) => r.map((x) => x.route_code)) },
  ] as const;

  for (const c of cases) {
    const values = await c.rows();
    // Use the prefix of a real saved value when there is one, so the database query is checked against real data.
    const sample = values.find((v) => /^(.*?)(\d+)$/.test(v));
    const prefix = sample ? sample.replace(/\d+$/, '') : 'ZZ-TEST-';
    const expected = formatSeriesNumber(prefix, highestInSeries(prefix, values) + 1, 4);
    const got = await prisma.$transaction((tx) => nextSeriesNumber(tx, c.series, prefix, 4));
    assert.equal(Number(got.slice(prefix.length)), Number(expected.slice(prefix.length)), `${c.series} with prefix ${prefix}`);
  }
});

test('two saves at the same moment take their numbers one after the other, never together', async () => {
  // Both take the number for the same prefix. The second waits for the first, and since the first saves nothing
  // here, both see the same highest number: what matters is that they ran one after the other, not together.
  const prefix = 'MC-29990102-';
  const order: string[] = [];
  const run = (name: string) =>
    prisma.$transaction(async (tx) => {
      const n = await nextSeriesNumber(tx, 'MOT_COLLECTION', prefix, 4);
      order.push(`${name}:in`);
      await new Promise((r) => setTimeout(r, 150));
      order.push(`${name}:out`);
      return n;
    });
  await Promise.all([run('a'), run('b')]);
  // Never interleaved: one finished completely before the other got its number.
  const joined = order.join(' ');
  assert.ok(joined === 'a:in a:out b:in b:out' || joined === 'b:in b:out a:in a:out', `ran together: ${joined}`);
});

test.after(async () => {
  await prisma.$disconnect();
});
