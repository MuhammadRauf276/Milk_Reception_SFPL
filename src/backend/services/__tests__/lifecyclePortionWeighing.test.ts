import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveManagerLifecycle } from '@/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import type { MilkProcessLog } from '@/backend/core/types';

const portion = (n: number, over: Partial<MilkProcessLog> = {}) =>
  ({
    id: 7,
    portion_number: `P-0${n}`,
    status: 'READY_FOR_TARE',
    vehicle_number: 'TK-1',
    calculated_status: 'ACCEPTED',
    gate_entry_timestamp: '2026-11-17T05:00:00.000Z',
    first_weight_of_vehicle: 30000,
    first_weight_timestamp: '2026-11-17T05:30:00.000Z',
    ...over,
  }) as unknown as MilkProcessLog;

test('one accepted portion keeps the single Unload and Second Weight pair', () => {
  const lc = deriveManagerLifecycle([portion(1)]);
  assert.deepEqual(
    lc.stages.map((s) => s.id),
    ['DISPATCH', 'GATE_ENTRY', 'PLANT_QA', 'FIRST_WEIGHT', 'UNLOADING', 'SECOND_WEIGHT', 'FINAL_RECEIPT', 'GATE_EXIT']
  );
});

test('two accepted portions get one Unload and one Weight step each, filled as they happen', () => {
  const lc = deriveManagerLifecycle([
    portion(1, { unloading_start_timestamp: '2026-11-17T06:00:00.000Z', unloading_end_timestamp: '2026-11-17T06:20:00.000Z', portion_second_weight_kg: 22000, portion_second_weight_at: '2026-11-17T06:30:00.000Z' }),
    portion(2, { unloading_start_timestamp: '2026-11-17T06:40:00.000Z' }),
  ]);
  const middle = lc.stages.slice(4, 8);
  assert.deepEqual(middle.map((s) => s.label), ['Unload P-01', 'Weight 2 (After P-01)', 'Unload P-02', 'Weight 3 (Empty)']);
  assert.deepEqual(middle.map((s) => s.status), ['COMPLETED', 'COMPLETED', 'CURRENT', 'UPCOMING']);
  assert.equal(middle[1].metricText, '22,000 KG');
  assert.equal(new Set(lc.stages.map((s) => s.key ?? s.id)).size, lc.stages.length, 'every step has its own key');
});

test('a rejected portion is not unloaded or weighed', () => {
  const lc = deriveManagerLifecycle([portion(1), portion(2, { calculated_status: 'REJECTED' }), portion(3)]);
  assert.deepEqual(lc.stages.slice(4, 8).map((s) => s.label), ['Unload P-01', 'Weight 2 (After P-01)', 'Unload P-03', 'Weight 3 (Empty)']);
});
