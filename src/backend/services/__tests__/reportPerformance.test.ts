import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { prisma } from '@/backend/core/db';
import { ReportTimeoutError, reportRangeError, withReportTimeout } from '@/backend/core/reportQuery';
import { loadCollectionAggregates, loadHcReceiptAggregates } from '@/backend/services/zmccAnalyticsSql';
import { clearMpdExecutiveTelemetryCache, getMpdExecutiveTelemetry } from '@/backend/services/mpdExecutiveService';
import { createTtlCache } from '@/backend/services/ttlCache';
import { getBatchTankPhysicalStock, getBatchTankCommercialStock, getBatchTankStocks } from '@/backend/services/zmccTankService';
import { getPakistanDayWindow } from '@/backend/core/business-day';

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);
const pkHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }).format(d));

after(async () => {
  await prisma.$disconnect();
});

describe('report SQL aggregations equal a plain JavaScript sum over the same rows', () => {
  const from = '2000-01-01';
  const to = '2100-01-01';

  it('collection sums per route, day and hour', async () => {
    const rows = await prisma.motShopCollection.findMany({
      where: { operational_date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, NOT: { final_decision: 'REJECTED' } },
      orderBy: [{ device_collected_at: 'asc' }, { id: 'asc' }],
    });
    const agg = await loadCollectionAggregates({ from, to });

    const total = rows.reduce((s, r) => s + Number(r.gross_liters), 0);
    close(agg.byDayHourRoute.reduce((s, r) => s + r.liters, 0), total);
    close(agg.byDayHourRoute.reduce((s, r) => s + r.fatWeighted, 0), rows.reduce((s, r) => s + Number(r.fat) * Number(r.gross_liters), 0));
    assert.equal(agg.byDayHourRoute.reduce((s, r) => s + r.count, 0), rows.length);

    for (const route of agg.byRoute) {
      const own = rows.filter((r) => r.route_id.toString() === route.routeId);
      close(route.liters, own.reduce((s, r) => s + Number(r.gross_liters), 0));
      close(route.at13ts, own.reduce((s, r) => s + Number(r.at_13ts_liters), 0));
      assert.equal(route.shopCount, new Set(own.map((r) => r.shop_id.toString())).size);
    }
    for (const cell of agg.byDayHourRoute) {
      const own = rows.filter(
        (r) => r.route_id.toString() === cell.routeId && r.operational_date.toISOString().slice(0, 10) === cell.date && pkHour(r.device_collected_at) === cell.hour
      );
      close(cell.liters, own.reduce((s, r) => s + Number(r.gross_liters), 0));
    }
    assert.deepEqual(agg.scatter.map((s) => s.id), rows.slice(0, 150).map((r) => r.id.toString()));
  });

  it('morning shift keeps only collections before 13:00 Pakistan time', async () => {
    const rows = await prisma.motShopCollection.findMany({
      where: { operational_date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, NOT: { final_decision: 'REJECTED' } },
    });
    const morning = rows.filter((r) => pkHour(r.device_collected_at) < 13);
    const agg = await loadCollectionAggregates({ from, to, shift: 'MORNING' });
    close(agg.byDayHourRoute.reduce((s, r) => s + r.liters, 0), morning.reduce((s, r) => s + Number(r.gross_liters), 0));
  });

  it('HC receipt sums per day and hour', async () => {
    const receipts = await prisma.zmccTankReceipt.findMany({ where: { arrival_type: 'HC' } });
    const agg = await loadHcReceiptAggregates({ windowStart: new Date('2000-01-01T00:00:00Z'), windowEnd: new Date('2100-01-01T00:00:00Z') });
    close(agg.reduce((s, r) => s + r.liters, 0), receipts.reduce((s, r) => s + Number(r.gross_liters), 0));
    close(agg.reduce((s, r) => s + r.at13ts, 0), receipts.reduce((s, r) => s + Number(r.at_13ts_liters), 0));
    assert.equal(agg.reduce((s, r) => s + r.count, 0), receipts.length);
  });

  it('one-scan tank stock equals the two single-purpose reads', async () => {
    const tanks = await prisma.zmccTank.findMany({ select: { id: true } });
    const ids = tanks.map((t) => t.id);
    const [physical, commercial, both] = await Promise.all([getBatchTankPhysicalStock(ids), getBatchTankCommercialStock(ids), getBatchTankStocks(ids)]);
    assert.deepEqual([...both.physical].sort(), [...physical].sort());
    assert.deepEqual([...both.commercial].sort(), [...commercial].sort());
  });

  it('the first day window helper is unchanged (sanity for the Pakistan day used by the overview)', () => {
    const day = getPakistanDayWindow('2026-10-28');
    assert.ok(day.start.getTime() < day.end.getTime());
  });
});

describe('overview cache', () => {
  it('returns the same object within the lifetime and a fresh one after it', async () => {
    let clock = 1_000;
    let loads = 0;
    const cache = createTtlCache<{ n: number }>({ ttlMs: 15_000, now: () => clock });
    const load = async () => ({ n: ++loads });

    const first = await cache.get('erp', load);
    clock += 14_999;
    assert.equal(await cache.get('erp', load), first);
    assert.equal(loads, 1);

    clock += 2;
    const second = await cache.get('erp', load);
    assert.notEqual(second, first);
    assert.equal(loads, 2);
  });

  it('keeps each key separate and shares one computation between simultaneous callers', async () => {
    let loads = 0;
    const cache = createTtlCache<string>({ ttlMs: 1_000, now: () => 0 });
    const load = (value: string) => async () => {
      loads++;
      return value;
    };
    const [a, b, c] = await Promise.all([cache.get('a', load('A')), cache.get('a', load('A2')), cache.get('b', load('B'))]);
    assert.equal(a, 'A');
    assert.equal(b, 'A');
    assert.equal(c, 'B');
    assert.equal(loads, 2);
  });

  it('does not keep a failed computation', async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, now: () => 0 });
    await assert.rejects(cache.get('k', async () => Promise.reject(new Error('boom'))));
    assert.equal(await cache.get('k', async () => 'ok'), 'ok');
  });

  it('the Command Center overview is shared between callers until the cache is cleared', async () => {
    clearMpdExecutiveTelemetryCache();
    const first = await getMpdExecutiveTelemetry({ includeErpCode: false });
    assert.equal(await getMpdExecutiveTelemetry({ includeErpCode: false }), first);
    const withErp = await getMpdExecutiveTelemetry({ includeErpCode: true });
    assert.notEqual(withErp, first);
    clearMpdExecutiveTelemetryCache();
    assert.notEqual(await getMpdExecutiveTelemetry({ includeErpCode: false }), first);
    clearMpdExecutiveTelemetryCache();
  });
});

describe('report limits', () => {
  it('stops a slow query with a plain message', async () => {
    await assert.rejects(
      withReportTimeout((tx) => tx.$queryRaw`SELECT pg_sleep(3)`, 200),
      (error: unknown) => error instanceof ReportTimeoutError && /too long/i.test(error.message)
    );
  });

  it('accepts a normal range and refuses a range over a year', () => {
    assert.equal(reportRangeError('2026-01-01', '2026-06-01', '2026-11-16'), null);
    assert.equal(reportRangeError(undefined, undefined, '2026-11-16'), null);
    assert.match(reportRangeError('2020-01-01', '2026-06-01', '2026-11-16') ?? '', /at most/);
  });
});
