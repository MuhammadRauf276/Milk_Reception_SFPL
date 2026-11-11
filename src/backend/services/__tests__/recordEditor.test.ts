import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEditorSave, changedFields, isoToPakistanInput, pakistanInputToIso, REQUESTING_ROLES, requestableEntities, ticketModuleFor, ticketTarget, type EditorSection } from '../../../lib/recordEditor';
import { AUTO_APPLY_MODULES, splitLabTicketChanges, splitVisitTicketChanges } from '../correctionGovernanceService';
import { isCorrectionAuthority, isDirectEditAuthority } from '../../core/roles/capabilities';
import { getRoleNavSections } from '../../../frontend/modules/shared/navigation/roleNavConfig';
import { buildPhotoRelPath, replacedPhotoRelPath, safeName } from '../photo/photoStoragePath';

const section = (over: Partial<EditorSection>): EditorSection => ({
  key: 'k',
  stage: 'S',
  title: 'T',
  entity: 'LAB_PORTION',
  recordId: '7',
  correctionCount: 0,
  fields: [],
  ...over,
});

test('only changed values are sent', () => {
  const s = section({
    fields: [
      { field: 'lr', label: 'LR', value: 26.5, type: 'number' },
      { field: 'fat', label: 'Fat', value: 4, type: 'number' },
      { field: 'note', label: 'Note', value: 'old', type: 'text' },
    ],
  });
  assert.deepEqual(changedFields(s, { lr: '26.50', fat: '4.2', note: 'old' }), { fat: 4.2 });
});

test('a blank number is left out, blank text clears', () => {
  const s = section({
    fields: [
      { field: 'lr', label: 'LR', value: 26.5, type: 'number' },
      { field: 'note', label: 'Note', value: 'old', type: 'text' },
    ],
  });
  assert.deepEqual(changedFields(s, { lr: '', note: '' }), { note: null });
});

test('a locked field is never sent', () => {
  const s = section({ fields: [{ field: 'gross', label: 'Gross', value: 100, type: 'number', lockedReason: 'Final receipt' }] });
  assert.deepEqual(changedFields(s, { gross: '200' }), {});
});

test('date inputs are Pakistan time', () => {
  assert.equal(pakistanInputToIso('2026-11-09T08:00'), '2026-11-09T03:00:00.000Z');
  assert.equal(isoToPakistanInput('2026-11-09T03:00:00.000Z'), '2026-11-09T08:00');
});

test('a portion saves with its version through the portion correction', () => {
  const r = buildEditorSave(section({ version: 3 }), { lr: 27 }, 'wrong entry', 'key');
  assert.equal(r.url, '/api/zmcc/lab/portions/7/correction');
  assert.deepEqual(r.body, { reason: 'wrong entry', version: 3, idempotency_key: 'key', lr: 27 });
});

test('plant QA and lab session results go as a results list', () => {
  const qa = buildEditorSave(section({ entity: 'PLANT_QA', visitId: '9' }), { result_4: 3.9, result_5: 'Negative' }, 'wrong entry', 'key');
  assert.equal(qa.url, '/api/qa/vehicle-visits/9/portions/7/correct-results');
  assert.deepEqual(qa.body.results, [{ test_id: '4', numeric_value: 3.9 }, { test_id: '5', text_value: 'Negative' }]);
  const lab = buildEditorSave(section({ entity: 'LAB_SESSION' }), { remarks: 'x', result_4: 3.9 }, 'wrong entry', 'key');
  assert.deepEqual(lab.body, { reason: 'wrong entry', remarks: 'x', results: [{ test_id: '4', numeric_value: 3.9 }] });
});

test('only the Super Admin edits directly; a Data Executive still resolves tickets', () => {
  assert.equal(isDirectEditAuthority('SUPER_ADMIN'), true);
  assert.equal(isDirectEditAuthority('DATA_EXECUTIVE'), false);
  assert.equal(isCorrectionAuthority('DATA_EXECUTIVE'), true);
});

