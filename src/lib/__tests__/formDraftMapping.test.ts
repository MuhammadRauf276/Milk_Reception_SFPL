import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDraftToExtras, applyDraftToPortions, dispatchDraftFromForm, draftPortionCount } from '../dispatch-draft';
import { applyMotDraft, motDraftFromForm, type MotShopFormFields } from '../mot-draft';
import type { PortionFormState } from '@/frontend/modules/forms/components/DispatchPortionEditor';

const portion = (n: number, over: Partial<PortionFormState> = {}): PortionFormState => ({
  clientId: `c${n}`,
  portionNumber: n,
  quantity: { value: '', unit: 'KG', basis: 'MEASURED' },
  sealNumber: '',
  results: {},
  photos: {},
  isSaved: false,
  ...over,
});
const fresh = (n: number) => portion(n);
const extras = { vehicleNumber: '', rawMilkDispatchNoteNumber: '', remarks: '' };

test('dispatch draft holds typed text only, empty fields are left out, photos never', () => {
  const p = portion(1, {
    quantity: { value: '8500', unit: 'KG', basis: 'MEASURED' },
    sealNumber: 'S-1',
    results: { '7': { numericValue: '26.1', textValue: '', performanceStatus: 'PERFORMED', notPerformedReason: '' } },
  });
  const d = dispatchDraftFromForm([p], { ...extras, vehicleNumber: 'ABC-1' });
  assert.deepEqual(d.values, { 'v:vehicle': 'ABC-1', 'p1:qty': '8500', 'p1:seal': 'S-1', 'p1:7:n': '26.1' });
  assert.deepEqual(d.photos, {});
});

test('dispatch draft restores on a second device and adds the missing portions', () => {
  const content = { values: { 'p1:qty': '100', 'p2:qty': '200', 'p2:seal': 'S-2', 'p2:7:t': 'Negative' }, photos: {}, remarks: 'note' };
  assert.equal(draftPortionCount(content), 2);
  const out = applyDraftToPortions([portion(1)], content, 'load', fresh);
  assert.equal(out.length, 2);
  assert.equal(out[1].portionNumber, 2);
  assert.equal(out[1].quantity.value, '200');
  assert.equal(out[1].sealNumber, 'S-2');
  assert.equal(out[1].results['7'].textValue, 'Negative');
  assert.equal(applyDraftToExtras(extras, content, 'load').remarks, 'note');
});

test('on first open a draft never overwrites what is already typed; a newer draft does, but never with empty', () => {
  const typed = portion(1, { quantity: { value: '50', unit: 'KG', basis: 'MEASURED' } });
  const content = { values: { 'p1:qty': '100', 'p1:seal': '' }, photos: {}, remarks: '' };
  assert.equal(applyDraftToPortions([typed], content, 'load', fresh)[0].quantity.value, '50');
  assert.equal(applyDraftToPortions([typed], content, 'stale', fresh)[0].quantity.value, '100');
  const emptyDraft = { values: { 'p1:qty': ' ' }, photos: {}, remarks: '' };
  assert.equal(applyDraftToPortions([typed], emptyDraft, 'stale', fresh)[0].quantity.value, '50');
});

test('input portions are not mutated', () => {
  const p = portion(1);
  applyDraftToPortions([p], { values: { 'p1:qty': '9' }, photos: {}, remarks: '' }, 'stale', fresh);
  assert.equal(p.quantity.value, '');
});

const mot = (over: Partial<MotShopFormFields> = {}): MotShopFormFields => ({
  shopRmrNumber: '',
  quantity: '',
  unit: 'LITER',
  lr: '',
  fat: '',
  notes: '',
  selectedSourceId: '',
  testValues: {},
  ...over,
});

test('MOT draft carries typed text only and round-trips', () => {
  const d = motDraftFromForm(mot({ quantity: '120', unit: 'KG', lr: '28', testValues: { '9': { value: '0.1', text: 'Negative' } } }));
  assert.deepEqual(d.values, { qty: '120', lr: '28', 't:9:v': '0.1', 't:9:x': 'Negative', unit: 'KG' });
  const back = applyMotDraft(mot(), d, 'load');
  assert.equal(back.quantity, '120');
  assert.equal(back.unit, 'KG');
  assert.deepEqual(back.testValues['9'], { value: '0.1', text: 'Negative' });
});

test('MOT draft keeps values typed on this device on first open and never clears with empty', () => {
  const d = { values: { qty: '120', lr: '28' }, photos: {}, remarks: '' };
  const local = mot({ quantity: '75' });
  assert.equal(applyMotDraft(local, d, 'load').quantity, '75');
  assert.equal(applyMotDraft(local, d, 'load').lr, '28');
  assert.equal(applyMotDraft(local, d, 'stale').quantity, '120');
  assert.equal(applyMotDraft(mot({ lr: '30' }), { values: { lr: '' }, photos: {}, remarks: '' }, 'stale').lr, '30');
});
