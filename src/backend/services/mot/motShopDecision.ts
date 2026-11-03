// Builds the Stage 1 shop decision from the policy snapshot (pure: NO db imports, runs in the browser too).
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import { calculatedValuesForPortion } from '@/lib/portion-calculated-values';
import type {
  DecisionResult,
  ExceptionReason,
  GeofenceResult,
  MotShopDecisionDetails,
  MotShopPolicySnapshot,
  MotShopPolicyTest,
  MotShopTestInput,
  PersonDecision,
} from '@/types/stage1-decision';

export interface BuildMotShopDecisionInput {
  lr: number;
  fat: number;
  tests: MotShopTestInput[];
  photos: Array<{ labTestId: string; captureId: string }>;
  personDecision: PersonDecision;
  remarks?: string | null;
  geofence: GeofenceResult & { accuracyM: number | null; approximate: boolean };
  deciderCanApprove: boolean;
}

type TestOutcome = MotShopDecisionDetails['tests'][number]['outcome'];

function valueOf(t: MotShopPolicyTest, input: MotShopTestInput | undefined, i: BuildMotShopDecisionInput) {
  let value: number | null = input?.value ?? null;
  if (value === null && t.isLr && Number.isFinite(i.lr)) value = i.lr;
  if (value === null && t.isFat && Number.isFinite(i.fat)) value = i.fat;
  const text = input?.textValue?.trim();
  return { value, textValue: text ? text : null };
}

function outcomeOf(t: MotShopPolicyTest, value: number | null, textValue: string | null): 'PASS' | 'WARN' | 'FAIL' {
  const rule = t.rule;
  if (!rule) return 'PASS';
  if (value !== null) {
    if (rule.min !== null && value < rule.min) return 'FAIL';
    if (rule.max !== null && value > rule.max) return 'FAIL';
  }
  if (textValue !== null) {
    const v = textValue.trim().toUpperCase();
    if (rule.warningOptions && rule.warningOptions.some((w) => w.trim().toUpperCase() === v)) {
      return 'WARN';
    }
    if (rule.allowed && rule.allowed.length > 0) {
      if (!rule.allowed.some((a) => a.trim().toUpperCase() === v)) return 'FAIL';
    }
  }
  return 'PASS';
}

export function buildMotShopDecision(
  p: MotShopPolicySnapshot,
  i: BuildMotShopDecisionInput
): { decision: DecisionResult; details: MotShopDecisionDetails } {
  const ruleFailures: string[] = [];
  const missingCompulsory: string[] = [];
  const missingPhotos: string[] = [];
  const warnings: string[] = [];
  const rows: MotShopDecisionDetails['tests'] = [];

  // SNF, Total Solids and the ratio are computed here from LR and Fat; a client value is never used.
  const calculated = calculatedValuesForPortion(
    p.tests.filter((t) => t.testMode !== 'OFF'),
    (t) => valueOf(t, i.tests.find((x) => x.labTestId === t.labTestId), i).value
  );
  for (const t of p.tests) {
    if (t.testMode === 'OFF') continue;
    const input = i.tests.find((x) => x.labTestId === t.labTestId);
    if (t.labTestId in calculated) {
      const calcValue = calculated[t.labTestId];
      if (calcValue === null && t.testMode === 'COMPULSORY') missingCompulsory.push(t.testName);
      rows.push({
        labTestId: t.labTestId,
        testCode: t.testCode,
        testName: t.testName,
        value: calcValue,
        textValue: null,
        testMode: t.testMode,
        ruleMode: t.ruleMode,
        photoMode: t.photoMode,
        outcome: calcValue !== null ? 'PASS' : 'NOT_TESTED',
        photoCaptureId: null,
      });
      continue;
    }
    const { value, textValue } = valueOf(t, input, i);
    const tested = value !== null || textValue !== null;
    const photo = i.photos.find((x) => x.labTestId === t.labTestId);
    const photoCaptureId = photo?.captureId ?? input?.photoCaptureId ?? null;

    let outcome: TestOutcome = 'NOT_TESTED';
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
          warnings.push(`${t.testName} is outside the allowed range.`);
        }
      } else if (res === 'WARN') {
        outcome = 'WARN';
        warnings.push(`${t.testName} is acceptable on warning.`);
      } else {
        outcome = 'PASS';
      }
      if (t.photoMode === 'REQUIRED' && !photoCaptureId) missingPhotos.push(t.testName);
    }
    rows.push({
      labTestId: t.labTestId,
      testCode: t.testCode,
      testName: t.testName,
      value,
      textValue,
      testMode: t.testMode,
      ruleMode: t.ruleMode,
      photoMode: t.photoMode,
      outcome,
      photoCaptureId,
    });
  }

  const extraReasons: ExceptionReason[] = [];
  if (i.geofence.status === 'OUTSIDE') extraReasons.push('AWAY_FROM_SHOP');
  if (i.geofence.status === 'WEAK_GPS') warnings.push('GPS was weak at the shop.');
  if (i.geofence.status === 'NO_SHOP_GPS') warnings.push('This shop has no saved GPS location.');

  const decision = evaluateDecision({
    ruleFailures,
    missingCompulsory,
    missingPhotos,
    extraReasons,
    personDecision: i.personDecision,
    remarks: i.remarks,
    deciderCanApprove: i.deciderCanApprove,
  });

  return { decision, details: { policyVersion: p.version, tests: rows, geofence: i.geofence, warnings } };
}
