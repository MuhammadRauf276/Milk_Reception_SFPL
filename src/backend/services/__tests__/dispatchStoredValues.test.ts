import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchTestsToSave, type DispatchTestToSave } from '../labTestAssignmentService';
import { dispatchDecisionPortion, mapVisitToLogs, type OperationalVisit } from '../operationalReadModelService';

const assigned = (id: number, name: string): DispatchTestToSave => ({
  test_id: BigInt(id),
  test_code_snapshot: `LT-${id}`,
  test_name_snapshot: name,
  result_type_snapshot: 'NUMERIC',
  result_options_snapshot: null,
});
const policy = (id: number, name: string, over: Partial<{ isLabReport: boolean; resultOptions: unknown }> = {}) => ({
  labTestId: String(id),
  testCode: `LT-${id}`,
  testName: name,
  resultType: 'NUMERIC',
  isLabReport: false,
  ...over,
});

test('a policy test missing from the frozen assignment is still saved', () => {
  // LES-3160: Fat had scope ALL, so it never joined the assignment, but the form sent it.
  const saved = dispatchTestsToSave([assigned(12, 'Urea')], [policy(26, 'Fat'), policy(12, 'Urea')]);
  assert.deepEqual(saved.map((t) => t.test_name_snapshot), ['Urea', 'Fat']);
});

test('a test on both lists is saved once, keeping its frozen snapshot', () => {
  const frozen = { ...assigned(12, 'Urea'), test_name_snapshot: 'Urea (frozen)' };
  const saved = dispatchTestsToSave([frozen], [policy(12, 'Urea renamed')]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].test_name_snapshot, 'Urea (frozen)');
});

test('an assigned test outside the policy stays, so old drafts keep saving it', () => {
  const saved = dispatchTestsToSave([assigned(7, 'Old test')], []);
  assert.deepEqual(saved.map((t) => t.test_name_snapshot), ['Old test']);
});

test('the lab report is a photo, so it gets no result row', () => {
  const saved = dispatchTestsToSave([], [policy(40, 'Lab report', { isLabReport: true })]);
  assert.deepEqual(saved, []);
});

test('options are carried for a test added from the policy', () => {
  const options = [{ value: 'OK', isPassing: true }];
  const [saved] = dispatchTestsToSave([], [policy(2, 'Smell', { resultOptions: options })]);
  assert.deepEqual(saved.result_options_snapshot, options);
});

test('the stored decision finds a portion by seal first, since plant QA can renumber', () => {
  const details = {
    portions: [
      { portionNumber: 1, sealNumber: 'S-A', fat: 3, lr: 26, tests: [] },
      { portionNumber: 2, sealNumber: 'S-B', fat: 5, lr: 27, tests: [] },
    ],
  };
  assert.equal(dispatchDecisionPortion(details, { portion_number: 1, seal_number: 'S-B' })?.fat, 5);
  assert.equal(dispatchDecisionPortion(details, { portion_number: 2, seal_number: null })?.fat, 5);
  assert.equal(dispatchDecisionPortion(details, { portion_number: 9, seal_number: 'none' }), null);
});

test('a missing or malformed decision is treated as no decision', () => {
  for (const bad of [null, undefined, 'x', {}, { portions: 'x' }]) {
    assert.equal(dispatchDecisionPortion(bad, { portion_number: 1 }), null);
  }
});

const masterTests = [
  { id: BigInt(1), testCode: 'A1', testName: 'Fat', resultType: 'NUMERIC', unit: '%', displayOrder: 1, isActive: true, systemRole: 'FAT' },
  { id: BigInt(2), testCode: 'A2', testName: 'LR', resultType: 'NUMERIC', unit: null, displayOrder: 2, isActive: true, systemRole: 'LR' },
  { id: BigInt(3), testCode: 'A3', testName: 'Clot', resultType: 'POSITIVE_NEGATIVE', unit: null, displayOrder: 3, isActive: true },
  { id: BigInt(4), testCode: 'A4', testName: 'Acidity', resultType: 'NUMERIC', unit: '%', displayOrder: 4, isActive: true },
  { id: BigInt(5), testCode: 'A5', testName: 'Urea', resultType: 'NUMERIC', unit: null, displayOrder: 5, isActive: true },
  { id: BigInt(6), testCode: 'A6', testName: 'Aflatoxin', resultType: 'NUMERIC', unit: null, displayOrder: 6, isActive: true },
  { id: BigInt(7), testCode: 'A7', testName: 'Old', resultType: 'NUMERIC', unit: null, displayOrder: 7, isActive: false },
  { id: BigInt(8), testCode: 'A8', testName: 'Old unused', resultType: 'NUMERIC', unit: null, displayOrder: 8, isActive: false },
];

