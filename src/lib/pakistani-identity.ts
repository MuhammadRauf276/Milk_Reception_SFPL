export type IdentityNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizePakistaniMobile(input: unknown): IdentityNormalizationResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'Pakistani mobile number is required.' };
  }

  const compact = input.trim().replace(/[\s()-]/g, '');
  let nationalNumber: string;

  if (/^03\d{9}$/.test(compact)) {
    nationalNumber = compact.slice(1);
  } else if (/^923\d{9}$/.test(compact)) {
    nationalNumber = compact.slice(2);
  } else if (/^\+923\d{9}$/.test(compact)) {
    nationalNumber = compact.slice(3);
  } else {
    return {
      ok: false,
      error: 'Invalid Pakistani mobile number. Use 03XXXXXXXXX or +923XXXXXXXXX.',
    };
  }

  return { ok: true, value: `+92${nationalNumber}` };
}

export function normalizePakistaniCnic(input: unknown): IdentityNormalizationResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'CNIC is required.' };
  }

  const compact = input.trim().replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(compact)) {
    return { ok: false, error: 'Invalid CNIC. Use 13 digits or XXXXX-XXXXXXX-X.' };
  }

  return { ok: true, value: compact };
}

export function formatPakistaniCnic(canonicalCnic: string): string {
  return /^\d{13}$/.test(canonicalCnic)
    ? `${canonicalCnic.slice(0, 5)}-${canonicalCnic.slice(5, 12)}-${canonicalCnic.slice(12)}`
    : canonicalCnic;
}

export function formatPakistaniMobile(canonicalPhone: string): string {
  return /^\+923\d{9}$/.test(canonicalPhone)
    ? `0${canonicalPhone.slice(3)}`
    : canonicalPhone;
}

/** Shapes a mobile number while it is typed: 0317-6826604. A pasted +92 number becomes the same. */
export function typePakistaniMobile(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('92')) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith('3')) digits = `0${digits}`;
  digits = digits.slice(0, 11);
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

/** Shapes a CNIC while it is typed: 33100-4222603-9. */
export function typePakistaniCnic(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}
