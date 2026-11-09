import { randomUUID } from 'node:crypto';

const DRAFT_PREFIX = 'DRAFT-';

/**
 * An open dispatch form needs a visit to hold its tests and photos, but it may never be sent. So a draft carries a
 * private id, and the real visit number is only given when the vehicle is submitted. An abandoned form uses up nothing.
 */
export function newDraftVisitNumber(): string {
  return `${DRAFT_PREFIX}${randomUUID()}`;
}

export function isDraftVisitNumber(visitNumber: string | null | undefined): boolean {
  return !!visitNumber && visitNumber.startsWith(DRAFT_PREFIX);
}

/** The next number of the day: one above the highest in use. Anything not in the VV-date-number form is ignored. */
export function nextVisitNumber(dateStr: string, existing: Array<string | null | undefined>): string {
  const dateCode = dateStr.replace(/-/g, '');
  const pattern = new RegExp(`^VV-${dateCode}-(\\d+)$`);
  const highest = existing.reduce((max, value) => {
    const match = value?.match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `VV-${dateCode}-${String(highest + 1).padStart(4, '0')}`;
}
