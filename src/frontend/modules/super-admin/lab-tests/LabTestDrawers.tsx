'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { mapScopeCheckboxes } from '@/lib/validations/labTest';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';
import { CATEGORICAL_TYPES, ChoiceEditor, QUALITATIVE_PRESETS, type LabTestResultOption } from './ChoiceEditor';

export interface LabTest {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  testScope: string;
  assignedStages?: string[];
  isRequired: boolean;
  isActive: boolean;
  isPhotoRequired?: boolean;
  displayOrder: number;
  historicalResultsCount: number;
  resultOptions: LabTestResultOption[] | null;
  minValue?: number | null;
  maxValue?: number | null;
  acceptableOption?: string | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const STAGE_OPTIONS = [
  { id: 'MOT_SHOP', label: 'MOT Shop', desc: 'Shop Intake' },
  { id: 'ZMCC_LAB_MC', label: 'ZMCC MC', desc: 'Milk Collection (route) intake' },
  { id: 'ZMCC_LAB_HC', label: 'ZMCC HC', desc: 'Direct supplier (HC) intake' },
  { id: 'DISPATCH', label: 'Dispatch', desc: 'Tanker Dispatch' },
  { id: 'PLANT_QA', label: 'Plant QA', desc: 'Plant Reception' },
] as const;

const RESULT_TYPES = [
  { value: 'QUALITATIVE', label: 'Choice list' },
  { value: 'NUMERIC', label: 'Number' },
  { value: 'TEXT', label: 'Text' },
  { value: 'OK_NOT_OK', label: 'OK / Not OK' },
  { value: 'POSITIVE_NEGATIVE', label: 'Positive / Negative' },
  { value: 'CALCULATED', label: 'Calculated' },
];

const defaultOptions = (): LabTestResultOption[] => [
  { value: 'PASS', label: 'Pass', isPassing: true },
  { value: 'FAIL', label: 'Fail', isPassing: false },
];

interface FormProps {
  /** null = create */
  test: LabTest | null;
  nextDisplayOrder: number;
  initialStage?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** One bottom sheet for creating and editing a lab test (metadata, stage assignments, SOP rules, choices). */
export function LabTestFormDrawer({ test, nextDisplayOrder, initialStage, onClose, onSaved }: FormProps) {
  const isEdit = !!test;
  const [name, setName] = useState(test?.testName || '');
  const [resultType, setResultType] = useState(test?.resultType || 'QUALITATIVE');
  const [unit, setUnit] = useState(test?.unit || '');

  // Initialize assigned stages
  const initialStages = (): string[] => {
    if (test?.assignedStages && Array.isArray(test.assignedStages)) {
      return [...test.assignedStages];
    }
    if (initialStage && STAGE_OPTIONS.some((s) => s.id === initialStage)) {
      return [initialStage];
    }
    if (isEdit && test?.testScope) {
      const list: string[] = [];
      const sc = test.testScope;
      if (sc === 'DISPATCH' || sc === 'BOTH' || sc === 'ALL') list.push('DISPATCH');
      if (sc === 'PLANT' || sc === 'BOTH' || sc === 'ALL') list.push('PLANT_QA');
      if (sc === 'ZMCC' || sc === 'ALL') {
        list.push('ZMCC_LAB_MC');
        list.push('ZMCC_LAB_HC');
      }
      if (sc === 'MOT_SHOP' || sc === 'MOT' || sc === 'ALL') list.push('MOT_SHOP');
      return list;
    }
    return ['DISPATCH', 'PLANT_QA'];
  };

  const [assignedStages, setAssignedStages] = useState<string[]>(initialStages);
  const [photoRequired, setPhotoRequired] = useState(Boolean(test?.isPhotoRequired));
  const [displayOrder, setDisplayOrder] = useState(test ? test.displayOrder : nextDisplayOrder);
  const [minValue, setMinValue] = useState<string>(test?.minValue !== undefined && test?.minValue !== null ? String(test.minValue) : '');
  const [maxValue, setMaxValue] = useState<string>(test?.maxValue !== undefined && test?.maxValue !== null ? String(test.maxValue) : '');
  const [options, setOptions] = useState<LabTestResultOption[]>(
    test?.resultOptions ? JSON.parse(JSON.stringify(test.resultOptions)) : isEdit ? [] : defaultOptions()
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchJson<{ labTest: { testCode: string; testName: string } }>(
        isEdit ? `/api/super-admin/lab-tests/${test!.id}` : '/api/super-admin/lab-tests',
        { method: isEdit ? 'PATCH' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }
      ),
  });
  const busy = mutation.isPending;
  const effectiveType = isEdit ? test!.resultType : resultType;
  const isCategorical = CATEGORICAL_TYPES.includes(effectiveType);
  const isNumeric = effectiveType === 'NUMERIC';

