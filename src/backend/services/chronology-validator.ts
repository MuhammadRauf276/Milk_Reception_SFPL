/**
 * Centralized Operational Timestamp Chronology Engine
 * Strictly enforces exact operational chronology across all vehicle reception workflow events.
 * 
 * Rules:
 * 1. eventTimestamp <= serverNow (Exact server time; zero artificial clock-skew allowance).
 * 2. eventTimestamp >= predecessorTimestamp (Exact predecessor timestamp; equal timestamps allowed, 1ms earlier rejected).
 * 3. Predecessor timestamps are fetched authoritatively from database by backend.
 */

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

  // Rule 1: eventTimestamp <= serverNow (Strict equality or past allowed, future rejected)
  if (opDate.getTime() > serverNow.getTime()) {
    return { isValid: false, error: `${eventName} date & time cannot be in the future.` };
  }

  // Rule 2: eventTimestamp >= predecessorTimestamp (Strict equality or later allowed, earlier rejected)
  if (predecessorTimestamp && opDate.getTime() < predecessorTimestamp.getTime()) {
    const predFormatted = predecessorTimestamp.toISOString();
    return {
      isValid: false,
      error: `${eventName} time cannot be earlier than ${predecessorName} (${predFormatted}).`,
    };
  }

  return { isValid: true, date: opDate };
}
