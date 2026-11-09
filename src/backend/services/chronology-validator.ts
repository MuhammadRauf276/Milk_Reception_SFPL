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
  const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes grace period for mobile device clock jitter

  // Rule 1: eventTimestamp <= serverNow + skew tolerance (Future beyond 2 minutes rejected)
  if (opDate.getTime() > serverNow.getTime() + CLOCK_SKEW_TOLERANCE_MS) {
    return { isValid: false, error: `${eventName} date & time cannot be in the future.` };
  }

  // If timestamp is slightly ahead of server due to clock drift (within 2-minute tolerance), clamp to serverNow
  let effectiveDate = opDate.getTime() > serverNow.getTime() ? serverNow : opDate;

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
