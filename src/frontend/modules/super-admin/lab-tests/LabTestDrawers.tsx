'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CheckCircle2, Eye, Lock, ShieldCheck, XCircle } from 'lucide-react';
import { mapScopeCheckboxes } from '@/lib/validations/labTest';
import { TEST_POINT_LABELS, stagesWithPhotoCheckbox, type StagePhotoState, type TestPointCode } from '@/types/test-point-policy';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/empty-state';
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

interface TestPhotoStages {
  calculated: boolean;
  stages: StagePhotoState[];
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

  // Per-stage photo rule (edit only). Read fresh each time the drawer opens; `photoEdits` holds only what the user touched.
  const queryClient = useQueryClient();
  const photoStagesUrl = isEdit ? `/api/super-admin/lab-tests/${test!.id}/photo-stages` : '';
  const photoStagesQuery = useQuery({
    queryKey: ['super-admin', 'lab-tests', 'photo-stages', test?.id],
    queryFn: ({ signal }) => fetchJson<TestPhotoStages>(photoStagesUrl, { signal, cache: 'no-store' }),
    enabled: isEdit,
    staleTime: 0,
    gcTime: 0,
  });
  const [photoEdits, setPhotoEdits] = useState<Partial<Record<TestPointCode, boolean>>>({});
  const photoStages = photoStagesQuery.data ? stagesWithPhotoCheckbox(photoStagesQuery.data.stages, photoStagesQuery.data.calculated) : [];
  const stagePhotoRequired = (s: StagePhotoState) => photoEdits[s.point] ?? s.photoMode === 'REQUIRED';
  const changedPhotoStages = photoStages
    .filter((s) => stagePhotoRequired(s) !== (s.photoMode === 'REQUIRED'))
    .map((s) => ({ point: s.point, photoRequired: stagePhotoRequired(s) }));

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const saved = await fetchJson<{ labTest: { testCode: string; testName: string } }>(
        isEdit ? `/api/super-admin/lab-tests/${test!.id}` : '/api/super-admin/lab-tests',
        { method: isEdit ? 'PATCH' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }
      );
      if (changedPhotoStages.length > 0) {
        try {
          await fetchJson(photoStagesUrl, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ changes: changedPhotoStages }) });
        } catch (err) {
          await queryClient.invalidateQueries({ queryKey: ['super-admin', 'lab-tests'] });
          throw new Error(`The test details were saved, but the photo rule was not: ${getErrorMessage(err)}`);
        }
      }
      return saved;
    },
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
        color: 'bg-subtle text-foreground border-border',
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
      color: 'bg-subtle text-foreground border-border',
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
      ...(isEdit ? {} : { isPhotoRequired: photoRequired }),
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
      title={isEdit ? `Edit lab test (${test!.testCode})` : 'New lab test'}
    >
      <form onSubmit={submit} className="space-y-4">
        {isEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 text-xs text-secondary-foreground">
            <div>
              Result type: <strong className="tabular-nums text-foreground">{test!.resultType}</strong> (Locked)
            </div>
            <div>
              Historical records: <strong className="tabular-nums text-foreground">{test!.historicalResultsCount}</strong>
            </div>
          </div>
        )}

        {/* Category: Complete SOP vs Monitoring Norm */}
        <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
          <span className={fieldLabelClass}>
            Rule category
            <InfoTip text="SOP tests can pass, warn or reject. Monitoring tests are recorded but never reject milk." />
          </span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCategory('RELEASE')}
              className={`flex min-h-11 items-center justify-center rounded-lg border px-3 text-center text-xs font-medium transition-colors ${
                category === 'RELEASE'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-secondary-foreground hover:bg-muted'
              }`}
            >
              Complete SOP (Enforce Release)
            </button>
            <button
              type="button"
              onClick={() => setCategory('MONITORING')}
              className={`flex min-h-11 items-center justify-center rounded-lg border px-3 text-center text-xs font-medium transition-colors ${
                category === 'MONITORING'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-secondary-foreground hover:bg-muted'
              }`}
            >
              Monitoring Norm (No Rejection)
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="lt-name" className={fieldLabelClass}>Test name *</label>
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
              <span className={fieldLabelClass}>Result type *</span>
              <div role="group" aria-label="Result type" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                    className={`min-h-11 rounded-lg border px-2 text-xs font-medium transition-colors ${
                      resultType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border-strong bg-card text-secondary-foreground hover:bg-muted'
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
            <label htmlFor="lt-order" className={fieldLabelClass}>Catalog order</label>
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
              Calculated formula
              <InfoTip text="If bound to a formula, the value is auto-calculated from raw observations (e.g., LR and Fat) and displayed read-only." />
            </span>
            <select
              value={formulaId}
              onChange={(e) => setFormulaId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-foreground focus:border-primary focus:outline-hidden"
            >
              {FORMULA_OPTIONS.map((fo) => (
                <option key={fo.value} value={fo.value}>
                  {fo.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Assigned stages */}
        <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
          <span className={fieldLabelClass}>Stages<InfoTip text="Select which reception checkpoints run this test. Policies and SOP rules are maintained automatically." /></span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2 pt-1">
            {STAGE_OPTIONS.map((st) => {
              const active = assignedStages.includes(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStage(st.id)}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 font-semibold text-primary'
                      : 'border-border bg-card font-medium text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  <span className="text-xs">{st.label}</span>
                  <span className={`text-xs ${active ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                    {active ? 'Assigned' : 'Off'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* SOP DECISION LIMITS & REJECTION RULES (NUMERIC / CALCULATED) */}
        {(isNumeric || isCalculated) && (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">
                  SOP limits
                </span>
                <InfoTip text="Standard operating limits for auto-release, tolerance warning hold, and rejection." />
              </div>
              {category === 'MONITORING' ? (
                <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  Monitoring Norm
                </span>
              ) : (
                <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  Complete SOP
                </span>
              )}
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-subtle p-2 text-center text-xs">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-xs font-medium text-secondary-foreground">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span>Pass</span>
                </div>
                <div className="break-words font-mono text-xs font-semibold text-foreground">
                  {computedSopRules.passText}
                </div>
              </div>

              <div className="min-w-0 space-y-0.5 px-1">
                <div className="flex items-center justify-center gap-1 text-xs font-medium text-secondary-foreground">
                  <span className="size-2 rounded-full bg-amber-500" />
                  <span>Warning</span>
                </div>
                <div className="break-words font-mono text-xs font-semibold text-foreground">
                  {computedSopRules.warnText !== '—' ? computedSopRules.warnText : 'None'}
                </div>
              </div>

              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-xs font-medium text-secondary-foreground">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span>Reject</span>
                </div>
                <div className="break-words font-mono text-xs font-semibold text-foreground">
                  {computedSopRules.rejectText}
                </div>
              </div>
            </div>

            {/* Interval Mode Switcher */}
            <div className="space-y-1.5 rounded-lg border border-border bg-subtle p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-secondary-foreground">Interval mode</span>
                <InfoTip text="Choose whether this test has both minimum and maximum limits, or only a single boundary." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'RANGE', label: 'Min to max' },
                  { id: 'MIN_ONLY', label: 'Min only' },
                  { id: 'MAX_ONLY', label: 'Max only' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setBoundaryType(m.id as 'RANGE' | 'MIN_ONLY' | 'MAX_ONLY')}
                    className={`min-h-11 rounded-lg border px-3 text-center text-xs font-medium transition-colors ${
                      boundaryType === m.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-secondary-foreground hover:bg-muted'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pass Range */}
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-foreground">Pass range</span>
                <InfoTip text="Values within this range pass automatically and release the milk." />
              </div>

              <div className={`grid gap-2 pt-0.5 ${boundaryType === 'RANGE' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {boundaryType !== 'MAX_ONLY' && (
                  <div>
                    <label htmlFor="lt-min" className="text-xs font-medium text-secondary-foreground">
                      Min value {unit ? `(${unit})` : ''}
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
                    <label htmlFor="lt-max" className="text-xs font-medium text-secondary-foreground">
                      Max value {unit ? `(${unit})` : ''}
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
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-500" />
                <span className="text-xs font-medium text-foreground">Warning margin</span>
                <InfoTip text="Borderline tolerance readings that hold for QA review instead of passing or rejecting." />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWarningMode('STRICT');
                    setWarnLowFloor('');
                    setWarnHighCeil('');
                  }}
                  className={`min-h-11 rounded-lg border px-2 text-xs font-medium transition-colors ${
                    warningMode === 'STRICT'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  No warning
                </button>
                <button
                  type="button"
                  onClick={() => setWarningMode('TOLERANCE')}
                  className={`min-h-11 rounded-lg border px-2 text-xs font-medium transition-colors ${
                    warningMode === 'TOLERANCE'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  Tolerance margin
                </button>
              </div>

              {warningMode === 'TOLERANCE' && (
                <div className={`grid gap-2 pt-1 ${boundaryType === 'RANGE' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {boundaryType !== 'MAX_ONLY' && (
                    <div>
                      <label className="text-xs font-medium text-secondary-foreground">
                        Low margin {unit ? `(${unit})` : ''}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={warnLowFloor}
                        onChange={(e) => setWarnLowFloor(e.target.value)}
                        placeholder="e.g. 6.60"
                        className={fieldInputClass}
                      />
                      <span className="mt-0.5 block break-words font-mono text-xs text-muted-foreground">
                        Hold: [{warnLowFloor || '?'} to {minValue || 'Min'})
                      </span>
                    </div>
                  )}
                  {boundaryType !== 'MIN_ONLY' && (
                    <div>
                      <label className="text-xs font-medium text-secondary-foreground">
                        High margin {unit ? `(${unit})` : ''}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={warnHighCeil}
                        onChange={(e) => setWarnHighCeil(e.target.value)}
                        placeholder="e.g. 7.00"
                        className={fieldInputClass}
                      />
                      <span className="mt-0.5 block break-words font-mono text-xs text-muted-foreground">
                        Hold: ({maxValue || 'Max'} to {warnHighCeil || '?'}]
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rejection Limit */}
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span className="text-xs font-medium text-foreground">Rejection limit</span>
                  <InfoTip text="Values beyond this limit fail the test and trigger a rejection recommendation." />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {category === 'MONITORING' ? 'Monitoring Norm' : 'Worked out from limits'}
                </span>
              </div>

              <div className="break-words rounded-lg border border-border bg-subtle px-3 py-2 font-mono text-xs font-semibold text-foreground">
                {computedSopRules.rejectText}
              </div>
            </div>
          </div>
        )}

        {/* CATEGORICAL CHOICES & VERDICTS (NO DUPLICATE DROPDOWNS) */}
        {isCategorical && <ChoiceEditor options={options} onChange={setOptions} />}

        {/* PHOTO EVIDENCE REQUIREMENT */}
        <div className="rounded-xl border border-border bg-card p-3">
          {!isEdit ? (
            <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={photoRequired}
                onChange={(e) => setPhotoRequired(e.target.checked)}
                className="size-5 rounded border-border-strong text-primary focus:ring-primary"
              />
              <span>Require camera photo evidence for this test</span>
            </label>
          ) : (
            <div className="space-y-1">
              <span className="text-xs font-medium text-foreground">Require camera photo evidence for this test</span>
              {photoStagesQuery.isPending ? (
                <p className="text-xs text-muted-foreground">Loading stages…</p>
              ) : photoStagesQuery.isError ? (
                <ErrorState description={getErrorMessage(photoStagesQuery.error) || 'Could not load the photo rules.'} onRetry={() => void photoStagesQuery.refetch()} />
              ) : photoStagesQuery.data.calculated ? (
                <p className="text-xs text-muted-foreground">Calculated automatically, no photo</p>
              ) : photoStages.length === 0 ? (
                <p className="text-xs text-muted-foreground">Turn the test on for a stage in the Master matrix to set its photo rule.</p>
              ) : (
                photoStages.map((s) => (
                  <label key={s.point} className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={stagePhotoRequired(s)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setPhotoEdits((prev) => ({ ...prev, [s.point]: checked }));
                      }}
                      className="size-5 rounded border-border-strong text-primary focus:ring-primary"
                    />
                    <span>{TEST_POINT_LABELS[s.point]}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        {/* LIVE RULE SIMULATOR */}
        <div className="space-y-2 rounded-xl border border-border bg-subtle p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Live simulator</span>
              <InfoTip text="Enter any test reading to preview the policy verdict in real time." />
            </div>
            {testSimulatorVal && (
              <button
                type="button"
                onClick={() => setTestSimulatorVal('')}
                className="min-h-11 px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {isCategorical && options.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Choose one to test</span>
              <div className="flex flex-wrap gap-2">
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTestSimulatorVal(opt.value)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors ${
                      testSimulatorVal.toLowerCase() === opt.value.toLowerCase() ||
                      testSimulatorVal.toLowerCase() === opt.label.toLowerCase()
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-secondary-foreground hover:bg-muted'
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
              placeholder={(isNumeric || isCalculated) ? 'Sample value, e.g. 6.62' : 'Type or pick a choice'}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 font-mono text-xs font-medium text-foreground focus:border-primary focus:outline-hidden"
            />
          </div>

          {simulatedVerdict && (
            <div className={`rounded-lg border p-3 text-xs transition-[color,background-color,border-color,box-shadow,opacity,transform] ${simulatedVerdict.color}`}>
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-2">
                  {simulatedVerdict.verdict === 'PASS' && <span className="size-2 rounded-full bg-emerald-500" />}
                  {simulatedVerdict.verdict === 'WARNING' && <span className="size-2 rounded-full bg-amber-500" />}
                  {simulatedVerdict.verdict === 'FAIL' && <span className="size-2 rounded-full bg-rose-500" />}
                  <span>{simulatedVerdict.label}</span>
                </span>
                <span className="text-xs font-semibold opacity-75">Verdict</span>
              </div>
              <div className="text-xs font-normal opacity-90 mt-0.5">
                {simulatedVerdict.detail}
              </div>
            </div>
          )}
        </div>

        <DrawerActions
          busy={busy}
          onCancel={onClose}
          submitLabel={isEdit ? 'Update lab test' : 'Create lab test'}
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
  onError,
}: {
  test: LabTest;
  action: 'ACTIVATE' | 'DEACTIVATE';
  onClose: () => void;
  onSaved: (m: string) => void;
  /** Server refusal (for example a role holder cannot be deactivated); the page shows it in its error banner. */
  onError?: (m: string) => void;
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
      title={isActivate ? `Activate test (${test.testCode})` : `Deactivate test (${test.testCode})`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(undefined, {
            onSuccess: () => onSaved(`Test "${test.testName}" ${isActivate ? 'activated' : 'deactivated'}.`),
            onError: (err) => onError?.(getErrorMessage(err) || `Failed to ${isActivate ? 'activate' : 'deactivate'} the test.`),
          });
        }}
        className="space-y-4"
      >
        <p className="text-xs text-secondary-foreground">
          Are you sure you want to {isActivate ? 'activate' : 'deactivate'} <strong>{test.testName}</strong>?
        </p>
        <DrawerActions
          busy={mutation.isPending}
          onCancel={onClose}
          submitLabel={isActivate ? 'Activate test' : 'Deactivate test'}
          busyLabel="Processing…"
        />
      </form>
    </FormDrawer>
  );
}
