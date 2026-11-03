import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStageCells, defaultModes } from '../testPointPolicyService';
import type { TestPointPolicyCell } from '@/types/test-point-policy';

function cell(
  id: string,
  testMode: TestPointPolicyCell['testMode'],
  source: 'DB' | 'DEFAULT',
  photoMode: TestPointPolicyCell['photoMode'] = 'NONE',
  extra: Partial<TestPointPolicyCell> = {}
): TestPointPolicyCell {
  return {
    labTestId: id,
    testCode: `X${id}`,
    testName: `Test ${id}`,
    displayOrder: Number(id),
    point: 'MOT_SHOP',
    testMode,
    ruleMode: 'APPLY',
    photoMode,
    version: source === 'DB' ? 1 : 0,
    effectiveFrom: new Date(0).toISOString(),
    source,
    ...extra,
  };
}

const LR = cell('1', 'OPTIONAL', 'DEFAULT', 'NONE', { testCode: 'MY-LR', testName: 'Density reading', systemRole: 'LR' });
const FAT = cell('2', 'OPTIONAL', 'DEFAULT', 'NONE', { testCode: 'MY-FAT', testName: 'Butterfat', systemRole: 'FAT' });

test('resolveStageCells: a saved matrix row beats a stage assignment (photo, mode, visibility)', () => {
  const cells = [LR, FAT, cell('3', 'OPTIONAL', 'DB', 'NONE'), cell('4', 'OFF', 'DB')];
  const assignments = new Map([
    ['3', { is_active: true, is_required: true, is_photo_required: true }], // must be ignored: matrix says optional / no photo
    ['4', { is_active: true, is_required: true, is_photo_required: true }], // must stay hidden: matrix says OFF
  ]);
  const out = resolveStageCells(cells, assignments);
  const three = out.find((c) => c.labTestId === '3')!;
  assert.equal(three.testMode, 'OPTIONAL');
  assert.equal(three.photoMode, 'NONE');
  assert.equal(out.some((c) => c.labTestId === '4'), false);
});

test('resolveStageCells: assignment only covers cells the matrix never saved, and never reorders', () => {
  const cells = [LR, FAT, cell('5', 'OPTIONAL', 'DEFAULT'), cell('6', 'OPTIONAL', 'DEFAULT')];
  const assignments = new Map([
    ['5', { is_active: true, is_required: true, is_photo_required: true }],
    ['6', { is_active: false, is_required: true, is_photo_required: true }],
  ]);
  const out = resolveStageCells(cells, assignments);
  const five = out.find((c) => c.labTestId === '5')!;
  assert.equal(five.testMode, 'COMPULSORY');
  assert.equal(five.photoMode, 'REQUIRED');
  assert.equal(five.displayOrder, 5);
  assert.equal(out.some((c) => c.labTestId === '6'), false);
});

test('resolveStageCells: unconfigured cells are hidden when the stage says so, LR and Fat are always carried by role', () => {
  const cells = [LR, FAT, cell('7', 'OPTIONAL', 'DEFAULT')];
  const out = resolveStageCells(cells, new Map(), () => false);
  assert.deepEqual(out.map((c) => c.labTestId), ['1', '2']);
  assert.ok(out.every((c) => c.testMode === 'COMPULSORY'), 'LR and Fat are locked compulsory');
});

test('defaultModes: LR / Fat default photo follows the stored role, not the test code', () => {
  assert.equal(defaultModes('MY-LR', 'MOT_SHOP', 'LR').photoMode, 'REQUIRED');
  assert.equal(defaultModes('MY-FAT', 'CONTRACTOR_DISPATCH', 'FAT').photoMode, 'OPTIONAL');
  assert.equal(defaultModes('MY-OTHER', 'MOT_SHOP', null).photoMode, 'NONE');
});

// ---- Matrix-first contract: more cases ----------------------------------------------------------------------------

import { selectStageCells, keepFormulaTests, relaxContractorDefaults } from '../testPointPolicyService';
import { labPolicyToEffectiveTests, type LabPolicySnapshot, type LabPolicyTest } from '../zmcc/labPortionDecision';

test('a COMPULSORY matrix cell stays visible even when its stage assignment is inactive', () => {
  const cells = [LR, FAT, cell('3', 'COMPULSORY', 'DB', 'REQUIRED')];
  const out = resolveStageCells(cells, new Map([['3', { is_active: false, is_required: false, is_photo_required: false }]]));
  const three = out.find((c) => c.labTestId === '3');
  assert.ok(three, 'compulsory cell must not be hidden by an inactive assignment');
  assert.equal(three.testMode, 'COMPULSORY');
  assert.equal(three.photoMode, 'REQUIRED');
});

test('LR and Fat come back when OFF in the matrix, and exactly once even if two tests look like LR', () => {
  const lrOff = cell('1', 'OFF', 'DB', 'NONE', { testCode: 'MY-LR', testName: 'Density reading', systemRole: 'LR' });
  const fatOff = cell('2', 'OFF', 'DB', 'NONE', { testCode: 'MY-FAT', testName: 'Butterfat', systemRole: 'FAT' });
  // old master test that still looks like LR by code and name but holds no stored role
  const lookAlike = cell('9', 'COMPULSORY', 'DB', 'NONE', { testCode: 'LT-000008', testName: 'LR at 20 Celsius', systemRole: null });
  const out = resolveStageCells([lrOff, fatOff, lookAlike], new Map());
  assert.equal(out.filter((c) => c.systemRole === 'LR').length, 1);
  assert.equal(out.filter((c) => c.systemRole === 'FAT').length, 1);
  assert.equal(out.some((c) => c.labTestId === '9'), false, 'the look-alike without a stored role is dropped');
  assert.equal(out.find((c) => c.labTestId === '1')!.testMode, 'COMPULSORY');
});

