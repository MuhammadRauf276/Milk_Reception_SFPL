import test from 'node:test';
import assert from 'node:assert/strict';
import { explainWhole, type FlowSource } from '../../modules/management-reporting/visuals/flowContracts';

const pair = (liters: number, at13ts = liters) => ({ liters, at13ts });

const src: FlowSource = {
  shops: pair(1000, 990),
  shopsOnWay: pair(100, 98),
  receivedMot: pair(850, 840),
  receivedHc: pair(500, 495),
  receivedOther: pair(50, 50),
  adminIn: pair(30, 30),
  adminOut: pair(10, 10),
  dispatchSlip: pair(1300, 1290),
  plant: pair(1100, 1085),
  tankChange: pair(-80, -82),
  loss: {
    motTrip: pair(-50, -49),
    slipOver13ts: 20,
    road: pair(-150, -160),
    roadVsSlip: pair(-120, -135),
    whole: pair(-200, -209),
  },
};

test('purchased is shops plus HC; difference is plant minus purchased', () => {
  const w = explainWhole(src, 'liters');
  assert.equal(w.purchased, 1500);
  assert.equal(w.plant, 1100);
  assert.equal(w.difference, -400);
  assert.equal(Math.round(w.percent! * 100) / 100, -26.67);
});

test('parts and the unexplained remainder add up exactly to the difference, in both units', () => {
  for (const unit of ['liters', 'at13'] as const) {
    const w = explainWhole(src, unit);
    const total = w.parts.reduce((s, p) => s + p.value, 0) + w.unexplained;
    assert.ok(Math.abs(total - w.difference) < 0.011, `${unit}: ${total} vs ${w.difference}`);
  }
});

test('tankers not at the plant: slip minus the slip of tankers the plant received', () => {
  const w = explainWhole(src, 'liters');
  // received slip = plant - transit = 1100 + 120 = 1220; pending = 1300 - 1220
  assert.equal(w.pendingSlip, 80);
  assert.equal(w.parts.find((p) => p.key === 'pending')!.value, -80);
  assert.equal(w.parts.find((p) => p.key === 'transit')!.value, -120);
});

test('overstatement exists only in @13 TS; a tank that gave up stock is a gain to the chain', () => {
  assert.equal(explainWhole(src, 'liters').parts.find((p) => p.key === 'over')!.value, 0);
  assert.equal(explainWhole(src, 'at13').parts.find((p) => p.key === 'over')!.value, 20);
  assert.equal(explainWhole(src, 'liters').parts.find((p) => p.key === 'tank')!.value, 80);
});

test('nothing purchased gives no percent and no crash', () => {
  const w = explainWhole({ ...src, shops: pair(0), receivedHc: pair(0) }, 'at13');
  assert.equal(w.percent, null);
});

test('without tank figures the tank part is zero', () => {
  const w = explainWhole({ ...src, tankChange: undefined }, 'liters');
  assert.equal(w.parts.find((p) => p.key === 'tank')!.value, 0);
});

import { transitDays, waterfallSteps, tankChangeOf } from '../../modules/management-reporting/visuals/flowContracts';

test('waterfall runs from purchased to plant', () => {
  for (const unit of ['liters', 'at13'] as const) {
    const w = explainWhole(src, unit);
    const steps = waterfallSteps(w);
    assert.equal(steps[0].key, 'purchased');
    assert.equal(steps[steps.length - 1].key, 'plant');
    const deltas = steps.filter((s) => s.kind === 'delta');
    const last = deltas.length ? deltas[deltas.length - 1].end : steps[0].end;
    assert.ok(Math.abs(last - w.plant) < 0.05, `${unit}: ${last} vs ${w.plant}`);
  }
  assert.ok(waterfallSteps(explainWhole(src, 'liters'), 0.5)[0].value === 750);
});

test('tank change is closing minus opening, summed over ZMCCs', () => {
  const d = (opening: number, closing: number) => [{ day: 'x', opening, inL: 0, outL: 0, closing }];
  assert.equal(tankChangeOf([d(100, 160), d(0, 40)], null).liters, 100);
  assert.equal(tankChangeOf([d(100, 160)], 13).at13ts, 60);
});

test('transit by dispatch day counts only received tankers; pending slip is kept apart', () => {
  const tanker = (slip: number, plant: number | null) => ({ dispatch: pair(slip), plant: plant == null ? null : pair(plant) });
  const stage = {
    daily: [{ day: '2026-01-01' }, { day: '2026-01-02' }],
    zmccs: [{ cycles: [{ day: '2026-01-01', tankers: [tanker(1000, 980), tanker(500, null)] }, { day: '2026-01-02', tankers: [tanker(200, 210)] }] }],
  } as never;
  const days = transitDays(stage, 'liters');
  assert.deepEqual(days.map((d) => [d.day, d.transit, d.pendingSlip, d.pendingTankers]), [['2026-01-01', -20, 500, 1], ['2026-01-02', 10, 0, 0]]);
});
