import test from 'node:test';
import assert from 'node:assert/strict';
import { staysOnTvBoard, TV_FINISHED_KEEP_MS } from '@/backend/services/tvBoardZmccService';

const now = Date.parse('2026-11-19T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();
const H = 3600 * 1000;

test('a plant vehicle stays on the yard board after receipt until it leaves the gate', () => {
  assert.equal(TV_FINISHED_KEEP_MS, 4 * H);
  assert.equal(staysOnTvBoard({ gate_exit_timestamp: null, final_receipt_timestamp: null }, now), true);
  assert.equal(staysOnTvBoard({ gate_exit_timestamp: null, final_receipt_timestamp: ago(2 * H) }, now), true);
});

test('it stays 4 hours after gate exit, then drops off', () => {
  assert.equal(staysOnTvBoard({ gate_exit_timestamp: ago(3.9 * H), final_receipt_timestamp: ago(5 * H) }, now), true);
  assert.equal(staysOnTvBoard({ gate_exit_timestamp: ago(4.1 * H), final_receipt_timestamp: ago(5 * H) }, now), false);
});

test('a received vehicle with no gate exit leaves a day after its receipt', () => {
  assert.equal(staysOnTvBoard({ gate_exit_timestamp: null, final_receipt_timestamp: ago(25 * H) }, now), false);
});