const test1 = (labTestId: string, value: number | null, textValue: string | null = null) => ({ labTestId, value, textValue });

function visit(over: { results?: unknown[]; details?: unknown } = {}) {
  return {
    id: BigInt(14),
    vehicle_number: 'LES-3160',
    current_status: 'READY_FOR_GROSS',
    created_at: new Date(),
    updated_at: new Date(),
    vehicle_dispatch_fat: 4.4,
    vehicle_dispatch_lr: 25,
    dispatch_decision_details: over.details ?? {
      portions: [
        {
          portionNumber: 1,
          sealNumber: 'S-1',
          fat: 5,
          lr: 26.5,
          tests: [test1('1', 5), test1('2', 26.5), test1('3', null, 'NEGATIVE'), test1('4', 0.12), test1('6', null), test1('7', 9)],
        },
      ],
    },
    inventory_transactions: [],
    portions: [
      {
        id: BigInt(50),
        portion_number: 1,
        seal_number: 'S-1',
        dispatch_lab_results: over.results ?? [
          { test_id: BigInt(5), performance_status: 'NOT_PERFORMED', not_performed_reason: 'Not performed at dispatch', numeric_value: null, text_value: null, lab_test: masterTests[4] },
        ],
        plant_lab_results: [],
        dispatch_info: null,
        unloading_log: null,
      },
    ],
  } as unknown as OperationalVisit;
}

const rowsOf = (v: OperationalVisit) => {
  const [log] = mapVisitToLogs(v, masterTests);
  return { log, byName: new Map((log.portion_lab_results ?? []).map((r) => [r.test_name, r])) };
};

test('LES-3160: typed values with no result row show from the stored decision', () => {
  const { log, byName } = rowsOf(visit());
  assert.equal(byName.get('Acidity')?.dispatch_numeric_value, 0.12);
  assert.equal(byName.get('Acidity')?.dispatch_performed, true);
  assert.equal(byName.get('Clot')?.dispatch_text_value, 'NEGATIVE');
  assert.equal(byName.get('Fat')?.dispatch_numeric_value, 5);
  // The portion's own Fat and LR, not the vehicle-level 4.4 and 25.
  assert.equal(log.dispatch_fat, 5);
  assert.equal(log.dispatch_lr, 26.5);
  assert.equal(log.computed_dispatch_snf, 8.445);
  assert.equal(log.computed_dispatch_ts, 13.445);
});

test('a test really not performed still says so, with its reason', () => {
  const urea = rowsOf(visit()).byName.get('Urea');
  assert.equal(urea?.dispatch_performed, false);
  assert.equal(urea?.dispatch_marked_not_performed, true);
  assert.equal(urea?.dispatch_not_performed_reason, 'Not performed at dispatch');
});

test('a test sent empty and with no row stays not recorded', () => {
  const aflatoxin = rowsOf(visit()).byName.get('Aflatoxin');
  assert.equal(aflatoxin?.dispatch_performed, false);
  assert.equal(aflatoxin?.dispatch_numeric_value, null);
  assert.equal(aflatoxin?.dispatch_marked_not_performed, false);
});

test('a saved result row wins over the stored decision', () => {
  const { byName } = rowsOf(
    visit({ results: [{ test_id: BigInt(4), performance_status: 'PERFORMED', numeric_value: 0.2, text_value: null, lab_test: masterTests[3] }] })
  );
  assert.equal(byName.get('Acidity')?.dispatch_numeric_value, 0.2);
});

test('an inactive test appears only when the decision has a value for it', () => {
  const { byName } = rowsOf(visit());
  assert.equal(byName.get('Old')?.dispatch_numeric_value, 9);
  assert.equal(byName.has('Old unused'), false);
});

test('a visit with no stored decision falls back to the vehicle-level values', () => {
  const { log } = rowsOf(visit({ details: {} }));
  assert.equal(log.dispatch_fat, 4.4);
  assert.equal(log.dispatch_lr, 25);
});
