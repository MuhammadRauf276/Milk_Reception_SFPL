/**
 * Email Validation and Normalization Helper for Stage 6G-D.2 User Email Foundation.
 *
 * Rules:
 * - Format: RFC 5321 standard, max length 254 characters.
 * - Regex: standard email regex (/^[^\s@]+@[^\s@]+\.[^\s@]+$/).
 * - Normalization: trimmed and lowercased (trim().toLowerCase()).
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

export interface EmailValidationResult {
  isValid: boolean;
  normalizedEmail: string | null;
  error?: string;
}

export function validateAndNormalizeEmail(
  rawEmail: unknown,
  required: boolean = true
): EmailValidationResult {
  if (rawEmail === undefined || rawEmail === null) {
    if (required) {
      return {
        isValid: false,
        normalizedEmail: null,
        error: 'Email address is required.',
      };
    }
    return { isValid: true, normalizedEmail: null };
  }

  if (typeof rawEmail !== 'string') {
    return {
      isValid: false,
      normalizedEmail: null,
      error: 'Email address must be a text string.',
    };
  }

  const trimmed = rawEmail.trim();

  if (trimmed.length === 0) {
    if (required) {
      return {
        isValid: false,
        normalizedEmail: null,
        error: 'Email address cannot be empty or blank.',
      };
    }
    return { isValid: true, normalizedEmail: null };
  }

  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return {
      isValid: false,
      normalizedEmail: null,
      error: `Email address cannot exceed ${MAX_EMAIL_LENGTH} characters.`,
    };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return {
      isValid: false,
      normalizedEmail: null,
      error: 'Invalid email address format. Expected format: user@domain.com.',
    };
  }

  return {
    isValid: true,
    normalizedEmail: trimmed.toLowerCase(),
  };
}
