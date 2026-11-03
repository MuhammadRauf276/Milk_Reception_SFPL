import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDispatchDecision } from '../dispatch/dispatchDecisionService';

const base = { point: 'ZMCC_DISPATCH', displayOrder: 1, ruleMode: 'APPLY', photoMode: 'NONE', version: 1, effectiveFrom: '', source: 'DB', rule: null, unit: null, isLabReport: false, resultType: 'NUMERIC', testMode: 'OPTIONAL' };
const LR = { ...base, labTestId: '1', testCode: 'LR-X', testName: 'Density reading', systemRole: 'LR', isLr: true, isFat: false, testMode: 'COMPULSORY' };
const FAT = { ...base, labTestId: '2', testCode: 'FAT-X', testName: 'Butterfat', systemRole: 'FAT', isLr: false, isFat: true, testMode: 'COMPULSORY' };
const SNF = { ...base, labTestId: '3', testCode: 'RENAMED-A', testName: 'Lean solids', systemRole: 'SNF', isLr: false, isFat: false, testMode: 'COMPULSORY' };

test('server dispatch decision: compulsory calculated test uses its own value, ignores a client value', () => {
  const policy = {
    point: 'ZMCC_DISPATCH', version: 1,
    tests: [LR, FAT, SNF],
  } as never;
  const run = (tests: Array<{ labTestId: string; value: number }>) =>
    buildDispatchDecision(policy, {
      testMode: 'COMPOSITE',
      portions: [{ portionNumber: 1, sealNumber: 'S1', quantityValue: 100, quantityUnit: 'KG', tests, photos: [] }],
      labReportCaptureId: 'x', personDecision: 'ACCEPT', remarks: null, deciderCanApprove: false,
    } as never);
  const ok = run([{ labTestId: '1', value: 25 }, { labTestId: '2', value: 4 }, { labTestId: '3', value: 99 }]);
  const snfRow = ok.details.portions[0].tests.find((r) => r.labTestId === '3');
  assert.equal(snfRow?.value, 7.85, 'client value 99 is ignored');
  assert.equal(ok.details.missingCompulsory.length, 0);
  const missing = run([{ labTestId: '1', value: 25 }]);
  assert.deepEqual(missing.details.missingCompulsory, ['Butterfat', 'Lean solids']);
});
