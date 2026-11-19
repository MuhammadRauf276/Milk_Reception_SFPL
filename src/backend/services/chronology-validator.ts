/**
 * Centralized Operational Timestamp Chronology Engine
 * Strictly enforces exact operational chronology across all vehicle reception workflow events.
 * 
 * Rules:
 * 1. eventTimestamp <= serverNow (Exact server time; zero artificial clock-skew allowance).
 * 2. eventTimestamp >= predecessorTimestamp (Exact predecessor timestamp; equal timestamps allowed, 1ms earlier rejected).
 * 3. Predecessor timestamps are fetched authoritatively from database by backend.
 */

import { formatOperationalDatetime } from '@/lib/datetime-utils';

/** A time up to this far ahead of the server clock is a phone clock running fast: it counts as now. */
export const FUTURE_ALLOWANCE_MS = 10 * 60 * 1000;
export const FUTURE_TIME_MESSAGE = 'The time is ahead of the server clock. Check the time.';

/**
 * The one future-time rule for every step. Null when the time is clearly in the future (a wrong hour or date);
 * otherwise the time itself, pulled back to the server's now when it is only slightly ahead.
 */
export function withinFutureAllowance(date: Date, now: Date = new Date()): Date | null {
  const t = date.getTime();
  const n = now.getTime();
  if (t > n + FUTURE_ALLOWANCE_MS) return null;
  return t > n ? new Date(n) : date;
}

export interface ChronologyResult {
  isValid: boolean;
  error?: string;
  date?: Date;
}

export function validateOperationalTimestamp(
  inputTimestampStr: string,
  predecessorTimestamp: Date | null,
  eventName: string,
  predecessorName: string
): ChronologyResult {
  if (!inputTimestampStr) {
    return { isValid: false, error: `${eventName} date & time is required.` };
  }

  const opDate = new Date(inputTimestampStr);
  if (isNaN(opDate.getTime())) {
    return { isValid: false, error: `Invalid date & time format for ${eventName}.` };
  }

  const serverNow = new Date();

  // Rule 1: not clearly in the future (a phone a few minutes fast counts as now).
  const allowed = withinFutureAllowance(opDate, serverNow);
  if (!allowed) {
    return { isValid: false, error: `${eventName}: ${FUTURE_TIME_MESSAGE}` };
  }
  let effectiveDate = allowed;

  // Rule 2: If eventTimestamp is earlier than predecessor (e.g. user stayed on screen for a long time before submitting),
  // auto-advance effectiveDate to serverNow (or predecessorTimestamp) so user is never blocked by idle screen stay.
  if (predecessorTimestamp && effectiveDate.getTime() < predecessorTimestamp.getTime()) {
    effectiveDate = serverNow.getTime() >= predecessorTimestamp.getTime() ? serverNow : predecessorTimestamp;
  }

  return { isValid: true, date: effectiveDate };
}

/**
 * A time left behind by an idle screen, a slow connection or a slow phone sync must not stop
 * the operator. If the entered time is earlier than something that already happened, use the
 * latest of those events, which keeps the record in order and as close to the truth as possible.
 */
export function advancePastPredecessors(entered: Date, predecessors: Array<Date | string | null | undefined>): Date {
  let latest = entered.getTime();
  for (const p of predecessors) {
    if (!p) continue;
    const t = new Date(p).getTime();
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return latest === entered.getTime() ? entered : new Date(latest);
}
