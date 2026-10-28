import { LabTestResultOption } from '@/lib/validations/labTest';

/**
 * Centralized Laboratory Rules Evaluation Service
 * Supports 3-Zone Tolerance Standards:
 * 1. ACCEPTED (PASS) - Within Pass Range / Acceptable option
 * 2. TOLERANCE (WARNING HOLD) - Within Warning margin; human-authoritative decision required (never auto-rejected)
 * 3. NON-COMPLIANT (FAIL / OUT_OF_SPEC) - Exceeds allowable limits; system rejection recommendation
 *
 * Operational Mode Awareness:
 * - COMPULSORY: System SOP rules are strictly enforced (Fail triggers rejection recommendation).
 * - APPLIED (Optional): Test is shown, but system rules are NOT enforced.
 *   Returns status INFORMATIONAL_APPLIED ("Not under SOP — Optional test, system rules not applied").
 * - MONITORING NORM: Tests like LR, Fat, SNF have no SOP rejection rules. Values below norm provide quality awareness without auto-rejection.
 */

export type EvaluationZone = 'PASS' | 'WARNING' | 'FAIL' | 'INFORMATIONAL_APPLIED' | 'NO_ACTIVE_RULE' | 'UNCONFIGURED' | 'NEUTRAL';

export interface DetailedSopRule {
  min?: number | null;
  max?: number | null;
  warningMin?: number | null;
  warningMax?: number | null;
  warningBands?: Array<{ min: number; max: number }>;
  warningTrigger?: string | null;
  ruleCategory?: 'RELEASE' | 'MONITORING';
  acceptableOption?: string | null;
  warningOption?: string | null;
  failOption?: string | null;
}

export interface LabResultEvaluation {
  isPassed: boolean | null;
  status: 'EVALUATED' | 'NO_ACTIVE_RULE' | 'UNCONFIGURED' | 'NEUTRAL';
  zone: EvaluationZone;
  observedResult: string;
  reason?: string;
  isWarningHold?: boolean;
  isMonitoringNorm?: boolean;
  isAppliedOptional?: boolean;
}

export function validateCategoricalOption(
  resultType: string,
  textValue: string | null,
  resultOptions?: LabTestResultOption[] | null
): boolean {
  if (!textValue) return false;
  const val = textValue.trim().toUpperCase();

  // 1. If structured resultOptions is provided, validate strictly against configured options
  if (Array.isArray(resultOptions) && resultOptions.length > 0) {
    return resultOptions.some((opt) => opt.value.trim().toUpperCase() === val);
  }

  // 2. Standard fallback
  if (resultType === 'OK_NOT_OK') {
    return val === 'OK' || val === 'NOT_OK' || val === 'NOT OK';
  }

  if (resultType === 'POSITIVE_NEGATIVE') {
    return val === 'NEGATIVE' || val === 'POSITIVE';
  }

  if (resultType === 'BOOLEAN') {
    return ['TRUE', 'FALSE', 'YES', 'NO', '1', '0'].includes(val);
  }

  return true;
}

/**
 * Evaluates whether a numeric value is within a range or set of intervals.
 */
function isNumInInterval(val: number, min: number | null | undefined, max: number | null | undefined): boolean {
  if (min !== null && min !== undefined && val < min) return false;
  if (max !== null && max !== undefined && val > max) return false;
  return true;
}

