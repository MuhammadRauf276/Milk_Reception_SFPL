'use client';

import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, FileCheck2, X } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass } from '../shared/FormDrawer';
import type { LabTestOption, UnifiedStageItem } from './types';

type WarningTrigger = 'BOTH' | 'ABOVE_MAX' | 'BELOW_MIN' | 'NONE';

const WARNING_OPTIONS: Array<{ value: WarningTrigger; label: string }> = [
  { value: 'ABOVE_MAX', label: 'High Side Only (Above Max)' },
  { value: 'BELOW_MIN', label: 'Low Side Only (Below Min)' },
  { value: 'BOTH', label: 'Both Sides (± Offset)' },
  { value: 'NONE', label: 'No Warning (Strict Pass/Fail)' },
];

function Seg({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Array<{ value: string; label: string; active: string }>;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-11 flex-1 rounded-lg border px-2.5 font-bold transition ${
            value === o.value ? o.active : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function qualitativeOptions(item: UnifiedStageItem): LabTestOption[] {
  if (Array.isArray(item.labTest.resultOptions) && item.labTest.resultOptions.length > 0) return item.labTest.resultOptions;
  return [
    { value: 'PASS', label: 'Pass', isPassing: true, outcome: 'PASS' },
    { value: 'FAIL', label: 'Fail', isPassing: false, outcome: 'FAIL' },
    { value: 'NEGATIVE', label: 'Negative', isPassing: true, outcome: 'PASS' },
    { value: 'POSITIVE', label: 'Positive', isPassing: false, outcome: 'FAIL' },
    { value: 'NORMAL', label: 'Normal', isPassing: true, outcome: 'PASS' },
    { value: 'ABNORMAL', label: 'Abnormal', isPassing: false, outcome: 'FAIL' },
  ];
}

interface Props {
  item: UnifiedStageItem;
  stage: string;
  stageLabel: string;
  isGlobalStage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Bottom-sheet editor for one test's stage policy and acceptance rule. */
export function RuleEditorDrawer({ item, stage, stageLabel, isGlobalStage, onClose, onSaved }: Props) {
  const isNumeric = item.labTest.resultType === 'NUMERIC' || item.labTest.resultType === 'CALCULATED';
  const initialRecordOnly = Boolean(item.rule?.isRecordOnly || item.rule?.warningTrigger === 'RECORD_ONLY');
  const wt = item.rule?.warningTrigger;
  const initialTrigger: WarningTrigger =
    wt === 'ABOVE_MAX' || wt === 'BELOW_MIN' || wt === 'BOTH' || wt === 'NONE'
      ? wt
      : item.labTest.testCode.includes('TEMP') ||
        item.labTest.testCode.includes('ACID') ||
        item.labTest.testName.toLowerCase().includes('temperature') ||
        item.labTest.testName.toLowerCase().includes('acidity')
      ? 'ABOVE_MAX'
      : 'BOTH';
  const opts = Array.isArray(item.labTest.resultOptions) ? item.labTest.resultOptions : [];

  const [active, setActive] = useState(item.policy ? item.policy.isActive : true);
  const [required, setRequired] = useState(item.policy ? item.policy.isRequired : true);
  const [photoRequired, setPhotoRequired] = useState(Boolean(item.policy?.isPhotoRequired ?? item.labTest.isPhotoRequired));
  const [recordOnly, setRecordOnly] = useState(initialRecordOnly);
  const [ruleCategory, setRuleCategory] = useState<'RELEASE' | 'MONITORING'>(item.rule?.ruleCategory === 'MONITORING' ? 'MONITORING' : 'RELEASE');
  const [min, setMin] = useState(item.rule?.minValue != null ? String(item.rule.minValue) : '');
  const [max, setMax] = useState(item.rule?.maxValue != null ? String(item.rule.maxValue) : '');
  const [trigger, setTrigger] = useState<WarningTrigger>(initialTrigger);
  const [offset, setOffset] = useState(item.rule?.warningOffset != null ? String(item.rule.warningOffset) : '');
  const [acceptable, setAcceptable] = useState(
    item.rule?.acceptableOption || opts.find((o) => o.isPassing === true || o.outcome === 'PASS')?.value || opts[0]?.value || 'PASS'
  );
  const [reason, setReason] = useState(`Configured ${item.labTest.testName} for ${stageLabel || stage}`);
  const [error, setError] = useState<string | null>(null);

  const qualOptions = useMemo(() => qualitativeOptions(item), [item]);

  const preview = useMemo(() => {
    if (recordOnly) {
      return {
        isRecordOnly: true,
        passText: 'Record Only',
        warnText: null as string | null,
        rejectText: 'No limits enforced (Results recorded for informational tracking only)',
      };
    }
    const mn = min.trim() !== '' ? Number(min) : null;
    const mx = max.trim() !== '' ? Number(max) : null;
    const off = offset.trim() !== '' && trigger !== 'NONE' ? Number(offset) : 0;
    const unit = item.labTest.unit ? ` ${item.labTest.unit}` : '';
    if (mn === null && mx === null) return null;

    let passText = '';
    if (mn !== null && mx !== null) passText = `${mn} to ${mx}${unit}`;
    else if (mn !== null) passText = `≥ ${mn}${unit}`;
    else if (mx !== null) passText = `≤ ${mx}${unit}`;

    let warnText: string | null = null;
    let rejectText = '';
    if (off > 0 && trigger !== 'NONE') {
      const lower = mn !== null ? (mn >= 0 ? Math.max(0, mn - off) : mn - off) : null;
      const upper = mx !== null ? mx + off : null;
      if (trigger === 'ABOVE_MAX' && mx !== null && upper !== null) {
        warnText = `Above max: ${mx} to ${upper}${unit}`;
        rejectText = `${mn !== null ? `< ${mn} or ` : ''}> ${upper}${unit}`;
      } else if (trigger === 'BELOW_MIN' && mn !== null && lower !== null) {
        warnText = `Below min: ${lower} to ${mn}${unit}`;
        rejectText = `< ${lower}${unit}${mx !== null ? ` or > ${mx}` : ''}`;
      } else if (trigger === 'BOTH') {
        const parts: string[] = [];
        if (mn !== null && lower !== null && lower < mn) parts.push(`[${lower} to ${mn}]`);
        if (mx !== null && upper !== null) parts.push(`[${mx} to ${upper}]`);
        warnText = `${parts.join(' and ')}${unit}`;
        const rej: string[] = [];
        if (mn !== null && lower !== null) rej.push(`< ${lower}`);
        if (mx !== null && upper !== null) rej.push(`> ${upper}`);
        rejectText = `${rej.join(' or ')}${unit}`;
      }
    } else if (mn !== null && mx !== null) rejectText = `< ${mn} or > ${mx}${unit}`;
    else if (mn !== null) rejectText = `< ${mn}${unit}`;
    else if (mx !== null) rejectText = `> ${mx}${unit}`;

    return { isRecordOnly: false, passText, warnText, rejectText };
  }, [recordOnly, min, max, offset, trigger, item.labTest.unit]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/super-admin/stage-policies-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
  const busy = mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!recordOnly && isNumeric && min.trim() !== '' && max.trim() !== '' && Number(min) > Number(max)) {
      return setError('Minimum allowable limit cannot be greater than Maximum allowable limit.');
    }

    mutation.mutate(
      {
        labTestId: item.labTest.id,
        testingPoint: stage,
        isActive: isGlobalStage ? true : active,
        isRequired: isGlobalStage ? true : required,
        isPhotoRequired: photoRequired,
        displayOrder: item.policy?.displayOrder ?? 1,
        ruleCategory: recordOnly ? 'MONITORING' : ruleCategory,
        minValue: !recordOnly && isNumeric && min.trim() !== '' ? Number(min) : null,
        maxValue: !recordOnly && isNumeric && max.trim() !== '' ? Number(max) : null,
        warningOffset: !recordOnly && isNumeric && offset.trim() !== '' && trigger !== 'NONE' ? Number(offset) : null,
        warningTrigger: recordOnly ? 'RECORD_ONLY' : trigger,
        acceptableOption: !recordOnly && !isNumeric ? acceptable : null,
        reason: reason.trim() || `Configured ${item.labTest.testName}`,
      },
      {
        onSuccess: () => onSaved(`Saved policy & specs for ${item.labTest.testName} (${item.labTest.testCode}).`),
        onError: (err) => setError(getErrorMessage(err) || 'Failed to save stage policy and rule.'),
      }
    );
  };

  const unitSuffix = item.labTest.unit ? `(${item.labTest.unit})` : '';
  const acceptableOptions = qualOptions.map((o) => ({
    value: o.value,
    label: `${o.label} (${o.value}) ${o.outcome === 'WARNING' ? '(Warning)' : o.isPassing ? '(Pass)' : '(Fail)'}`,
    keywords: o.value,
  }));

  return (
    <FormDrawer
      open
      onClose={onClose}
      busy={busy}
      error={error}
      title={
        <span className="block">
          {isGlobalStage ? 'Universal Baseline Spec' : stageLabel}: {item.labTest.testName}
          <span className="mt-0.5 block font-mono text-[11px] font-normal text-slate-500">
            {item.labTest.testCode} · {item.labTest.resultType}
            {item.labTest.unit ? ` (${item.labTest.unit})` : ''}
          </span>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {!isGlobalStage && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="border-b border-slate-200/80 pb-2 text-xs font-bold text-slate-800">Stage Form Configuration ({stageLabel})</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block font-bold text-slate-700">Visibility on Form</span>
                <Seg
                  label="Visibility on form"
                  value={active ? 'a' : 'h'}
                  onChange={(v) => setActive(v === 'a')}
                  options={[
                    { value: 'a', label: 'Active', active: 'border-emerald-600 bg-emerald-600 text-white' },
                    { value: 'h', label: 'Hidden', active: 'border-slate-700 bg-slate-700 text-white' },
                  ]}
                />
              </div>
              <div>
                <span className="mb-1.5 block font-bold text-slate-700">Entry Requirement</span>
                <Seg
                  label="Entry requirement"
                  value={required ? 'c' : 'o'}
                  onChange={(v) => setRequired(v === 'c')}
                  options={[
                    { value: 'c', label: 'Compulsory', active: 'border-primary bg-primary text-white' },
                    { value: 'o', label: 'Optional', active: 'border-slate-700 bg-slate-700 text-white' },
                  ]}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 pt-3">
              <div>
                <div className="font-bold text-slate-800">Photo Evidence Required</div>
                <div className="text-[11px] text-slate-500">Chemist must photograph physical tester reading</div>
              </div>
              <button
                type="button"
                aria-pressed={photoRequired}
                onClick={() => setPhotoRequired((p) => !p)}
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-bold transition-colors ${
                  photoRequired ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Camera className="h-3.5 w-3.5" />
                <span>{photoRequired ? 'Photo Required' : 'No Photo'}</span>
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
            <div className="text-xs font-bold text-slate-800">Quality Acceptance Rule &amp; Limits</div>
            {!isGlobalStage && (
              <label className="flex min-h-11 cursor-pointer select-none items-center gap-1.5 font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={recordOnly}
                  onChange={(e) => setRecordOnly(e.target.checked)}
                  className="size-5 rounded border-slate-300 text-primary"
                />
                <span>Record Only (No Pass/Fail Rule)</span>
              </label>
            )}
          </div>

          {recordOnly ? (
            <div className="space-y-1 rounded-lg bg-slate-100 p-3 text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-slate-900">
                <FileCheck2 className="h-4 w-4 text-slate-600" />
                <span>Confirmed: Record Only Test</span>
              </div>
              <p className="text-[11px]">
                This test is collected for recording and tracking only. No limits or pass/fail evaluation will be applied by the system.
              </p>
            </div>
          ) : (
            <>
              <div>
                <span className="mb-1.5 block font-bold text-slate-700">Rule Enforcement Severity</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={ruleCategory === 'RELEASE'}
                    onClick={() => setRuleCategory('RELEASE')}
                    className={`min-h-11 rounded-xl border p-3 text-left transition-all ${
                      ruleCategory === 'RELEASE' ? 'border-rose-700 bg-rose-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-rose-50/40'
                    }`}
                  >
                    <div className="text-sm font-extrabold">Must Pass (Hold)</div>
                    <div className={`mt-0.5 text-[11px] ${ruleCategory === 'RELEASE' ? 'text-rose-100' : 'text-slate-500'}`}>
                      Blocks Reception &amp; Requires QA Approval
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-pressed={ruleCategory === 'MONITORING'}
                    onClick={() => setRuleCategory('MONITORING')}
                    className={`min-h-11 rounded-xl border p-3 text-left transition-all ${
                      ruleCategory === 'MONITORING' ? 'border-amber-600 bg-amber-500 text-slate-950' : 'border-slate-300 bg-white text-slate-800 hover:bg-amber-50/40'
                    }`}
                  >
                    <div className="text-sm font-extrabold">Warning Only</div>
                    <div className={`mt-0.5 text-[11px] ${ruleCategory === 'MONITORING' ? 'text-slate-900' : 'text-slate-500'}`}>
                      Yellow Alert Notice (Does Not Block Intake)
                    </div>
                  </button>
                </div>
              </div>

              {isNumeric ? (
                <div className="space-y-3 pt-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">Minimum Allowable {unitSuffix}</label>
                      <input type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} placeholder="e.g. 0.0" className={`${fieldInputClass} font-mono font-bold`} />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">Maximum Allowable {unitSuffix}</label>
                      <input type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} placeholder="e.g. 10.0" className={`${fieldInputClass} font-mono font-bold`} />
                    </div>
                  </div>

                  <div>
                    <span className="mb-1 block font-semibold text-slate-700">Warning Applies To</span>
                    <div role="group" aria-label="Warning applies to" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {WARNING_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={trigger === o.value}
                          onClick={() => setTrigger(o.value)}
                          className={`min-h-11 rounded-lg border px-2 py-1 text-[11px] font-bold leading-tight ${
                            trigger === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">Warning Tolerance Margin ({item.labTest.unit || 'units'})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={trigger === 'NONE'}
                      value={offset}
                      onChange={(e) => setOffset(e.target.value)}
                      placeholder={trigger === 'NONE' ? 'Disabled' : 'e.g. 2.0'}
                      className={`${fieldInputClass} font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                  </div>

                  {preview && (
                    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-[11px]">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>Passing Range: {preview.passText}</span>
                      </div>
                      {preview.warnText && (
                        <div className="flex items-center gap-1.5 font-bold text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span>Warning Range: {preview.warnText}</span>
                        </div>
                      )}
                      {preview.rejectText && (
                        <div className="flex items-center gap-1.5 font-semibold text-rose-700">
                          <X className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                          <span>Rejection: {preview.rejectText}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 pt-2">
                  <label className="block font-semibold text-slate-700">Standard Acceptable Option</label>
                  {acceptableOptions.length <= 8 ? (
                    <div role="group" aria-label="Standard acceptable option" className="grid gap-2 sm:grid-cols-2">
                      {acceptableOptions.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={acceptable === o.value}
                          onClick={() => setAcceptable(o.value)}
                          className={`min-h-11 rounded-lg border px-3 py-1.5 text-left text-xs font-bold ${
                            acceptable === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Combobox options={acceptableOptions} value={acceptable} onValueChange={setAcceptable} searchPlaceholder="Search options" />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block font-bold text-slate-700">Reason for Update (Audit Trail)</label>
          <input
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Configured temperature limits"
            className={fieldInputClass}
          />
        </div>

        <DrawerActions busy={busy} onCancel={onClose} submitLabel="Save Rule & Policy" busyLabel="Saving…" />
      </form>
    </FormDrawer>
  );
}
