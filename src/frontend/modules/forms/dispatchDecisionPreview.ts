// Dispatch decision preview (Phase 4c, pure, runs in the browser). The server decides again on save.
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import type { DecisionResult, ExceptionReason, MotShopPolicyTest, PersonDecision } from '@/types/stage1-decision';
import type { DecisionRuleTestRow } from '@/frontend/modules/shared/decision/DecisionRulePanel';

export type DispatchTestMode = 'COMPOSITE' | 'PORTION_WISE';
export type DispatchPolicyTest = MotShopPolicyTest;

export interface DispatchPolicySnapshot {
  point: 'ZMCC_DISPATCH' | 'CONTRACTOR_DISPATCH';
  version: number;
  tests: DispatchPolicyTest[];
}

export const LAB_REPORT_TEST_CODE = 'LAB_REPORT_HANDWRITTEN';

export interface PreviewPortion {
  portionNumber: number;
  /** labTestId -> entered value (numeric text or option text). */
  values: Record<string, { value: string; text: string }>;
  /** labTestId -> true when a picture was taken. */
  photos: Record<string, boolean>;
}

export function isNumericTest(t: DispatchPolicyTest): boolean {
  const rt = (t.resultType || '').toUpperCase();
  return rt === '' || rt === 'NUMERIC' || rt === 'NUMBER' || rt === 'DECIMAL';
}

function ruleFails(t: DispatchPolicyTest, value: number | null, text: string | null): boolean {
  const rule = t.rule;
  if (!rule) return false;
  if (value !== null) {
    if (rule.min !== null && value < rule.min) return true;
    if (rule.max !== null && value > rule.max) return true;
  }
  if (text !== null && rule.allowed && rule.allowed.length > 0) {
    const v = text.toUpperCase();
    if (!rule.allowed.some((a) => a.trim().toUpperCase() === v)) return true;
  }
  return false;
}

export interface DispatchPreview {
  rows: DecisionRuleTestRow[];
  warnings: string[];
  decision: DecisionResult | null;
}

export function buildDispatchPreview(input: {
  tests: DispatchPolicyTest[];
  portions: PreviewPortion[];
  labReportTaken: boolean;
  personDecision: PersonDecision | null;
  remarks: string;
  deciderCanApprove: boolean;
}): DispatchPreview {
  const rows: DecisionRuleTestRow[] = [];
  const warnings: string[] = [];
  const ruleFailures: string[] = [];
  const missingCompulsory: string[] = [];
  const missingPhotos: string[] = [];
  const multi = input.portions.length > 1;

  for (const p of input.portions) {
    const prefix = multi ? `P${p.portionNumber} ` : '';
    for (const t of input.tests) {
      if (t.testMode === 'OFF') continue;
      const v = p.values[t.labTestId] ?? { value: '', text: '' };
      const num = isNumericTest(t) && v.value.trim() !== '' && Number.isFinite(Number(v.value)) ? Number(v.value) : null;
      const text = !isNumericTest(t) && v.text.trim() !== '' ? v.text.trim() : null;
      const tested = num !== null || text !== null;
      let outcome: DecisionRuleTestRow['outcome'] = 'NOT_TESTED';
      let note: string | null = null;
      if (!tested) {
        if (t.testMode === 'COMPULSORY') {
          missingCompulsory.push(`${prefix}${t.testName}`);
          note = 'Must be done';
        }
      } else if (ruleFails(t, num, text)) {
        if (t.ruleMode === 'APPLY') {
          outcome = 'FAIL';
          ruleFailures.push(`${prefix}${t.testCode}`);
        } else {
          outcome = 'WARN';
          warnings.push(`${prefix}${t.testName} is outside the allowed range.`);
        }
      } else {
        outcome = 'PASS';
      }
      if (t.photoMode === 'REQUIRED' && !p.photos[t.labTestId] && (tested || t.testMode === 'COMPULSORY')) {
        missingPhotos.push(`${prefix}${t.testName}`);
        note = note ? `${note}. Picture missing` : 'Picture missing';
      }
      rows.push({
        key: `${p.portionNumber}:${t.labTestId}`,
        name: `${prefix}${t.testName}`,
        outcome,
        valueText: num !== null ? String(num) : text,
        note,
      });
    }
  }

  if (!input.labReportTaken) {
    missingPhotos.push('Lab report');
    rows.push({ key: 'lab-report', name: 'Hand-written lab report', outcome: 'NOT_TESTED', note: 'Picture missing' });
  } else {
    rows.push({ key: 'lab-report', name: 'Hand-written lab report', outcome: 'PASS', valueText: 'Picture taken' });
  }

  const effectivePerson: PersonDecision = input.personDecision ?? 'ACCEPT';
  const decision = evaluateDecision({
    ruleFailures,
    missingCompulsory,
    missingPhotos,
    extraReasons: [] as ExceptionReason[],
    personDecision: effectivePerson,
    remarks: input.remarks,
    deciderCanApprove: input.deciderCanApprove,
  });

  return { rows, warnings, decision };
}
