/**
/**
 * Centralized System-Wide Data Validation Helpers
 * Authoritative numeric, formula, and string validation rules.
 */

export interface ValidationResult<T = number> {
  isValid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validates that a numeric input is a finite decimal strictly greater than zero.
 */
export function validatePositiveDecimal(input: any, fieldName: string = 'Value'): ValidationResult<number> {
  if (input === null || input === undefined || input === '') {
    return { isValid: false, error: `${fieldName} is required.` };
  }

  const num = Number(input);

  if (isNaN(num) || !isFinite(num)) {
    return { isValid: false, error: `${fieldName} must be a valid finite number.` };
  }

  if (num <= 0) {
    return { isValid: false, error: `${fieldName} must be greater than 0.` };
  }

  return { isValid: true, value: num };
}

/**
 * Validates that a numeric lab test input is a valid non-negative decimal (>= 0).
 */
export function validateNonNegativeDecimal(input: any, fieldName: string = 'Measurement'): ValidationResult<number> {
  if (input === null || input === undefined || input === '') {
    return { isValid: false, error: `${fieldName} is required.` };
  }

  const num = Number(input);

  if (isNaN(num) || !isFinite(num)) {
    return { isValid: false, error: `${fieldName} must be a valid finite number.` };
  }

  if (num < 0) {
    return { isValid: false, error: `${fieldName} cannot be negative.` };
  }

  return { isValid: true, value: num };
}

/**
 * Safe formula calculations.
 * Returns null if calculation is undefined or invalid (e.g. division by zero).
 * NEVER returns 0, NaN, or Infinity for an undefined ratio.
 */
export function calculateSnfFatRatio(snf: number | null, fat: number | null): number | null {
  if (snf === null || fat === null || isNaN(snf) || isNaN(fat) || !isFinite(snf) || !isFinite(fat)) {
    return null;
  }
  if (fat <= 0) {
    return null; // Undefined if fat <= 0
  }
  const ratio = snf / fat;
  return isFinite(ratio) ? Number(ratio.toFixed(3)) : null;
}

/**
 * Validates string input (trims, enforces non-empty, and checks max length).
 */
export function validateRequiredString(input: any, fieldName: string = 'Field', maxLength: number = 255): ValidationResult<string> {
  if (typeof input !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string.` };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: `${fieldName} cannot be empty.` };
  }

  if (trimmed.length > maxLength) {
    return { isValid: false, error: `${fieldName} cannot exceed ${maxLength} characters.` };
  }

  return { isValid: true, value: trimmed };
}