  const toggleStage = (st: string) => {
    setAssignedStages((prev) => (prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) return setError('Test Name is required.');

    const scopeDispatch = assignedStages.includes('DISPATCH');
    const scopePlant = assignedStages.includes('PLANT_QA');
    const scopeZmcc = assignedStages.includes('ZMCC_LAB_MC') || assignedStages.includes('ZMCC_LAB_HC');
    const scopeMot = assignedStages.includes('MOT_SHOP');

    let testScope: string = 'BOTH';
    try {
      testScope = mapScopeCheckboxes(scopeDispatch, scopePlant, scopeZmcc, scopeMot);
    } catch {
      testScope = 'BOTH';
    }

    if (isCategorical && options.length < 2) {
      return setError('Categorical tests must have at least 2 result options.');
    }

    const passingOption = options.find((o) => o.isPassing)?.value || 'PASS';
    const parsedMin = minValue.trim() !== '' ? Number(minValue.trim()) : null;
    const parsedMax = maxValue.trim() !== '' ? Number(maxValue.trim()) : null;

    if (isNumeric) {
      if (parsedMin !== null && isNaN(parsedMin)) return setError('Min Value must be a valid number.');
      if (parsedMax !== null && isNaN(parsedMax)) return setError('Max Value must be a valid number.');
      if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
        return setError('Min Value cannot exceed Max Value.');
      }
    }

    const payload: Record<string, unknown> = {
      testName: trimmedName,
      unit: unit ? unit.trim() : null,
      testScope,
      assignedStages,
      displayOrder: Number(displayOrder),
      isPhotoRequired: photoRequired,
      ...(isEdit ? {} : { resultType }),
      ...(isCategorical ? { resultOptions: options, acceptableOption: passingOption } : {}),
      ...(isNumeric && parsedMin !== null ? { minValue: parsedMin } : {}),
      ...(isNumeric && parsedMax !== null ? { maxValue: parsedMax } : {}),
    };

    mutation.mutate(payload, {
      onSuccess: (data) =>
        onSaved(
          isEdit
            ? `Lab Test "${test!.testCode}" updated successfully.`
            : `Lab Test "${data.labTest.testCode}" (${data.labTest.testName}) created successfully.`
        ),
      onError: (err) => setError(getErrorMessage(err) || (isEdit ? 'Failed to update lab test' : 'Failed to create lab test')),
    });
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      busy={busy}
      error={error}
      title={isEdit ? `Edit Lab Test (${test!.testCode})` : 'Create New Laboratory Test'}
    >
      <form onSubmit={submit} className="space-y-4">
        {isEdit && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <div>
              Result Type: <strong className="tabular-nums text-slate-900">{test!.resultType}</strong> (Locked)
            </div>
            <div>
              Historical Records: <strong className="tabular-nums text-slate-900">{test!.historicalResultsCount}</strong>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="lt-name" className={fieldLabelClass}>Test Name *</label>
          <input
            id="lt-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alcohol Stability Test"
            className={fieldInputClass}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {!isEdit && (
            <div className="sm:col-span-2">
              <span className={fieldLabelClass}>Result Type *</span>
              <div role="group" aria-label="Result type" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {RESULT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={resultType === t.value}
                    onClick={() => {
                      setResultType(t.value);
                      if (t.value === 'POSITIVE_NEGATIVE') {
                        setOptions([
                          { value: 'NEGATIVE', label: 'Negative', isPassing: true },
                          { value: 'POSITIVE', label: 'Positive', isPassing: false },
                        ]);
                      } else if (t.value === 'OK_NOT_OK') {
                        setOptions([
                          { value: 'OK', label: 'OK', isPassing: true },
                          { value: 'NOT_OK', label: 'Not OK', isPassing: false },
                        ]);
                      } else if (CATEGORICAL_TYPES.includes(t.value) && options.length === 0) {
                        setOptions(defaultOptions());
                      }
                    }}
                    className={`h-11 rounded-xl border px-2 text-xs font-semibold ${
                      resultType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border-strong bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label htmlFor="lt-unit" className={fieldLabelClass}>Unit</label>
            <input
              id="lt-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={fieldInputClass}
              placeholder={isEdit ? 'e.g. °C or % or leave blank' : 'e.g. % or °C (optional)'}
            />
          </div>
          <div>
            <label htmlFor="lt-order" className={fieldLabelClass}>Catalog Order</label>
            <input
              id="lt-order"
              type="number"
              required
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
              className={`${fieldInputClass} tabular-nums`}
            />
          </div>
        </div>

        {/* Assigned Operational Stages */}
        <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className={fieldLabelClass}>Assigned Operational Stages</span>
          <p className="text-[11px] text-slate-500">
            Select which reception checkpoints execute this test. Policies and active SOP rules will be automatically maintained.
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 pt-1">
            {STAGE_OPTIONS.map((st) => {
              const active = assignedStages.includes(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStage(st.id)}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-3 text-left transition-all ${
                    active
                      ? 'border-primary bg-primary/10 font-bold text-primary shadow-xs'
                      : 'border-slate-200 bg-white font-medium text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-xs">{st.label}</span>
                  <span className={`text-[10px] uppercase tracking-wider ${active ? 'font-bold text-primary' : 'text-slate-400'}`}>
                    {active ? 'Assigned' : 'Off'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* SOP Passing Limits (Numeric) */}
        {isNumeric && (
          <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className={fieldLabelClass}>SOP Passing Standard Limits (Optional)</span>
            <p className="text-[11px] text-slate-500">
              Readings within this range will pass immediately. Out-of-spec readings trigger warnings or rejections.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label htmlFor="lt-min" className="text-[11px] font-bold text-slate-700">Min Acceptable Value</label>
                <input
                  id="lt-min"
                  type="number"
                  step="any"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="e.g. 26.0"
                  className={fieldInputClass}
                />
              </div>
              <div>
                <label htmlFor="lt-max" className="text-[11px] font-bold text-slate-700">Max Acceptable Value</label>
                <input
                  id="lt-max"
                  type="number"
                  step="any"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="e.g. 32.0"
                  className={fieldInputClass}
                />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-xs font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={photoRequired}
              onChange={(e) => setPhotoRequired(e.target.checked)}
              className="size-5 rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span>Require camera photo evidence for this test</span>
          </label>
        </div>

        {isCategorical && <ChoiceEditor options={options} onChange={setOptions} />}

        <DrawerActions
          busy={busy}
          onCancel={onClose}
          submitLabel={isEdit ? 'Update Lab Test' : 'Create Lab Test'}
          busyLabel={isEdit ? 'Saving…' : 'Creating…'}
        />
      </form>
    </FormDrawer>
  );
}

export function LabTestStatusDrawer({
  test,
  action,
  onClose,
  onSaved,
}: {
  test: LabTest;
  action: 'ACTIVATE' | 'DEACTIVATE';
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const newStatus = action === 'ACTIVATE';
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ isActive: newStatus }),
      }),
    onSuccess: () => onSaved(`Lab Test "${test.testCode}" ${newStatus ? 'activated' : 'deactivated'} successfully.`),
    onError: (err) => setError(getErrorMessage(err) || 'Failed to update test status'),
  });
  const busy = mutation.isPending;

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title={action === 'DEACTIVATE' ? 'Deactivate Lab Test' : 'Activate Lab Test'}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={`h-5 w-5 shrink-0 ${action === 'DEACTIVATE' ? 'text-amber-600' : 'text-emerald-600'}`} />
        <span className="font-medium text-slate-500">Confirm test status change</span>
      </div>
      <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div>
          <span className="font-medium text-slate-500">Test Code:</span> <strong className="tabular-nums text-slate-900">{test.testCode}</strong>
        </div>
        <div>
          <span className="font-medium text-slate-500">Test Name:</span> <strong className="text-slate-900">{test.testName}</strong>
        </div>
      </div>
      <p className="leading-relaxed text-slate-600">
        {action === 'DEACTIVATE'
          ? 'Deactivating this test will remove it from newly started sessions. Existing in-progress and historical assignments remain unchanged.'
          : 'Activating this test will include it in newly started sessions for its selected scope. Existing in-progress assignments remain unchanged.'}
      </p>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={action === 'DEACTIVATE' ? 'destructive' : 'default'}
          className="h-11 px-5"
          disabled={busy}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {busy ? 'Updating…' : action === 'DEACTIVATE' ? 'Confirm Deactivation' : 'Confirm Activation'}
        </Button>
      </div>
    </FormDrawer>
  );
}
