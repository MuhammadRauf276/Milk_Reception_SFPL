import { LabTestResultOption } from '@/lib/validations/labTest';

/**
 * Centralized Laboratory Rules Evaluation Service
 * Strictly respects user mandate:
 * 1. Observed values are separated from evaluation rules.
 * 2. If metadata-driven resultOptions exist, evaluates isPassing directly from configured option metadata.
 * 3. Categorical valid options are strictly validated against snapshot/master options.
 * 4. Final QA portion decisions remain 100% chemist-authoritative.
 */

export interface LabResultEvaluation {
  isPassed: boolean | null;
  status: 'EVALUATED' | 'NO_ACTIVE_RULE' | 'UNCONFIGURED' | 'NEUTRAL';
  observedResult: string;
  reason?: string;
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

  // 2. Legacy fallback
  if (resultType === 'OK_NOT_OK') {
    return val === 'OK' || val === 'NOT_OK';
  }

  if (resultType === 'POSITIVE_NEGATIVE') {
    return val === 'NEGATIVE' || val === 'POSITIVE';
  }

  if (resultType === 'BOOLEAN') {
    return ['TRUE', 'FALSE', 'YES', 'NO', '1', '0'].includes(val);
  }

  return true;
}

export function evaluateLabResult(
  testCode: string,
  numericValue: number | null,
  textValue: string | null,
  resultType: string = 'NUMERIC',
  resultOptions?: LabTestResultOption[] | null
): LabResultEvaluation {
  const code = testCode.toUpperCase().trim();
  const rawText = textValue ? textValue.trim().toUpperCase() : '';

  // Formulate Observed Result String
  let observed = '';
  if (resultType === 'NUMERIC' || resultType === 'CALCULATED') {
    observed = numericValue !== null && numericValue !== undefined ? String(numericValue) : (textValue || 'N/A');
  } else {
    observed = rawText || 'N/A';
  }

  // 1. If resultOptions configured, evaluate pass/fail strictly based on option metadata
  if (Array.isArray(resultOptions) && resultOptions.length > 0) {
    const matched = resultOptions.find((opt) => opt.value.trim().toUpperCase() === rawText);
    if (!matched) {
      return {
        isPassed: false,
        status: 'UNCONFIGURED',
        observedResult: observed,
        reason: `Invalid option "${textValue}" for test. Allowed options: ${resultOptions.map((o) => o.label || o.value).join(', ')}`,
      };
    }

    // Exact three-state semantics:
    // true -> PASS, false -> FAIL, null -> NEUTRAL / NO PASS-FAIL CLASSIFICATION
    const isPassed = matched.isPassing !== null && matched.isPassing !== undefined ? Boolean(matched.isPassing) : null;
    return {
      isPassed,
      status: isPassed === null ? 'NEUTRAL' : 'EVALUATED',
      observedResult: observed,
      reason: isPassed === false ? 'Configured failing option' : undefined,
    };
  }

  // 2. Legacy fallback for OK_NOT_OK, POSITIVE_NEGATIVE, BOOLEAN
  if (resultType === 'OK_NOT_OK' && rawText) {
    if (['OK', 'PASS', 'NORMAL'].includes(rawText)) {
      return { isPassed: true, status: 'EVALUATED', observedResult: observed };
    }
    if (['NOT_OK', 'FAIL', 'ABNORMAL'].includes(rawText)) {
      return { isPassed: false, status: 'EVALUATED', observedResult: observed };
    }
    return {
      isPassed: false,
      status: 'UNCONFIGURED',
      observedResult: observed,
      reason: `Invalid option "${textValue}" for OK_NOT_OK test. Must be OK or NOT_OK.`,
    };
  }

  if (resultType === 'POSITIVE_NEGATIVE' && rawText) {
    if (['NEGATIVE', 'OK', 'NO'].includes(rawText)) {
      return { isPassed: true, status: 'EVALUATED', observedResult: observed };
    }
    if (['POSITIVE', 'NOT_OK', 'YES'].includes(rawText)) {
      return { isPassed: false, status: 'EVALUATED', observedResult: observed };
    }
    return {
      isPassed: false,
      status: 'UNCONFIGURED',
      observedResult: observed,
      reason: `Invalid option "${textValue}" for POSITIVE_NEGATIVE test. Must be NEGATIVE or POSITIVE.`,
    };
  }

  if (resultType === 'BOOLEAN' && rawText) {
    if (['TRUE', 'YES', '1', 'PASS'].includes(rawText)) {
      return { isPassed: true, status: 'EVALUATED', observedResult: observed };
    }
    if (['FALSE', 'NO', '0', 'FAIL'].includes(rawText)) {
      return { isPassed: false, status: 'EVALUATED', observedResult: observed };
    }
    return {
      isPassed: false,
      status: 'UNCONFIGURED',
      observedResult: observed,
      reason: `Invalid option "${textValue}" for BOOLEAN test. Must be TRUE or FALSE.`,
    };
  }

  // Without explicit active database rule, return NO_ACTIVE_RULE status with isPassed = true (observed only)
  return {
    isPassed: true,
    status: 'NO_ACTIVE_RULE',
    observedResult: observed,
  };
}

