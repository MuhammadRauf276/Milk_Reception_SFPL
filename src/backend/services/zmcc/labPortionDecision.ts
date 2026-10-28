// Stage 2 (ZMCC lab) per-portion decision: pure, NO db imports, so the browser can show the same result as the server.
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import { evaluate3ZoneTest } from '@/lib/sop-evaluation';
import type { DecisionResult, ExceptionReason, FinalDecision, PersonDecision, ReviewStatus } from '@/types/stage1-decision';
import type { TestPointPolicyCell } from '@/types/test-point-policy';

export type LabPoint = 'ZMCC_LAB_MC' | 'ZMCC_LAB_HC';
export type LabTestMode = 'COMPOSITE' | 'PORTION_WISE';
export const MAX_LAB_PORTIONS = 12;

export interface LabPolicyTest extends TestPointPolicyCell {
  resultType: string;
  unit: string | null;
  isLr: boolean;
  isFat: boolean;
  options: string[] | null;
  resultOptions?: Array<{ value: string; label?: string; isPassing?: boolean | null; outcome?: 'PASS' | 'WARNING' | 'FAIL' }> | null;
  rule: {
    min: number | null;
    max: number | null;
    allowed?: string[] | null;
    warningTrigger?: string | null;
    decisionConsequence?: string | null;
    ruleCategory?: string | null;
    acceptableOption?: string | null;
  } | null;
}

export interface LabPolicySnapshot {
  point: LabPoint;
  version: number;
  fetchedAt: string;
  tests: LabPolicyTest[];
}

export interface LabPortionTestInput {
  labTestId: string;
  value?: number | null;
  textValue?: string | null;
}

export type LabTestOutcome = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED';

export interface LabPortionDecisionDetails {
  point: LabPoint;
  policyVersion: number;
  lr: number | null;
  fat: number | null;
  tests: Array<{
    labTestId: string;
    testCode: string;
    testName: string;
    unit: string | null;
    value: number | null;
    textValue: string | null;
    testMode: string;
    ruleMode: string;
    photoMode: string;
    outcome: LabTestOutcome;
    photoCaptureId: string | null;
  }>;
  warnings: string[];
}

/** A portion as the lab screen and the Zonal Manager queue see it. */
export interface LabPortionView {
  id: string;
  sessionId: string;
  portionNumber: number;
  status: string; // TESTING | PENDING_REVIEW | ACCEPTED | REJECTED | WEIGHED | LOADED
  quantityValue: number | null;
  quantityUnit: string | null;
  lr: number | null;
  fat: number | null;
  grossLiters: number | null;
  at13tsLiters: number | null;
  systemOutcome: 'PASS' | 'FAIL' | null;
  personDecision: PersonDecision | null;
  decisionRemarks: string | null;
  exceptionReasons: ExceptionReason[];
  reviewStatus: ReviewStatus;
  finalDecision: FinalDecision;
  details: LabPortionDecisionDetails | null;
  photos: Array<{ captureId: string; labTestId: string | null }>;
  createdByUserId: string | null;
  performedAsRole: string | null;
  isDelegated: boolean;
  decidedAt: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  reviewedAsRole: string | null;
  version: number;
}

export interface BuildLabPortionDecisionInput {
  tests: LabPortionTestInput[];
  /** Photos already saved for this portion (server: from captured_photo; browser: from uploads). */
  photos: Array<{ labTestId: string | null; captureId: string }>;
  personDecision: PersonDecision;
  remarks?: string | null;
  deciderCanApprove: boolean;
}