export function evaluateLabResult(
  testCode: string,
  numericValue: number | null,
  textValue: string | null,
  resultType: string = 'NUMERIC',
  resultOptions?: LabTestResultOption[] | null,
  sopRule?: DetailedSopRule | null,
  isCompulsory: boolean = true
): LabResultEvaluation {
  const rawText = textValue ? textValue.trim().toUpperCase() : '';

  // Formulate Observed Result String
  let observed = '';
  if (resultType === 'NUMERIC' || resultType === 'CALCULATED') {
    observed = numericValue !== null && numericValue !== undefined ? String(numericValue) : (textValue || 'N/A');
  } else {
    observed = rawText || 'N/A';
  }

  // 0. APPLIED MODE CHECK (Optional Test — System rules NOT applied)
  if (!isCompulsory) {
    return {
      isPassed: true,
      status: 'EVALUATED',
      zone: 'INFORMATIONAL_APPLIED',
      observedResult: observed,
      reason: 'Not under SOP — Optional test, system rules not applied',
      isAppliedOptional: true,
    };
  }

  // Check for Monitoring Norm tests (LR, Fat, SNF)
  const isMonitoring = sopRule?.ruleCategory === 'MONITORING';

  // 1. EVALUATION FOR NUMERIC TESTS WITH DETAILED SOP RULE
  if ((resultType === 'NUMERIC' || resultType === 'CALCULATED') && sopRule) {
    if (numericValue === null || numericValue === undefined || isNaN(numericValue)) {
      return {
        isPassed: false,
        status: 'EVALUATED',
        zone: 'FAIL',
        observedResult: observed,
        reason: 'Missing numeric measurement for compulsory test',
      };
    }

    const n = Number(numericValue);

    // Monitoring Norm tests (e.g. LR, Fat, SNF)
    if (isMonitoring) {
      const minNorm = sopRule.min ?? null;
      if (minNorm !== null && n < minNorm) {
        return {
          isPassed: true, // Never auto-rejects
          status: 'EVALUATED',
          zone: 'WARNING',
          observedResult: observed,
          reason: `Monitoring Norm: Observed ${n} is below standard norm (${minNorm}). Informational only.`,
          isMonitoringNorm: true,
        };
      }
      return {
        isPassed: true,
        status: 'EVALUATED',
        zone: 'PASS',
        observedResult: observed,
        isMonitoringNorm: true,
      };
    }

    // Complete SOP: Check Pass Range
    const inPass = isNumInInterval(n, sopRule.min, sopRule.max);
    if (inPass) {
      return {
        isPassed: true,
        status: 'EVALUATED',
        zone: 'PASS',
        observedResult: observed,
      };
    }

    // Check Multi-Band or Single-Band Warning Hold Intervals
    let inWarning = false;
    if (Array.isArray(sopRule.warningBands) && sopRule.warningBands.length > 0) {
      inWarning = sopRule.warningBands.some((b) => isNumInInterval(n, b.min, b.max));
    } else if (sopRule.warningMin !== undefined && sopRule.warningMax !== undefined) {
      inWarning = isNumInInterval(n, sopRule.warningMin, sopRule.warningMax);
    }

    if (inWarning) {
      return {
        isPassed: null,
        status: 'EVALUATED',
        zone: 'WARNING',
        observedResult: observed,
        reason: `Tolerance Warning: Observed ${n} is within warning margin. Human decision required to Accept or Reject.`,
        isWarningHold: true,
      };
    }

    // Outside both Pass and Warning -> System Rejection Recommendation
    return {
      isPassed: false,
      status: 'EVALUATED',
      zone: 'FAIL',
      observedResult: observed,
      reason: `Out of SOP: Observed ${n} exceeds allowable limits [${sopRule.min ?? '-∞'}, ${sopRule.max ?? '+∞'}]. System recommends rejection.`,
    };
  }

  // 2. EVALUATION FOR CATEGORICAL TESTS WITH RESULT OPTIONS
  if (Array.isArray(resultOptions) && resultOptions.length > 0 && rawText) {
    const matched = resultOptions.find((opt) => opt.value.trim().toUpperCase() === rawText);
    if (!matched) {
      return {
        isPassed: false,
        status: 'UNCONFIGURED',
        zone: 'UNCONFIGURED',
        observedResult: observed,
        reason: `Invalid option "${textValue}". Allowed options: ${resultOptions.map((o) => o.label || o.value).join(', ')}`,
      };
    }

    if (matched.outcome === 'WARNING') {
      return {
        isPassed: null,
        status: 'EVALUATED',
        zone: 'WARNING',
        observedResult: observed,
        reason: 'Tolerance Warning: Observed result is acceptable on warning. Human decision required.',
        isWarningHold: true,
      };
    }

    const isPassed =
      matched.outcome === 'PASS'
        ? true
        : matched.outcome === 'FAIL'
        ? false
        : matched.isPassing !== null && matched.isPassing !== undefined
        ? Boolean(matched.isPassing)
        : null;

    return {
      isPassed,
      status: isPassed === null ? 'NEUTRAL' : 'EVALUATED',
      zone: isPassed === true ? 'PASS' : isPassed === false ? 'FAIL' : 'NEUTRAL',
      observedResult: observed,
      reason: isPassed === false ? 'Configured failing option. System recommends rejection.' : undefined,
    };
  }

  // 3. LEGACY CATEGORICAL FALLBACK
  if (resultType === 'OK_NOT_OK' && rawText) {
    if (['OK', 'PASS', 'NORMAL'].includes(rawText)) {
      return { isPassed: true, status: 'EVALUATED', zone: 'PASS', observedResult: observed };
    }
    if (['NOT_OK', 'NOT OK', 'FAIL', 'ABNORMAL'].includes(rawText)) {
      return { isPassed: false, status: 'EVALUATED', zone: 'FAIL', observedResult: observed, reason: 'Failed organoleptic check.' };
    }
  }

  if (resultType === 'POSITIVE_NEGATIVE' && rawText) {
    if (['NEGATIVE', 'OK', 'NO'].includes(rawText)) {
      return { isPassed: true, status: 'EVALUATED', zone: 'PASS', observedResult: observed };
    }
    if (['POSITIVE', 'NOT_OK', 'YES'].includes(rawText)) {
      return { isPassed: false, status: 'EVALUATED', zone: 'FAIL', observedResult: observed, reason: 'Positive adulterant detected. System recommends rejection.' };
    }
  }

  // Default fallback if no explicit rule is violated
  return {
    isPassed: true,
    status: 'NO_ACTIVE_RULE',
    zone: 'NO_ACTIVE_RULE',
    observedResult: observed,
  };
}

export interface QualityRule {
  testCode: string;
  testName: string;
  resultType: string;
  category: 'RELEASE' | 'MONITORING';
  minValue?: number | null;
  maxValue?: number | null;
  warningToleranceOffset?: number | null;
  warningBands?: Array<{ min: number; max: number }>;
}

export function evaluateTestObservation(
  rule: QualityRule,
  value: number | string | null,
  stageMode: 'COMPULSORY' | 'APPLIED' | 'NOT_APPLIED' | 'AUTO' = 'COMPULSORY'
) {
  const isCompulsory = stageMode === 'COMPULSORY';
  const numVal = typeof value === 'number' ? value : value && !isNaN(Number(value)) ? Number(value) : null;
  const strVal = typeof value === 'string' ? value : value != null ? String(value) : null;

  const evalRes = evaluateLabResult(
    rule.testCode,
    numVal,
    strVal,
    rule.resultType,
    null,
    {
      min: rule.minValue,
      max: rule.maxValue,
      warningBands: rule.warningBands,
      ruleCategory: rule.category,
    },
    isCompulsory
  );

  return {
    zone: evalRes.zone,
    isPass: evalRes.zone === 'PASS' || evalRes.zone === 'INFORMATIONAL_APPLIED',
    isWarning: evalRes.zone === 'WARNING',
    isFail: evalRes.zone === 'FAIL',
    message: evalRes.reason || '',
  };
}