const LAB_REPORT = (source: 'DB' | 'DEFAULT', mode: TestPointPolicyCell['testMode'], photo: TestPointPolicyCell['photoMode'], point: TestPointPolicyCell['point']) =>
  cell('8', mode, source, photo, { testCode: 'LAB_REPORT_HANDWRITTEN', testName: 'Lab report (hand-written)', point });

test('Contractor: unsaved lab report is relaxed, a saved Contractor cell stays enforced, ZMCC dispatch is not relaxed', () => {
  const relaxed = relaxContractorDefaults('CONTRACTOR_DISPATCH', [LAB_REPORT('DEFAULT', 'COMPULSORY', 'REQUIRED', 'CONTRACTOR_DISPATCH')])[0];
  assert.deepEqual([relaxed.testMode, relaxed.photoMode], ['OPTIONAL', 'OPTIONAL']);

  const kept = relaxContractorDefaults('CONTRACTOR_DISPATCH', [LAB_REPORT('DB', 'COMPULSORY', 'REQUIRED', 'CONTRACTOR_DISPATCH')])[0];
  assert.deepEqual([kept.testMode, kept.photoMode], ['COMPULSORY', 'REQUIRED']);

  const same = relaxContractorDefaults('ZMCC_DISPATCH', [LAB_REPORT('DEFAULT', 'COMPULSORY', 'REQUIRED', 'ZMCC_DISPATCH')])[0];
  assert.deepEqual([same.testMode, same.photoMode], ['COMPULSORY', 'REQUIRED']);
});

test('Contractor: an unsaved lab-report cell still reaches the form, optional, through the dispatch resolver', () => {
  const all = [LR, FAT, LAB_REPORT('DEFAULT', 'COMPULSORY', 'REQUIRED', 'CONTRACTOR_DISPATCH')];
  const out = relaxContractorDefaults(
    'CONTRACTOR_DISPATCH',
    resolveStageCells(all, new Map(), (c) => c.testCode === 'LAB_REPORT_HANDWRITTEN')
  );
  const report = out.find((c) => c.testCode === 'LAB_REPORT_HANDWRITTEN')!;
  assert.deepEqual([report.testMode, report.photoMode], ['OPTIONAL', 'OPTIONAL']);
});

test('parity: Plant QA (selectStageCells + keepFormulaTests) and resolveStageCells agree when every cell is saved', () => {
  const lr = cell('1', 'OFF', 'DB', 'REQUIRED', { testCode: 'A-LR', testName: 'Density', systemRole: 'LR', displayOrder: 5 });
  const fat = cell('2', 'OPTIONAL', 'DB', 'NONE', { testCode: 'A-FAT', testName: 'Butterfat', systemRole: 'FAT', displayOrder: 3 });
  const rest = [
    cell('3', 'COMPULSORY', 'DB', 'REQUIRED', { displayOrder: 1 }),
    cell('4', 'OFF', 'DB', 'NONE', { displayOrder: 2 }),
    cell('5', 'OPTIONAL', 'DB', 'NONE', { displayOrder: 4 }),
    cell('6', 'NOT_APPLIED', 'DB', 'NONE', { displayOrder: 6 }),
  ];
  const all = [lr, fat, ...rest];
  const plant = keepFormulaTests(selectStageCells(all, new Map()), all)
    .sort((a, b) => a.displayOrder - b.displayOrder || Number(a.cell.labTestId) - Number(b.cell.labTestId))
    .map((s) => [s.cell.labTestId, s.isRequired, s.isPhotoRequired]);
  const other = resolveStageCells(all, new Map()).map((c) => [c.labTestId, c.testMode === 'COMPULSORY', c.photoMode === 'REQUIRED']);
  assert.deepEqual(other, plant);
  assert.deepEqual(other.map((r) => r[0]), ['3', '2', '5', '1'], 'visible set and order');
});

test('ZMCC lab session start gets exactly the cells the decision step uses (matrix OFF absent, flags carried)', () => {
  const all = [LR, FAT, cell('3', 'COMPULSORY', 'DB', 'REQUIRED'), cell('4', 'OFF', 'DB'), cell('5', 'OPTIONAL', 'DB')];
  const chosen = resolveStageCells(all, new Map());
  const policy: LabPolicySnapshot = {
    point: 'ZMCC_LAB_MC',
    version: 1,
    fetchedAt: '',
    tests: chosen.map((c): LabPolicyTest => ({ ...c, resultType: 'NUMERIC', unit: null, isLr: c.systemRole === 'LR', isFat: c.systemRole === 'FAT', options: null, rule: null })),
  };
  const session = labPolicyToEffectiveTests(policy);
  assert.deepEqual(session.map((t) => t.id), chosen.map((c) => c.labTestId));
  assert.equal(session.some((t) => t.id === '4'), false);
  const three = session.find((t) => t.id === '3')!;
  assert.deepEqual([three.isRequired, three.isPhotoRequired], [true, true]);
  assert.equal(session.find((t) => t.id === '5')!.isRequired, false);
});
