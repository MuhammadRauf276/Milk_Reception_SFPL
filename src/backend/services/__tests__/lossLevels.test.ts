import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLossLevels, parseLossQuery, resolveLossPresetRange, type LevelJourneyInput, type LevelTankerInput } from '@/backend/services/lossCalculationService';

const journey = (id: string, zmccId: string, profileId: string, shop: number, recv: number, shop13: number, recv13: number | null): LevelJourneyInput => ({
  id, number: `J${id}`, date: '2026-03-01', zmccId, zmccName: `Z${zmccId}`, zmccCode: `Z${zmccId}`, routeCode: 'R', vehicleNumber: 'V',
  profileId, profileName: `P${profileId}`, profileCode: null, shopGross: shop, shop13ts: shop13, receivedGross: recv, received13ts: recv13, acceptedNotReceived: 0,
});
const tanker = (id: string, zmccId: string, disp: number, disp13: number | null, plant: { gross: number; at13ts: number | null } | null): LevelTankerInput => ({
  id, visitNumber: `V${id}`, date: '2026-03-01', sourceId: zmccId, sourceName: `Z${zmccId}`, sourceCode: `Z${zmccId}`, vehicleNumber: 'T', referenceNumber: id,
  status: 'DISPATCHED', dispatchedGross: disp, dispatched13ts: disp13, plant, plantNetKg: 0,
});

const base = () => ({
  zmccNames: new Map([['1', { name: 'Z1', code: 'Z1' }], ['2', { name: 'Z2', code: 'Z2' }]]),
  journeys: [
    journey('1', '1', '10', 1000, 980, 900, 885),
    journey('2', '1', '11', 500, 510, 450, 455),
    journey('3', '2', '12', 2000, 1990, 1800, 1790.5),
  ],
  hc: new Map([['1', { gross: 300, at13ts: 270 }]]),
  stock: new Map([
    ['1', { startGross: 100, endGross: 400, start13ts: 90, end13ts: 360 }],
    ['2', { startGross: 0, endGross: 500, start13ts: 0, end13ts: 450 }],
  ]),
  admin: new Map([['1', { inGross: 50, outGross: 0, in13ts: 45, out13ts: 0 }]]),
  tankers: [
    tanker('a', '1', 700, 630, { gross: 695, at13ts: 625 }),
    tanker('b', '1', 400, 360, null),
    tanker('c', '2', 1500, 1350, { gross: 1512, at13ts: 1352.25 }),
    tanker('d', '2', 100, null, { gross: 99, at13ts: 88 }),
  ],
  contractorTankers: [tanker('x', '9', 1000, 900, { gross: 990, at13ts: 893 }), tanker('y', '9', 500, 450, null)],
  acceptedNotReceivedLiters: 0,
});

const r2 = (n: number) => Number(n.toFixed(2));

test('MOT rolls up per Mobile Tester, Area per ZMCC, both the same net', () => {
  const l = buildLossLevels(base());
  assert.equal(l.mot.testers.length, 3);
  assert.equal(l.mot.total.gross.signed, -20);
  assert.equal(l.area.total.at13ts.signed, l.mot.total.at13ts.signed);
  const z1 = l.area.zmccs.find((a) => a.zmccId === '1')!;
  assert.equal(z1.total.gross.signed, -10);
  assert.equal(z1.journeyCount, 2);
  assert.equal(l.mot.total.gross.percent, Number(((-20 / 3500) * 100).toFixed(4)));
});

test('Whole net equals MOT net + Transit net exactly, gross and @13 TS', () => {
  const l = buildLossLevels(base());
  assert.equal(l.whole.reconciles, true);
  assert.equal(r2(l.whole.net.gross.signed), r2(l.mot.total.gross.signed + l.transit.net.gross.signed));
  assert.equal(r2(l.whole.net.at13ts.signed), r2(l.mot.total.at13ts.signed + l.transit.net.at13ts.signed));
  assert.equal(r2(l.transit.net.gross.signed), r2(l.transit.atZmcc.gross.signed + l.transit.onRoad.gross.signed));
  // admin is its own line, not in bought, and the net with admin adds it
  assert.equal(l.whole.lines.adminAdjustment.gross, 50);
  assert.equal(l.whole.lines.bought.gross, 3800);
  assert.equal(r2(l.whole.netWithAdmin.gross - l.whole.net.gross.signed), 50);
});

