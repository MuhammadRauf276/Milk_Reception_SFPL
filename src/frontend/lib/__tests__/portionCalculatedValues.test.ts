import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatedValuesForPortion, readingToNumber, type PortionCalcTest } from '../../../lib/portion-calculated-values';
import { buildDispatchPreview, type DispatchPolicyTest } from '../../modules/forms/dispatchDecisionPreview';

const base = { point: 'ZMCC_DISPATCH', displayOrder: 1, ruleMode: 'APPLY', photoMode: 'NONE', version: 1, effectiveFrom: '', source: 'DB', rule: null } as const;
function pt(id: string, over: Partial<DispatchPolicyTest>): DispatchPolicyTest {
  return { ...base, labTestId: id, testCode: `C${id}`, testName: `Test ${id}`, testMode: 'OPTIONAL', resultType: 'NUMERIC', isLr: false, isFat: false, ...over } as DispatchPolicyTest;
}

const LR = pt('1', { testCode: 'LR-X', testName: 'Density reading', systemRole: 'LR', isLr: true, testMode: 'COMPULSORY' });
const FAT = pt('2', { testCode: 'FAT-X', testName: 'Butterfat', systemRole: 'FAT', isFat: true, testMode: 'COMPULSORY' });
const SNF = pt('3', { testCode: 'RENAMED-A', testName: 'Lean solids', systemRole: 'SNF' });
const TS = pt('4', { testCode: 'RENAMED-B', testName: 'Everything solid', systemRole: 'TOTAL_SOLIDS' });
const RATIO = pt('5', { testCode: 'RENAMED-C', testName: 'Quotient', systemRole: 'SNF_FAT_RATIO' });
const STARCH = pt('6', { testCode: 'STARCH', testName: 'Starch', resultType: 'POSITIVE_NEGATIVE' });
const reading = (m: Record<string, string | undefined>) => (t: PortionCalcTest) => m[t.labTestId];

test('SNF, TS and ratio from LR 25 and Fat 4.0', () => {
  const out = calculatedValuesForPortion([LR, FAT, SNF, TS, RATIO], reading({ '1': '25', '2': '4.0' }));
  assert.equal(out['3'], 7.85);
  assert.equal(out['4'], 11.85);
  assert.equal(out['5'], 1.96);
  assert.equal('1' in out, false, 'LR is not a calculated test');
});

test('missing, empty, invalid or zero LR/Fat give null', () => {
  for (const m of [{}, { '1': '25' }, { '2': '4' }, { '1': '', '2': '' }, { '1': 'abc', '2': '4' }, { '1': '0', '2': '4' }, { '1': '25', '2': '0' }, { '1': '-3', '2': '4' }]) {
    const out = calculatedValuesForPortion([LR, FAT, SNF, TS, RATIO], reading(m));
    assert.deepEqual(out, { '3': null, '4': null, '5': null }, JSON.stringify(m));
  }
});

test('LR/Fat found by stored role when the server flags are absent; renamed codes still work', () => {
  const lr = { ...LR, isLr: undefined };
  const fat = { ...FAT, isFat: undefined };
  const out = calculatedValuesForPortion([lr, fat, SNF], reading({ '1': '25', '2': '4' }));
  assert.equal(out['3'], 7.85);
});

test('a test with no role and a categorical type is never calculated', () => {
  const out = calculatedValuesForPortion([LR, FAT, STARCH, SNF], reading({ '1': '25', '2': '4', '6': 'NEGATIVE' }));
  assert.equal('6' in out, false);
  const looksLikeSnf = pt('7', { testCode: 'SNF', testName: 'SNF', resultType: 'POSITIVE_NEGATIVE' });
  assert.equal('7' in calculatedValuesForPortion([LR, FAT, looksLikeSnf], reading({ '1': '25', '2': '4' })), false);
});

test('readingToNumber', () => {
  assert.equal(readingToNumber(''), null);
  assert.equal(readingToNumber('  '), null);
  assert.equal(readingToNumber(undefined), null);
  assert.equal(readingToNumber('4.5'), 4.5);
  assert.equal(readingToNumber('x'), null);
});

// ---- dispatch decision preview ----------------------------------------------------------------------------------
function preview(tests: DispatchPolicyTest[], values: Record<string, string>) {
  return buildDispatchPreview({
    tests,
    portions: [{ portionNumber: 1, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, text: '' }])), photos: {} }],
    labReportTaken: true,
    personDecision: 'ACCEPT',
    remarks: '',
    deciderCanApprove: false,
  });
}

test('an empty optional calculated test does not block the decision', () => {
  const p = preview([{ ...LR, testMode: 'OPTIONAL' }, { ...FAT, testMode: 'OPTIONAL' }, SNF, TS, RATIO], {});
  assert.equal(p.rows.some((r) => r.note === 'Must be done'), false);
  assert.equal(p.decision?.route, 'PROCEED');
});

test('a compulsory calculated test is satisfied with LR and Fat, missing without them', () => {
  const tests = [LR, FAT, { ...SNF, testMode: 'COMPULSORY' as const }, { ...RATIO, testMode: 'COMPULSORY' as const, photoMode: 'REQUIRED' as const }];
  const ok = preview(tests, { '1': '25', '2': '4' });
  assert.equal(ok.decision?.route, 'PROCEED');
  assert.equal(ok.rows.find((r) => r.key === '1:3')?.valueText, '7.85');
  assert.equal(ok.rows.find((r) => r.key === '1:5')?.note, null, 'a calculated test never needs a picture');
  const missing = preview(tests, { '1': '25' });
  assert.notEqual(missing.decision?.route, 'PROCEED');
  assert.equal(missing.rows.find((r) => r.key === '1:3')?.note, 'Must be done');
});
