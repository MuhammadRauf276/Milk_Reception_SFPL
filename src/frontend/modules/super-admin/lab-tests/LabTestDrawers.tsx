'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CheckCircle2, Eye, Lock, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
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
  category?: 'RELEASE' | 'MONITORING';
  passRangeText?: string;
  warningHoldText?: string;
  failRejectText?: string;
  warningHold?: string;
  failReject?: string;
  stageModes?: Record<string, string>;
  formulaId?: string | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const STAGE_OPTIONS = [
  { id: 'MOT_SHOP', label: 'Mobile Tester Shop', desc: 'Shop Intake' },
  { id: 'ZMCC_LAB_MC', label: 'ZMCC Mobile Tester', desc: 'Mobile Tester (route) intake' },
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

const FORMULA_OPTIONS = [
  { value: '', label: 'None (Standard Entry)' },
  { value: 'SNF_CANONICAL', label: 'Richmond SNF Formula (LR / 4 + 0.22 * Fat + 0.72)' },
  { value: 'TOTAL_SOLIDS', label: 'Total Solids (Fat + SNF)' },
  { value: 'RATIO_SNF_FAT', label: 'Ratio (SNF / Fat)' },
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
  const [category, setCategory] = useState<'RELEASE' | 'MONITORING'>(test?.category || 'RELEASE');
  const [formulaId, setFormulaId] = useState<string>(test?.formulaId || '');

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

  // Initialize limits with fallback to parsed passRangeText
  const initialLimits = () => {
    let min = test?.minValue !== undefined && test?.minValue !== null ? String(test.minValue) : '';
    let max = test?.maxValue !== undefined && test?.maxValue !== null ? String(test.maxValue) : '';
    if (!min && !max && test?.passRangeText && test.passRangeText.includes('–')) {
      const parts = test.passRangeText.split('–').map((s) => s.trim());
      if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
        min = parts[0];
        max = parts[1];
      }
    }
    return { min, max };
  };

  const initialBoundaryType = (): 'RANGE' | 'MIN_ONLY' | 'MAX_ONLY' => {
    const hasMin = test?.minValue !== undefined && test?.minValue !== null;
    const hasMax = test?.maxValue !== undefined && test?.maxValue !== null;
    if (hasMin && hasMax) return 'RANGE';
    if (hasMin && !hasMax) return 'MIN_ONLY';
    if (!hasMin && hasMax) return 'MAX_ONLY';
    if (test?.passRangeText) {
      if (test.passRangeText.includes('≥') || test.passRangeText.includes('>=')) return 'MIN_ONLY';
      if (test.passRangeText.includes('≤') || test.passRangeText.includes('<=')) return 'MAX_ONLY';
    }
    return 'RANGE';
  };

  const parseInitialWarning = () => {
    const raw = test?.warningHoldText && test.warningHoldText !== '—'
      ? test.warningHoldText
      : test?.warningHold && test.warningHold !== '—'
      ? test.warningHold
      : '';
    if (!raw) return { mode: 'STRICT' as const, low: '', high: '' };
    const matches = raw.match(/([0-9]+(?:\.[0-9]+)?)/g);
    if (matches && matches.length >= 2) {
      return { mode: 'TOLERANCE' as const, low: matches[0], high: matches[matches.length - 1] };
    }
    if (matches && matches.length === 1) {
      return { mode: 'TOLERANCE' as const, low: matches[0], high: matches[0] };
    }
    return { mode: 'TOLERANCE' as const, low: '', high: '' };
  };

  const parsedInit = initialLimits();
  const initWarn = parseInitialWarning();

  const [boundaryType, setBoundaryType] = useState<'RANGE' | 'MIN_ONLY' | 'MAX_ONLY'>(initialBoundaryType);
  const [minValue, setMinValue] = useState<string>(parsedInit.min);
  const [maxValue, setMaxValue] = useState<string>(parsedInit.max);
  const [warningMode, setWarningMode] = useState<'STRICT' | 'TOLERANCE'>(initWarn.mode);
  const [warnLowFloor, setWarnLowFloor] = useState<string>(initWarn.low);
  const [warnHighCeil, setWarnHighCeil] = useState<string>(initWarn.high);

  const [options, setOptions] = useState<LabTestResultOption[]>(
    test?.resultOptions ? JSON.parse(JSON.stringify(test.resultOptions)) : isEdit ? [] : defaultOptions()
  );
  const [acceptableOption, setAcceptableOption] = useState<string>(
    test?.acceptableOption || test?.passRangeText || 'PASS'
  );
  const [categoricalWarnOption, setCategoricalWarnOption] = useState<string>(
    test?.warningHoldText && test.warningHoldText !== '—' ? test.warningHoldText : '—'
  );
  const [categoricalFailOption, setCategoricalFailOption] = useState<string>(
    test?.failRejectText && test.failRejectText !== '—' ? test.failRejectText : 'FAIL'
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
  const isCalculated = effectiveType === 'CALCULATED';

  // MATHEMATICAL SOP BOUNDARY DERIVATION (Zero human string errors)
  const computedSopRules = useMemo(() => {
    if (category === 'MONITORING') {
      const mn = minValue.trim() !== '' ? minValue.trim() : null;
      return {
        passText: mn ? `≥ ${mn}` : test?.passRangeText || 'Norm Target',
        warnText: '—',
        rejectText: 'Monitoring Norm',
        outerMin: null,
        outerMax: null,
      };
    }

    if (isCategorical) {
      const passOptions = options
        .filter((o) => (o.outcome ? o.outcome === 'PASS' : o.isPassing === true))
        .map((o) => o.label || o.value);
      const warnOptions = options
        .filter((o) => (o.outcome ? o.outcome === 'WARNING' : o.isPassing === null))
        .map((o) => o.label || o.value);
      const failOptions = options
        .filter((o) => (o.outcome ? o.outcome === 'FAIL' : o.isPassing === false))
        .map((o) => o.label || o.value);

      const passText = passOptions.length > 0 ? passOptions.join(', ') : (acceptableOption.trim() || 'PASS');
      const warnText = warnOptions.length > 0 ? warnOptions.join(', ') : '—';
      const rejectText = failOptions.length > 0 ? failOptions.join(', ') : 'FAIL';
      return {
        passText,
        warnText,
        rejectText,
        outerMin: null,
        outerMax: null,
      };
    }

    // Programmatic Numeric Limits
    const mn = minValue.trim() !== '' ? Number(minValue.trim()) : null;
    const mx = maxValue.trim() !== '' ? Number(maxValue.trim()) : null;
    const low = warnLowFloor.trim() !== '' ? Number(warnLowFloor.trim()) : null;
    const high = warnHighCeil.trim() !== '' ? Number(warnHighCeil.trim()) : null;

    let passText = '—';
    if (boundaryType === 'RANGE') {
      passText = mn !== null && mx !== null ? `${mn} – ${mx}` : mn !== null ? `≥ ${mn}` : mx !== null ? `≤ ${mx}` : '—';
    } else if (boundaryType === 'MIN_ONLY') {
      passText = mn !== null ? `≥ ${mn}` : '—';
    } else {
      passText = mx !== null ? `≤ ${mx}` : '—';
    }

    let warnText = '—';
    let rejectText = '—';
    let outerMin: number | null = null;
    let outerMax: number | null = null;

    if (warningMode === 'STRICT') {
      warnText = '—';
      if (boundaryType === 'RANGE') {
        outerMin = mn;
        outerMax = mx;
        rejectText = mn !== null && mx !== null ? `< ${mn} or > ${mx}` : mn !== null ? `< ${mn}` : mx !== null ? `> ${mx}` : '—';
      } else if (boundaryType === 'MIN_ONLY') {
        outerMin = mn;
        rejectText = mn !== null ? `< ${mn}` : '—';
      } else {
        outerMax = mx;
        rejectText = mx !== null ? `> ${mx}` : '—';
      }
    } else {
      // Tolerance Hold Margin
      if (boundaryType === 'RANGE') {
        outerMin = low !== null ? low : mn;
        outerMax = high !== null ? high : mx;
        if (low !== null && high !== null && mn !== null && mx !== null) {
          warnText = `${low} – ${mn} | ${mx} – ${high}`;
          rejectText = `< ${low} or > ${high}`;
        } else if (low !== null && mn !== null) {
          warnText = `${low} – ${mn}`;
          rejectText = mx !== null ? `< ${low} or > ${mx}` : `< ${low}`;
        } else if (high !== null && mx !== null) {
          warnText = `${mx} – ${high}`;
          rejectText = mn !== null ? `< ${mn} or > ${high}` : `> ${high}`;
        } else {
          rejectText = mn !== null && mx !== null ? `< ${mn} or > ${mx}` : '—';
        }
      } else if (boundaryType === 'MIN_ONLY') {
        outerMin = low !== null ? low : mn;
        if (low !== null && mn !== null) {
          warnText = `${low} – ${mn}`;
          rejectText = `< ${low}`;
        } else {
          rejectText = mn !== null ? `< ${mn}` : '—';
        }
      } else {
        outerMax = high !== null ? high : mx;
        if (high !== null && mx !== null) {
          warnText = `${mx} – ${high}`;
          rejectText = `> ${high}`;
        } else {
          rejectText = mx !== null ? `> ${mx}` : '—';
        }
      }
    }

    return {
      passText,
      warnText,
      rejectText,
      outerMin,
      outerMax,
    };
  }, [category, isCategorical, boundaryType, minValue, maxValue, warningMode, warnLowFloor, warnHighCeil, acceptableOption, options, test]);

  const [testSimulatorVal, setTestSimulatorVal] = useState<string>('');

  const simulatedVerdict = useMemo(() => {
    const raw = testSimulatorVal.trim();
    if (!raw) return null;

    if (category === 'MONITORING') {
      return {
        verdict: 'MONITORING',
        label: 'Monitoring Norm',
        color: 'bg-slate-50 text-slate-800 border-slate-200',
        detail: 'Compulsory observation for yield & pricing. Never rejects milk.',
      };
    }

    const n = Number(raw);
    const hasNumericVal = !isNaN(n);
    const mn = minValue.trim() !== '' ? Number(minValue.trim()) : null;
    const mx = maxValue.trim() !== '' ? Number(maxValue.trim()) : null;

    if ((isNumeric || isCalculated) && hasNumericVal) {
      let inPass = false;
      if (boundaryType === 'RANGE') {
        inPass = (mn === null || n >= mn) && (mx === null || n <= mx);
      } else if (boundaryType === 'MIN_ONLY') {
        inPass = mn === null || n >= mn;
      } else {
        inPass = mx === null || n <= mx;
      }

      if (inPass) {
        return {
          verdict: 'PASS',
          label: 'Pass (Release)',
          color: 'bg-emerald-50 text-emerald-900 border-emerald-200',
          detail: 'Reading is within specification. Vehicle proceeds without hold.',
        };
      }

      // Check Tolerance Warning Window
      if (warningMode === 'TOLERANCE') {
        const inLowWarn = computedSopRules.outerMin !== null && mn !== null && n >= computedSopRules.outerMin && n < mn;
        const inHighWarn = computedSopRules.outerMax !== null && mx !== null && n > mx && n <= computedSopRules.outerMax;
        if (inLowWarn || inHighWarn) {
          return {
            verdict: 'WARNING',
            label: 'Warning Hold',
            color: 'bg-amber-50 text-amber-900 border-amber-200',
            detail: 'Reading is in tolerance margin. Review required.',
          };
        }
      }

      return {
        verdict: 'FAIL',
        label: 'Rejection Limit',
        color: 'bg-rose-50 text-rose-900 border-rose-200',
        detail: `Reading violates specification threshold (${computedSopRules.rejectText}).`,
      };
    }

    const inputOpt = raw.toLowerCase();
    const match = options.find((o) => {
      const v = (o.value || '').trim().toLowerCase();
      const l = (o.label || '').trim().toLowerCase();
      return v === inputOpt || l === inputOpt;
    });

    if (match) {
      const out = match.outcome || (match.isPassing === true ? 'PASS' : match.isPassing === false ? 'FAIL' : 'WARNING');
      if (out === 'PASS') {
        return {
          verdict: 'PASS',
          label: 'Pass (Release)',
          color: 'bg-emerald-50 text-emerald-900 border-emerald-200',
          detail: `"${match.label || match.value}" meets acceptance criteria.`,
        };
      }
      if (out === 'WARNING') {
        return {
          verdict: 'WARNING',
          label: 'Warning Hold',
          color: 'bg-amber-50 text-amber-900 border-amber-200',
          detail: `"${match.label || match.value}" triggers tolerance hold.`,
        };
      }
      return {
        verdict: 'FAIL',
        label: 'Rejection Limit',
        color: 'bg-rose-50 text-rose-900 border-rose-200',
        detail: `"${match.label || match.value}" violates acceptance criteria.`,
      };
    }

    return {
      verdict: 'WARNING',
      label: 'Hold for QA Evaluation',
      color: 'bg-slate-50 text-slate-800 border-slate-200',
      detail: 'Result requires evaluation.',
    };
  }, [testSimulatorVal, category, minValue, maxValue, boundaryType, warningMode, computedSopRules, isNumeric, isCalculated, options]);

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

    const passingOption = options.find((o) => o.isPassing)?.value || acceptableOption.trim() || 'PASS';
    const parsedMin = minValue.trim() !== '' ? Number(minValue.trim()) : null;
    const parsedMax = maxValue.trim() !== '' ? Number(maxValue.trim()) : null;

    if (isNumeric) {
      if (parsedMin !== null && isNaN(parsedMin)) return setError('Min Value must be a valid number.');
      if (parsedMax !== null && isNaN(parsedMax)) return setError('Max Value must be a valid number.');
      if (boundaryType === 'RANGE' && parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
        return setError('Min Value cannot exceed Max Value.');
      }
    }

    const finalMin = boundaryType === 'MAX_ONLY' ? null : parsedMin;
    const finalMax = boundaryType === 'MIN_ONLY' ? null : parsedMax;

    const payload: Record<string, unknown> = {
      testName: trimmedName,
      unit: unit ? unit.trim() : null,
      testScope,
      assignedStages,
      displayOrder: Number(displayOrder),
      isPhotoRequired: photoRequired,
      category,
      formulaId: formulaId || null,
      warningHoldText: computedSopRules.warnText,
      failRejectText: computedSopRules.rejectText,
      acceptableOption: isCategorical ? (acceptableOption.trim() || passingOption) : computedSopRules.passText,
      ...(isEdit ? {} : { resultType }),
      ...(isCategorical ? { resultOptions: options } : {}),
      ...(finalMin !== null ? { minValue: finalMin } : { minValue: null }),
      ...(finalMax !== null ? { maxValue: finalMax } : { maxValue: null }),
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
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 text-xs text-slate-700">
            <div>
              Result Type: <strong className="tabular-nums text-slate-900">{test!.resultType}</strong> (Locked)
            </div>
            <div>
              Historical Records: <strong className="tabular-nums text-slate-900">{test!.historicalResultsCount}</strong>
            </div>
          </div>
        )}

        {/* Category: Complete SOP vs Monitoring Norm */}
        <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
          <span className={fieldLabelClass}>
            Rule Category
            <InfoTip text="Complete SOP tests enforce pass/warning/rejection rules. Monitoring Norms are compulsory to record for yield/pricing, but never trigger system rejection." />
          </span>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCategory('RELEASE')}
              className={`flex min-h-11 items-center justify-center rounded-xl border px-3 text-xs font-bold transition ${
                category === 'RELEASE'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-xs'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Complete SOP (Enforce Release)
            </button>
            <button
              type="button"
              onClick={() => setCategory('MONITORING')}
              className={`flex min-h-11 items-center justify-center rounded-xl border px-3 text-xs font-bold transition ${
                category === 'MONITORING'
                  ? 'border-purple-500 bg-purple-50 text-purple-900 shadow-xs'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Monitoring Norm (No Rejection)
            </button>
          </div>
        </div>

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

        {/* Calculated Formula Binding */}
        {(isCalculated || effectiveType === 'NUMERIC') && (
          <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
            <span className={fieldLabelClass}>
              Calculated Formula Binding
              <InfoTip text="If bound to a formula, the value is auto-calculated from raw observations (e.g., LR and Fat) and displayed read-only." />
            </span>
            <select
              value={formulaId}
              onChange={(e) => setFormulaId(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:border-primary focus:outline-hidden"
            >
              {FORMULA_OPTIONS.map((fo) => (
                <option key={fo.value} value={fo.value}>
                  {fo.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Assigned Operational Stages */}
        <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
          <span className={fieldLabelClass}>Stages<InfoTip text="Select which reception checkpoints run this test. Policies and SOP rules are maintained automatically." /></span>
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

        {/* SOP DECISION LIMITS & REJECTION RULES (NUMERIC / CALCULATED) */}
        {(isNumeric || isCalculated) && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  SOP Limits
                </span>
                <InfoTip text="Standard operating limits for auto-release, tolerance warning hold, and rejection." />
              </div>
              {category === 'MONITORING' ? (
                <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                  Monitoring Norm
                </span>
              ) : (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 border border-slate-200">
                  Complete SOP
                </span>
              )}
            </div>

            {/* Clean Neutral Summary Strip */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 text-center text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-600">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span>Pass</span>
                </div>
                <div className="truncate font-mono text-xs font-bold text-slate-900">
                  {computedSopRules.passText}
                </div>
              </div>

              <div className="space-y-0.5 border-x border-slate-200 px-1">
                <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-600">
                  <span className="size-2 rounded-full bg-amber-500" />
                  <span>Warning</span>
                </div>
                <div className="truncate font-mono text-xs font-bold text-slate-900">
                  {computedSopRules.warnText !== '—' ? computedSopRules.warnText : 'None'}
                </div>
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-600">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span>Reject</span>
                </div>
                <div className="truncate font-mono text-xs font-bold text-slate-900">
                  {computedSopRules.rejectText}
                </div>
              </div>
            </div>

            {/* Interval Mode Switcher */}
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/40 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700">Interval Mode</span>
                <InfoTip text="Choose whether this test has both minimum and maximum limits, or only a single boundary." />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'RANGE', label: 'Min to Max' },
                  { id: 'MIN_ONLY', label: 'Min Only' },
                  { id: 'MAX_ONLY', label: 'Max Only' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setBoundaryType(m.id as 'RANGE' | 'MIN_ONLY' | 'MAX_ONLY')}
                    className={`rounded-lg border px-2.5 py-1.5 text-center text-xs font-semibold transition ${
                      boundaryType === m.id
                        ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pass Range */}
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold text-slate-800">Pass Range</span>
                <InfoTip text="Values within this range pass automatically and release the milk." />
              </div>

              <div className={`grid gap-2 pt-0.5 ${boundaryType === 'RANGE' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {boundaryType !== 'MAX_ONLY' && (
                  <div>
                    <label htmlFor="lt-min" className="text-[11px] font-medium text-slate-600">
                      Min Value {unit ? `(${unit})` : ''}
                    </label>
                    <input
                      id="lt-min"
                      type="number"
                      step="any"
                      value={minValue}
                      onChange={(e) => setMinValue(e.target.value)}
                      placeholder="e.g. 6.65"
                      className={fieldInputClass}
                    />
                  </div>
                )}
                {boundaryType !== 'MIN_ONLY' && (
                  <div>
                    <label htmlFor="lt-max" className="text-[11px] font-medium text-slate-600">
                      Max Value {unit ? `(${unit})` : ''}
                    </label>
                    <input
                      id="lt-max"
                      type="number"
                      step="any"
                      value={maxValue}
                      onChange={(e) => setMaxValue(e.target.value)}
                      placeholder="e.g. 6.95"
                      className={fieldInputClass}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Warning Margin */}
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-slate-800">Warning Margin</span>
                <InfoTip text="Borderline tolerance readings that hold for QA review instead of passing or rejecting." />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setWarningMode('STRICT');
                    setWarnLowFloor('');
                    setWarnHighCeil('');
                  }}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    warningMode === 'STRICT'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  No Warning
                </button>
                <button
                  type="button"
                  onClick={() => setWarningMode('TOLERANCE')}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    warningMode === 'TOLERANCE'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Tolerance Margin
                </button>
              </div>

              {warningMode === 'TOLERANCE' && (
                <div className={`grid gap-2 pt-1 ${boundaryType === 'RANGE' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {boundaryType !== 'MAX_ONLY' && (
                    <div>
                      <label className="text-[11px] font-medium text-slate-600">
                        Low Margin {unit ? `(${unit})` : ''}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={warnLowFloor}
                        onChange={(e) => setWarnLowFloor(e.target.value)}
                        placeholder="e.g. 6.60"
                        className={fieldInputClass}
                      />
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                        Hold: [{warnLowFloor || '?'} to {minValue || 'Min'})
                      </span>
                    </div>
                  )}
                  {boundaryType !== 'MIN_ONLY' && (
                    <div>
                      <label className="text-[11px] font-medium text-slate-600">
                        High Margin {unit ? `(${unit})` : ''}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={warnHighCeil}
                        onChange={(e) => setWarnHighCeil(e.target.value)}
                        placeholder="e.g. 7.00"
                        className={fieldInputClass}
                      />
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                        Hold: ({maxValue || 'Max'} to {warnHighCeil || '?'}]
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rejection Limit */}
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span className="text-xs font-semibold text-slate-800">Rejection Limit</span>
                  <InfoTip text="Values beyond this limit fail the test and trigger a rejection recommendation." />
                </div>
                <span className="text-[10px] font-semibold text-slate-500">
                  {category === 'MONITORING' ? 'Monitoring Norm' : 'Auto-Derived'}
                </span>
              </div>

              <div className="font-mono text-xs font-bold text-slate-900 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                {computedSopRules.rejectText}
              </div>
            </div>
          </div>
        )}

        {/* CATEGORICAL CHOICES & VERDICTS (NO DUPLICATE DROPDOWNS) */}
        {isCategorical && <ChoiceEditor options={options} onChange={setOptions} />}

        {/* PHOTO EVIDENCE REQUIREMENT */}
        <div className="rounded-xl border border-border bg-card p-3">
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

        {/* LIVE RULE SIMULATOR */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Eye className="size-3.5 text-slate-700" />
              <span className="text-xs font-semibold text-slate-800">Live Simulator</span>
              <InfoTip text="Enter any test reading to preview the policy verdict in real time." />
            </div>
            {testSimulatorVal && (
              <button
                type="button"
                onClick={() => setTestSimulatorVal('')}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            )}
          </div>

          {isCategorical && options.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-slate-500">Click choice to test:</span>
              <div className="flex flex-wrap gap-1.5">
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTestSimulatorVal(opt.value)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      testSimulatorVal.toLowerCase() === opt.value.toLowerCase() ||
                      testSimulatorVal.toLowerCase() === opt.label.toLowerCase()
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label || opt.value}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={testSimulatorVal}
              onChange={(e) => setTestSimulatorVal(e.target.value)}
              placeholder={(isNumeric || isCalculated) ? 'Enter sample value (e.g. 6.62)…' : 'Type or pick choice…'}
              className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono font-medium text-slate-900 focus:border-slate-900 focus:outline-hidden"
            />
          </div>

          {simulatedVerdict && (
            <div className={`rounded-lg border p-2.5 text-xs transition-all ${simulatedVerdict.color}`}>
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1.5">
                  {simulatedVerdict.verdict === 'PASS' && <span className="size-2 rounded-full bg-emerald-500" />}
                  {simulatedVerdict.verdict === 'WARNING' && <span className="size-2 rounded-full bg-amber-500" />}
                  {simulatedVerdict.verdict === 'FAIL' && <span className="size-2 rounded-full bg-rose-500" />}
                  <span>{simulatedVerdict.label}</span>
                </span>
                <span className="text-[10px] font-semibold opacity-75">Verdict</span>
              </div>
              <div className="text-[11px] font-normal opacity-90 mt-0.5">
                {simulatedVerdict.detail}
              </div>
            </div>
          )}
        </div>

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
  const isActivate = action === 'ACTIVATE';
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ isActive: isActivate }),
      }),
  });

  return (
    <FormDrawer
      open
      onClose={onClose}
      busy={mutation.isPending}
      title={isActivate ? `Activate Test (${test.testCode})` : `Deactivate Test (${test.testCode})`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(undefined, {
            onSuccess: () => onSaved(`Test "${test.testName}" ${isActivate ? 'activated' : 'deactivated'}.`),
          });
        }}
        className="space-y-4"
      >
        <p className="text-xs text-slate-700">
          Are you sure you want to {isActivate ? 'activate' : 'deactivate'} <strong>{test.testName}</strong>?
        </p>
        <DrawerActions
          busy={mutation.isPending}
          onCancel={onClose}
          submitLabel={isActivate ? 'Activate Test' : 'Deactivate Test'}
          busyLabel="Processing…"
        />
      </form>
    </FormDrawer>
  );
}