test('every direct correction route refuses anyone but the Super Admin', () => {
  for (const route of [
    'src/app/api/corrections/records/route.ts',
    'src/app/api/corrections/times/route.ts',
    'src/app/api/corrections/dispatch-portion/route.ts',
    'src/app/api/corrections/photos/[captureId]/route.ts',
    'src/app/api/corrections/photos/route.ts',
    'src/app/api/zmcc/lab/portions/[id]/correction/route.ts',
    'src/app/api/zmcc/lab/sessions/[id]/correction/route.ts',
    'src/app/api/zmcc/mot/collections/[id]/correction/route.ts',
    'src/app/api/zmcc/arrivals/hc/[id]/route.ts',
    'src/app/api/zmcc/arrivals/mot/[id]/route.ts',
    'src/app/api/dispatches/[id]/correction/route.ts',
    'src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/correct-results/route.ts',
  ]) {
    assert.match(readFileSync(route, 'utf8'), /await requireDirectEditAuthority\(req\)/, route);
  }
});

test('each role asks only for its own stages', () => {
  assert.deepEqual(requestableEntities('MOT'), ['MOT_COLLECTION']);
  assert.deepEqual(requestableEntities('WEIGHBRIDGE_OPERATOR'), ['PLANT_RECEPTION']);
  assert.deepEqual(requestableEntities('QA_LAB_ATTENDANT'), ['PLANT_QA']);
  assert.deepEqual(requestableEntities('PHE_OPERATOR'), ['MC_ARRIVAL', 'HC_ARRIVAL']);
  assert.deepEqual(requestableEntities('ZMCC_LAB_ATTENDANT'), ['LAB_PORTION', 'LAB_SESSION', 'DISPATCH']);
  assert.deepEqual(requestableEntities('FINANCE_ACCOUNTS'), []);
  assert.deepEqual(requestableEntities('SUPER_ADMIN'), []);
  assert.deepEqual(requestableEntities(undefined), []);
});

test('a stage raises the matching ticket type', () => {
  assert.equal(ticketModuleFor('MOT_COLLECTION'), 'MOT_SHOP_COLLECTION');
  assert.equal(ticketModuleFor('DISPATCH'), 'VEHICLE_VISIT');
  assert.equal(ticketModuleFor('PLANT_RECEPTION'), 'VEHICLE_VISIT');
  assert.equal(ticketModuleFor('PLANT_QA'), 'PLANT_QA_MEASUREMENT');
  assert.equal(ticketModuleFor('LAB_PORTION'), 'ZMCC_LAB_SESSION');
  assert.equal(ticketModuleFor('MC_ARRIVAL'), 'ZMCC_MC_ARRIVAL');
  assert.equal(ticketModuleFor('HC_ARRIVAL'), 'ZMCC_HC_ARRIVAL');
  assert.equal(ticketModuleFor('GATE_LOG'), null);
});

test('a vehicle ticket splits between dispatch and plant reception', () => {
  const { dispatch, plant } = splitVisitTicketChanges({
    raw_milk_dispatch_note_number: '12',
    vehicle_dispatch_lr: 27,
    token_number: 'T1',
    gross_weight_kg: 100,
    __current: {},
    unknown: 1,
  });
  assert.deepEqual(dispatch, { raw_milk_dispatch_note_number: '12', vehicle_dispatch_lr: 27 });
  assert.deepEqual(plant, { token_number: 'T1', gross_weight_kg: 100 });
});

test('dispatch, plant and QA tickets apply automatically', () => {
  for (const m of ['VEHICLE_VISIT', 'PLANT_QA_MEASUREMENT', 'MOT_SHOP_COLLECTION']) assert.equal(AUTO_APPLY_MODULES.has(m), true, m);
});

