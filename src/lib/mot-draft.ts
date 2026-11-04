// Maps the MOT shop form's typed values to the flat draft shape the server keeps, and back.
// Only typed text goes in. Pictures are captured on the phone and queued for upload, so they stay there.
import type { MotTestValue } from '@/frontend/modules/mot/MotShopTestsStep';
import type { ServerDraftContent } from '@/frontend/hooks/useServerDraft';

export interface MotShopFormFields {
  shopRmrNumber: string;
  quantity: string;
  unit: 'LITER' | 'KG';
  lr: string;
  fat: string;
  notes: string;
  selectedSourceId: string;
  testValues: Record<string, MotTestValue>;
}

export function motDraftFromForm(f: MotShopFormFields): ServerDraftContent {
  const values: Record<string, string> = {};
  const put = (key: string, v: string) => {
    if (v.trim() !== '') values[key] = v;
  };
  put('rmr', f.shopRmrNumber);
  put('qty', f.quantity);
  put('lr', f.lr);
  put('fat', f.fat);
  put('source', f.selectedSourceId);
  for (const [testId, v] of Object.entries(f.testValues)) {
    put(`t:${testId}:v`, v.value);
    put(`t:${testId}:x`, v.text);
  }
  if (f.quantity.trim() !== '') values.unit = f.unit;
  return { values, photos: {}, remarks: f.notes };
}

/**
 * Puts draft values into the form. On first open ('load') only empty fields are filled, so anything already
 * on this device stays. After another device saved ('stale') the draft wins, but an empty value never clears.
 */
export function applyMotDraft(current: MotShopFormFields, content: ServerDraftContent, mode: 'load' | 'stale'): MotShopFormFields {
  const take = (cur: string, incoming: string | undefined) =>
    incoming === undefined || incoming.trim() === '' || (mode === 'load' && cur.trim() !== '') ? cur : incoming;
  const testValues: Record<string, MotTestValue> = { ...current.testValues };
  for (const [key, value] of Object.entries(content.values)) {
    const m = /^t:(.+):([vx])$/.exec(key);
    if (!m) continue;
    const cur = testValues[m[1]] ?? { value: '', text: '' };
    testValues[m[1]] = m[2] === 'v' ? { ...cur, value: take(cur.value, value) } : { ...cur, text: take(cur.text, value) };
  }
  const unit = content.values.unit === 'KG' || content.values.unit === 'LITER' ? content.values.unit : current.unit;
  return {
    shopRmrNumber: take(current.shopRmrNumber, content.values.rmr),
    quantity: take(current.quantity, content.values.qty),
    unit: mode === 'load' && current.quantity.trim() !== '' ? current.unit : unit,
    lr: take(current.lr, content.values.lr),
    fat: take(current.fat, content.values.fat),
    notes: take(current.notes, content.remarks),
    selectedSourceId: take(current.selectedSourceId, content.values.source),
    testValues,
  };
}
