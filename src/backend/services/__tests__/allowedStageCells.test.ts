import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllowedStageCells } from '../testPointPolicyService';
import type { TestPointPolicyCell } from '@/types/test-point-policy';

const cell = (id: string, testMode: string, systemRole: string | null = null): TestPointPolicyCell =>
  ({
    labTestId: id,
    testCode: `LT-${id}`,
    testName: `Test ${id}`,
    displayOrder: Number(id),
    systemRole,
    point: 'MOT_SHOP',
    testMode,
    ruleMode: 'APPLY',
    photoMode: 'NONE',
    version: 1,
    effectiveFrom: new Date(0).toISOString(),
    source: 'DB',
  }) as TestPointPolicyCell;

const LR = cell('1', 'COMPULSORY', 'LR');
const FAT = cell('2', 'COMPULSORY', 'FAT');
const on = (is_required = true) => ({ is_active: true, is_required, is_photo_required: false });

test('old matrix rows do not add tests the Super Admin did not allow', () => {
  const all = [LR, FAT, cell('3', 'COMPULSORY'), cell('4', 'COMPULSORY'), cell('5', 'COMPULSORY')];
  const out = resolveAllowedStageCells(all, new Map([['3', on()]]));
  assert.deepEqual(out.map((c) => c.labTestId), ['1', '2', '3']);
});

test('a test switched off on the list is hidden even with a matrix row', () => {
  const all = [LR, FAT, cell('3', 'COMPULSORY')];
  const out = resolveAllowedStageCells(all, new Map([['3', { ...on(), is_active: false }], ['9', on()]]));
  assert.deepEqual(out.map((c) => c.labTestId), ['1', '2']);
});

test('required or optional comes from the list', () => {
  const all = [LR, FAT, cell('3', 'COMPULSORY'), cell('4', 'APPLIED')];
  const out = resolveAllowedStageCells(all, new Map([['3', on(false)], ['4', on(true)]]));
  assert.equal(out.find((c) => c.labTestId === '3')?.testMode, 'OPTIONAL');
  assert.equal(out.find((c) => c.labTestId === '4')?.testMode, 'COMPULSORY');
});

test('LR and Fat stay and are compulsory even when the list leaves them out', () => {
  const out = resolveAllowedStageCells([LR, FAT, cell('3', 'OFF')], new Map([['3', on()]]));
  const ids = out.map((c) => c.labTestId);
  assert.ok(ids.includes('1') && ids.includes('2'));
  assert.ok(out.filter((c) => c.labTestId !== '3').every((c) => c.testMode === 'COMPULSORY'));
});

test('a calculated test keeps AUTO', () => {
  const out = resolveAllowedStageCells([LR, FAT, cell('3', 'AUTO')], new Map([['3', on()]]));
  assert.equal(out.find((c) => c.labTestId === '3')?.testMode, 'AUTO');
});

test('a stage with no list keeps the matrix rule', () => {
  const out = resolveAllowedStageCells([LR, FAT, cell('3', 'COMPULSORY'), cell('4', 'OFF')], new Map());
  assert.deepEqual(out.map((c) => c.labTestId), ['1', '2', '3']);
});