test('a lab portion ticket names its session and portion', () => {
  const t = ticketTarget(section({ entity: 'LAB_PORTION', recordId: '7', sessionId: '3', title: 'Portion 2' }));
  assert.equal(t.recordId, '3');
  assert.equal(t.fieldKey('fat'), 'portion:7:fat');
  const { portions } = splitLabTicketChanges({ 'portion:7:fat': 4.2, 'portion:7:result_9': 0.15, 'portion:7:result_10': 'Negative' });
  assert.deepEqual(portions.get('7'), { fat: 4.2, results: [{ test_id: '9', numeric_value: 0.15 }, { test_id: '10', text_value: 'Negative' }] });
});

test('gate and exit times save through the times route', () => {
  const r = buildEditorSave(section({ entity: 'ZMCC_EXIT', recordId: 'MC:5' }), { exit_timestamp: '2026-11-09T03:00:00.000Z' }, 'wrong time', 'key');
  assert.equal(r.url, '/api/corrections/times');
  assert.deepEqual(r.body, { entity: 'ZMCC_EXIT', recordId: 'MC:5', reason: 'wrong time', changes: { exit_timestamp: '2026-11-09T03:00:00.000Z' } });
});

test('roles that enter records see Request correction in the sidebar', () => {
  const nav = (role: string) => getRoleNavSections({ id: '1', username: 'u', name: 'U', role: role as never, department: 'D' }).map((s) => s.href);
  for (const role of REQUESTING_ROLES) assert.ok(nav(role).includes('/request-correction'), role);
  for (const role of ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'FINANCE_ACCOUNTS']) assert.ok(!nav(role).includes('/request-correction'), role);
});

test('photos are stored by Pakistan date, stage, source, record and test', () => {
  const parts = { takenAt: new Date('2026-11-02T20:30:00.000Z'), testingPoint: 'ZMCC_DISPATCH', sourceCode: 'ZMCC HSP', recordRef: 'VV-20261103-0006_P1', testCode: 'LT-000026', testName: 'Fat %', photoKind: 'TEST_RESULT', captureId: 'abc-123' };
  assert.equal(buildPhotoRelPath(parts), '2026/11/03/ZMCC_DISPATCH/ZMCC-HSP/VV-20261103-0006_P1/LT-000026-Fat__abc-123.jpg');
  assert.equal(buildPhotoRelPath({ ...parts, testCode: null, testName: null, photoKind: 'LAB_REPORT', sourceCode: null }), '2026/11/03/ZMCC_DISPATCH/NO-SOURCE/VV-20261103-0006_P1/LAB-REPORT__abc-123.jpg');
  assert.match(replacedPhotoRelPath(parts, new Date('2026-11-03T05:00:00.000Z')), /\/replaced\/LT-000026-Fat__abc-123__replaced-20261103100000\.jpg$/);
  assert.equal(safeName('../../etc', 'X'), 'etc');
  // A photo added later still sits with its record.
  assert.match(buildPhotoRelPath({ ...parts, takenAt: new Date('2026-11-11T05:00:00.000Z'), recordAt: new Date('2026-11-02T20:30:00.000Z') }), /^2026\/11\/03\//);
});

test('a resubmitted dispatch moves its photos to the new portion with the same number', () => {
  const src = readFileSync('src/app/api/dispatches/route.ts', 'utf8');
  assert.match(src, /select: \{ id: true, portion_number: true \}/);
  assert.match(src, /capturedPhoto\.updateMany\(\{ where: \{ entity_type: 'dispatch_portion', entity_id: previous\.id \}, data: \{ entity_id: portion\.id \} \}\)/);
});

test('a photo stamp never says unknown', async () => {
  const { isStampIdentityKnown, stampEmployeeCode, stampRoleLabel } = await import('../../../lib/photo/stampIdentity');
  assert.equal(stampEmployeeCode(null), '');
  assert.equal(stampEmployeeCode({ username: 'ali', employee_code: 'E-17' }), 'E-17');
  assert.equal(stampRoleLabel({ role: 'ZMCC_LAB_ATTENDANT' }) === 'ZMCC_LAB_ATTENDANT', false);
  assert.equal(isStampIdentityKnown('unknown'), false);
  assert.equal(isStampIdentityKnown(''), false);
  assert.equal(isStampIdentityKnown('E-17'), true);
});
