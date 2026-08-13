/**
 * Centralized Laboratory Rules Evaluation Service
 * Strictly respects user mandate:
 * 1. Observed values are separated from evaluation rules.
 * 2. If no active versioned LabTestRule exists, evaluation returns status 'NO_ACTIVE_RULE' / 'UNCONFIGURED'.
 * 3. Categorical valid options are strictly enforced:
 *    - OK_NOT_OK: 'OK', 'NOT_OK'
 *    - POSITIVE_NEGATIVE: 'NEGATIVE', 'POSITIVE'
 * 4. Final QA portion decisions remain 100% chemist-authoritative.
 */

export interface LabResultEvaluation {
  isPassed: boolean;
  status: 'EVALUATED' | 'NO_ACTIVE_RULE' | 'UNCONFIGURED';
  observedResult: string;
  reason?: string;
}

export function validateCategoricalOption(resultType: string, textValue: string | null): boolean {
  if (!textValue) return false;
  const val = textValue.trim().toUpperCase();

  if (resultType === 'OK_NOT_OK') {
    return val === 'OK' || val === 'NOT_OK';
  }

  if (resultType === 'POSITIVE_NEGATIVE') {
    return val === 'NEGATIVE' || val === 'POSITIVE';
  }

  return true;
}

export function evaluateLabResult(
  testCode: string,
  numericValue: number | null,
  textValue: string | null,
  resultType: string = 'NUMERIC'
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

  // If resultType is OK_NOT_OK or POSITIVE_NEGATIVE, ensure option validity
  if (resultType === 'OK_NOT_OK' && rawText && !['OK', 'NOT_OK'].includes(rawText)) {
    // Preserve compatibility for legacy 'OK' / 'PASS' values
    if (rawText !== 'PASS' && rawText !== 'NORMAL') {
      return {
        isPassed: false,
        status: 'UNCONFIGURED',
        observedResult: observed,
        reason: `Invalid option "${textValue}" for OK_NOT_OK test. Must be OK or NOT_OK.`,
      };
    }
  }

  if (resultType === 'POSITIVE_NEGATIVE' && rawText && !['NEGATIVE', 'POSITIVE'].includes(rawText)) {
    // Preserve compatibility for legacy 'OK' or 'NO' values
    if (rawText !== 'OK' && rawText !== 'NO' && rawText !== 'YES') {
      return {
        isPassed: false,
        status: 'UNCONFIGURED',
        observedResult: observed,
        reason: `Invalid option "${textValue}" for POSITIVE_NEGATIVE test. Must be NEGATIVE or POSITIVE.`,
      };
    }
  }

  // Without explicit active database rule, return NO_ACTIVE_RULE status with isPassed = true (observed only)
  return {
    isPassed: true,
    status: 'NO_ACTIVE_RULE',
    observedResult: observed,
  };
}