test('Whole lines reconcile: plant + tanks + road - bought = net', () => {
  const l = buildLossLevels(base());
  const w = l.whole.lines;
  assert.equal(r2(w.plantReceived.gross + w.stockChange.gross + w.onRoad.gross - w.bought.gross), l.whole.net.gross.signed);
  assert.equal(w.onRoad.gross, 400); // tanker b is not reconciled
  assert.equal(w.stockChange.gross, 750); // tank change of 800 without the 50 admin adjustment
});

test('contractor transit counts reconciled tankers only and is not in Whole', () => {
  const l = buildLossLevels(base());
  assert.equal(l.contractorTransit.total.gross.signed, -10);
  assert.equal(l.contractorTransit.pendingTankers, 1);
  assert.equal(l.whole.lines.bought.gross, 3800);
});

test('missing @13 TS is counted, never taken from gross', () => {
  const l = buildLossLevels(base());
  assert.equal(l.transit.onRoad.missing13ts, 1); // tanker d
  assert.equal(l.transit.onRoad.gross.signed, 6); // -5 + 12 - 1
  const m = buildLossLevels({ ...base(), journeys: [journey('9', '1', '10', 100, 100, 90, null)] });
  assert.equal(m.mot.total.missing13ts, 1);
});

test('Mobile Tester filter narrows MOT and Area only; Whole keeps every journey', () => {
  const all = buildLossLevels(base());
  const one = buildLossLevels({ ...base(), motProfileId: '10' });
  assert.equal(one.mot.testers.length, 1);
  assert.equal(one.mot.total.gross.signed, -20);
  assert.equal(one.whole.net.gross.signed, all.whole.net.gross.signed);
  assert.equal(one.whole.reconciles, true);
});

test('one-ZMCC subsets add up to the all-ZMCC figures', () => {
  const b = base();
  const all = buildLossLevels(b);
  const part = (id: string) => buildLossLevels({
    ...b,
    journeys: b.journeys.filter((j) => j.zmccId === id),
    hc: new Map([...b.hc].filter(([k]) => k === id)),
    stock: new Map([...b.stock].filter(([k]) => k === id)),
    admin: new Map([...b.admin].filter(([k]) => k === id)),
    tankers: b.tankers.filter((t) => t.sourceId === id),
  });
  const p1 = part('1');
  const p2 = part('2');
  const sum = (f: (x: typeof all) => number) => r2(f(p1) + f(p2));
  assert.equal(sum((x) => x.mot.total.gross.signed), all.mot.total.gross.signed);
  assert.equal(sum((x) => x.transit.net.at13ts.signed), all.transit.net.at13ts.signed);
  assert.equal(sum((x) => x.whole.net.gross.signed), all.whole.net.gross.signed);
});

test('filters: ids digits only, manager locked, presets and ranges', () => {
  const ctx = { role: 'SUPER_ADMIN', defaultPreset: 'LAST_30' as const, today: '2026-03-31' };
  assert.equal(parseLossQuery(new URLSearchParams('zmccIds=1,x'), ctx).ok, false);
  const ok = parseLossQuery(new URLSearchParams('zmccIds=1,2&contractorIds=5&motProfileId=7&preset=LAST_7'), ctx);
  assert.ok(ok.ok && ok.filters.zmccIds!.join() === '1,2' && ok.filters.preset === 'LAST_7' && ok.filters.motProfileId === '7');
  const mgr = parseLossQuery(new URLSearchParams('zmccIds=1,2'), { ...ctx, role: 'ZMCC_MANAGER', managerZmccId: BigInt(9) });
  assert.ok(mgr.ok && mgr.filters.zmccIds!.join() === '9' && mgr.filters.includeContractor === false);
  assert.equal(parseLossQuery(new URLSearchParams(''), { ...ctx, role: 'ZMCC_MANAGER' }).ok, false);
  assert.equal(parseLossQuery(new URLSearchParams('from=2024-01-01&to=2026-03-01'), ctx).ok, false);
  assert.equal(parseLossQuery(new URLSearchParams('from=2026-03-05&to=2026-03-01'), ctx).ok, false);
  const def = parseLossQuery(new URLSearchParams(''), ctx);
  assert.ok(def.ok && def.filters.preset === 'LAST_30');
  const r = resolveLossPresetRange('LAST_7', new Date('2026-03-31T10:00:00+05:00'));
  assert.deepEqual([r.from, r.to], ['2026-03-25', '2026-03-31']);
});
