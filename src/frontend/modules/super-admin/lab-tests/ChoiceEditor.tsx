'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface LabTestResultOption {
  value: string;
  label: string;
  isPassing: boolean | null;
  outcome?: 'PASS' | 'WARNING' | 'FAIL';
}

export const QUALITATIVE_PRESETS: Array<{ label: string; options: LabTestResultOption[] }> = [
  {
    label: 'OK / Not OK',
    options: [
      { value: 'OK', label: 'OK', isPassing: true, outcome: 'PASS' },
      { value: 'NOT_OK', label: 'Not OK', isPassing: false, outcome: 'FAIL' },
    ],
  },
  {
    label: 'Negative / Positive',
    options: [
      { value: 'NEGATIVE', label: 'Negative', isPassing: true, outcome: 'PASS' },
      { value: 'POSITIVE', label: 'Positive', isPassing: false, outcome: 'FAIL' },
    ],
  },
  {
    label: 'Pass / Fail',
    options: [
      { value: 'PASS', label: 'Pass', isPassing: true, outcome: 'PASS' },
      { value: 'FAIL', label: 'Fail', isPassing: false, outcome: 'FAIL' },
    ],
  },
  {
    label: 'Normal / Slight / Severe',
    options: [
      { value: 'NORMAL', label: 'Normal', isPassing: true, outcome: 'PASS' },
      { value: 'SLIGHT', label: 'Slight (Warning)', isPassing: null, outcome: 'WARNING' },
      { value: 'SEVERE', label: 'Severe / Foul (Fail)', isPassing: false, outcome: 'FAIL' },
    ],
  },
  {
    label: 'Clean / Trace / Dirty',
    options: [
      { value: 'CLEAN', label: 'Clean', isPassing: true, outcome: 'PASS' },
      { value: 'TRACE', label: 'Trace (Warning)', isPassing: null, outcome: 'WARNING' },
      { value: 'DIRTY', label: 'Dirty / Clotted (Fail)', isPassing: false, outcome: 'FAIL' },
    ],
  },
];

export const CATEGORICAL_TYPES = ['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'];

const normalizeOptionCode = (val: string) => val.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

const OUTCOMES: Array<{ value: 'PASS' | 'WARNING' | 'FAIL'; label: string; cls: string }> = [
  { value: 'PASS', label: 'Pass', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  { value: 'WARNING', label: 'Warning', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  { value: 'FAIL', label: 'Fail', cls: 'border-rose-300 bg-rose-50 text-rose-800' },
];

const optionOutcome = (o: LabTestResultOption) => o.outcome || (o.isPassing === true ? 'PASS' : o.isPassing === false ? 'FAIL' : 'WARNING');

/** Editable list of categorical result choices with a 3-tier verdict (segmented, 44px targets). */
export function ChoiceEditor({ options, onChange }: { options: LabTestResultOption[]; onChange: (next: LabTestResultOption[]) => void }) {
  const update = (idx: number, patch: Partial<LabTestResultOption>) =>
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">Test Choices</span>
          <InfoTip text="Pick a preset or customize options with a 3-tier verdict (Pass, Warning, Fail)." />
        </div>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...options,
              { value: `OPT_${options.length + 1}`, label: `Option ${options.length + 1}`, isPassing: true, outcome: 'PASS' },
            ])
          }
          className="flex min-h-11 shrink-0 items-center gap-1 px-2 text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Choice</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        <span className="text-[11px] font-semibold text-slate-600">Presets:</span>
        {QUALITATIVE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(JSON.parse(JSON.stringify(p.options)))}
            className="min-h-11 rounded bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {options.map((opt, idx) => {
          const current = optionOutcome(opt);
          return (
            <div key={idx} className="space-y-2 rounded-lg border border-border bg-card p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  required
                  placeholder="Code (e.g. OK)"
                  aria-label={`Choice ${idx + 1} code`}
                  value={opt.value}
                  onChange={(e) => update(idx, { value: normalizeOptionCode(e.target.value) })}
                  className="h-11 w-2/5 rounded border border-slate-300 px-2 font-mono text-xs font-semibold uppercase"
                />
                <input
                  type="text"
                  required
                  placeholder="Display Label"
                  aria-label={`Choice ${idx + 1} label`}
                  value={opt.label}
                  onChange={(e) => update(idx, { label: e.target.value })}
                  className="h-11 flex-1 rounded border border-slate-300 px-2 text-xs"
                />
                <button
                  type="button"
                  aria-label={`Remove choice ${idx + 1}`}
                  onClick={() => onChange(options.filter((_, i) => i !== idx))}
                  disabled={options.length <= 2}
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-rose-600 hover:text-rose-800 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div role="group" aria-label={`Choice ${idx + 1} verdict`} className="flex gap-1">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={current === o.value}
                    onClick={() => update(idx, { outcome: o.value, isPassing: o.value === 'PASS' ? true : o.value === 'FAIL' ? false : null })}
                    className={`h-11 flex-1 rounded border text-xs font-bold ${
                      current === o.value ? o.cls : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
