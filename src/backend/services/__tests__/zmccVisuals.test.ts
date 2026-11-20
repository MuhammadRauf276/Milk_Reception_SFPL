import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTankDays } from '../visuals/zmccVisuals';

test('opening level is built from days before the range, quiet days carry the level forward', () => {
  const days = buildTankDays(
    [
      { day: '2026-11-08', inL: 5000, outL: 1000 },
      { day: '2026-11-10', inL: 2000, outL: 0 },
      { day: '2026-11-12', inL: 500, outL: 6000 },
      { day: '2026-11-15', inL: 999, outL: 0 },
    ],
    '2026-11-10',
    '2026-11-13'
  );
  assert.deepEqual(
    days.map((d) => [d.day, d.opening, d.inL, d.outL, d.closing]),
    [
      ['2026-11-10', 4000, 2000, 0, 6000],
      ['2026-11-11', 6000, 0, 0, 6000],
      ['2026-11-12', 6000, 500, 6000, 500],
      ['2026-11-13', 500, 0, 0, 500],
    ]
  );
});

test('a big dispatch on a low-intake day is explained by the opening level', () => {
  const [d] = buildTankDays([{ day: '2026-11-01', inL: 8000, outL: 0 }, { day: '2026-11-02', inL: 300, outL: 7000 }], '2026-11-02', '2026-11-02');
  assert.equal(d.opening, 8000);
  assert.equal(d.closing, 1300);
});

test('no ledger rows gives zero levels for every day', () => {
  const days = buildTankDays([], '2026-11-01', '2026-11-03');
  assert.equal(days.length, 3);
  assert.ok(days.every((d) => d.opening === 0 && d.closing === 0));
});