function outcomeOf(t: LabPolicyTest, value: number | null, textValue: string | null): 'PASS' | 'WARN' | 'FAIL' {
  const rule = t.rule;
  if (!rule) return 'PASS';

  const evalRes = evaluate3ZoneTest(
    {
      min: rule.min,
      max: rule.max,
      warningTrigger: rule.warningTrigger,
      decisionConsequence: rule.decisionConsequence,
      acceptableOption: rule.acceptableOption,
      category: rule.ruleCategory,
      ruleCategory: rule.ruleCategory,
      testMode: t.testMode,
      resultType: t.resultType,
      resultOptions: t.resultOptions,
      unit: t.unit,
    },
    value !== null ? value : textValue
  );

  if (evalRes.verdict === 'MONITORING' || evalRes.verdict === 'NOT_APPLIED') return 'PASS';
  return evalRes.verdict === 'WARN' ? 'WARN' : evalRes.verdict === 'FAIL' ? 'FAIL' : 'PASS';
}

function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildLabPortionDecision(
  p: LabPolicySnapshot,
  i: BuildLabPortionDecisionInput
): { decision: DecisionResult; details: LabPortionDecisionDetails } {
  const ruleFailures: string[] = [];
  const missingCompulsory: string[] = [];
  const missingPhotos: string[] = [];
  const warnings: string[] = [];
  const rows: LabPortionDecisionDetails['tests'] = [];
  let lr: number | null = null;
  let fat: number | null = null;

  for (const t of p.tests) {
    if (t.testMode === 'OFF') continue;
    const input = i.tests.find((x) => x.labTestId === t.labTestId);
    const value = t.resultType === 'NUMERIC' ? cleanNumber(input?.value) : null;
    const text = t.resultType === 'NUMERIC' ? '' : (input?.textValue ?? '').trim();
    const textValue = text ? text : null;
    const tested = value !== null || textValue !== null;
    const photo = i.photos.find((x) => x.labTestId === t.labTestId);
    const photoCaptureId = photo?.captureId ?? null;
    if (t.isLr && value !== null) lr = value;
    if (t.isFat && value !== null) fat = value;

    let outcome: LabTestOutcome = 'NOT_TESTED';
    if (!tested) {
      if (t.testMode === 'COMPULSORY') missingCompulsory.push(t.testName);
    } else {
      const res = outcomeOf(t, value, textValue);
      if (res === 'FAIL') {
        if (t.ruleMode === 'APPLY') {
          outcome = 'FAIL';
          ruleFailures.push(t.testCode);
        } else {
          outcome = 'WARN';
          warnings.push(`${t.testName} violates specification threshold.`);
        }
      } else if (res === 'WARN') {
        outcome = 'WARN';
        warnings.push(`${t.testName} is in tolerance margin.`);
      } else {
        outcome = 'PASS';
      }
      if (t.photoMode === 'REQUIRED' && !photoCaptureId) missingPhotos.push(t.testName);
    }
    rows.push({
      labTestId: t.labTestId,
      testCode: t.testCode,
      testName: t.testName,
      unit: t.unit,
      value,
      textValue,
      testMode: t.testMode,
      ruleMode: t.ruleMode,
      photoMode: t.photoMode,
      outcome,
      photoCaptureId,
    });
  }

  const decision = evaluateDecision({
    ruleFailures,
    missingCompulsory,
    missingPhotos,
    personDecision: i.personDecision,
    remarks: i.remarks,
    deciderCanApprove: i.deciderCanApprove,
  });

  return { decision, details: { point: p.point, policyVersion: p.version, lr, fat, tests: rows, warnings } };
}

/** Roll-up of all portions of one vehicle. */
export function summarizePortions(portions: Array<{ finalDecision: FinalDecision | string }>): {
  allDecided: boolean;
  allRejected: boolean;
  accepted: number;
  rejected: number;
  pending: number;
} {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const p of portions) {
    if (p.finalDecision === 'ACCEPTED') accepted++;
    else if (p.finalDecision === 'REJECTED') rejected++;
    else pending++;
  }
  return {
    allDecided: portions.length > 0 && pending === 0,
    allRejected: portions.length > 0 && rejected === portions.length,
    accepted,
    rejected,
    pending,
  };
}
