// Maps the dispatch form's typed values to the flat draft shape the server keeps, and back.
// Only typed text goes in: quantity, seal, test values and remarks. Photos are captured on the phone and
// uploaded after the dispatch is saved, so they stay on that phone and are not part of a draft.
import type { PortionFormState, TestResultState } from '@/frontend/modules/forms/components/DispatchPortionEditor';
import type { ServerDraftContent } from '@/frontend/hooks/useServerDraft';

export interface DispatchDraftExtras {
  vehicleNumber: string;
  rawMilkDispatchNoteNumber: string;
  remarks: string;
}

const EXTRA_KEYS = { vehicleNumber: 'v:vehicle', note: 'v:note' } as const;

export function dispatchDraftFromForm(portions: PortionFormState[], extras: DispatchDraftExtras): ServerDraftContent {
  const values: Record<string, string> = {};
  const put = (key: string, v: string) => {
    if (v.trim() !== '') values[key] = v;
  };
  put(EXTRA_KEYS.vehicleNumber, extras.vehicleNumber);
  put(EXTRA_KEYS.note, extras.rawMilkDispatchNoteNumber);
  for (const p of portions) {
    const n = p.portionNumber;
    put(`p${n}:qty`, p.quantity.value);
    put(`p${n}:seal`, p.sealNumber);
    for (const [testId, r] of Object.entries(p.results)) {
      put(`p${n}:${testId}:n`, r.numericValue);
      put(`p${n}:${testId}:t`, r.textValue);
    }
  }
  return { values, photos: {}, remarks: extras.remarks };
}

const PORTION_KEY = /^p(\d{1,3}):(.+)$/;

/** Highest portion number the draft mentions (0 when it has none). */
export function draftPortionCount(content: ServerDraftContent): number {
  let max = 0;
  for (const k of Object.keys(content.values)) {
    const m = PORTION_KEY.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

const emptyResult = (): TestResultState => ({ numericValue: '', textValue: '', performanceStatus: 'PERFORMED', notPerformedReason: '' });

/**
 * Puts draft values into the form's portions. When the form first opens ('load') only empty fields are filled,
 * so anything already typed on this device stays. After another device saved ('stale') the draft's values win,
 * but an empty draft value never clears a typed one.
 */
export function applyDraftToPortions(
  portions: PortionFormState[],
  content: ServerDraftContent,
  mode: 'load' | 'stale',
  makeFresh: (portionNumber: number) => PortionFormState,
): PortionFormState[] {
  const wanted = draftPortionCount(content);
  const next = portions.map((p) => ({ ...p, quantity: { ...p.quantity }, results: { ...p.results } }));
  while (next.length < wanted) next.push(makeFresh(next.length + 1));

  const take = (current: string, incoming: string | undefined): string => {
    if (incoming === undefined || incoming.trim() === '') return current;
    if (mode === 'load' && current.trim() !== '') return current;
    return incoming;
  };

  for (const [key, value] of Object.entries(content.values)) {
    const m = PORTION_KEY.exec(key);
    if (!m) continue;
    const portion = next.find((p) => p.portionNumber === Number(m[1]));
    if (!portion) continue;
    const rest = m[2];
    if (rest === 'qty') portion.quantity.value = take(portion.quantity.value, value);
    else if (rest === 'seal') portion.sealNumber = take(portion.sealNumber, value);
    else {
      const t = /^(.+):([nt])$/.exec(rest);
      if (!t) continue;
      const cur = portion.results[t[1]] ?? emptyResult();
      portion.results[t[1]] =
        t[2] === 'n' ? { ...cur, numericValue: take(cur.numericValue, value) } : { ...cur, textValue: take(cur.textValue, value) };
    }
  }
  return next;
}

export function applyDraftToExtras(
  current: DispatchDraftExtras,
  content: ServerDraftContent,
  mode: 'load' | 'stale',
): DispatchDraftExtras {
  const take = (cur: string, incoming: string | undefined) =>
    incoming === undefined || incoming.trim() === '' || (mode === 'load' && cur.trim() !== '') ? cur : incoming;
  return {
    vehicleNumber: take(current.vehicleNumber, content.values[EXTRA_KEYS.vehicleNumber]),
    rawMilkDispatchNoteNumber: take(current.rawMilkDispatchNoteNumber, content.values[EXTRA_KEYS.note]),
    remarks: take(current.remarks, content.remarks),
  };
}
