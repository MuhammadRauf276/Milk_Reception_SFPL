/**
 * The time to save a shop collection under. A wrong phone clock must not stop milk being recorded, so a time outside
 * the journey moves to the nearest possible moment and is flagged, instead of being refused.
 */
export function resolveCollectionTime(i: {
  phoneTime: Date;
  now: Date;
  startedAt: Date;
  endedAt?: Date | null;
  cancelledAt?: Date | null;
}): { collectedAt: Date; corrected: boolean } {
  // The same small allowance for clock drift the server has always given.
  const FIVE_MINUTES = 5 * 60 * 1000;
  const start = i.startedAt.getTime();
  const phone = i.phoneTime.getTime();
  const closedAt = [i.endedAt, i.cancelledAt].filter((d): d is Date => d != null).map((d) => d.getTime());
  const latest = Math.max(start, Math.min(i.now.getTime() + FIVE_MINUTES, ...closedAt));

  if (phone < start) return { collectedAt: new Date(start), corrected: true };
  if (phone > latest) {
    const closedLimit = closedAt.length > 0 ? Math.min(...closedAt) : Infinity;
    return { collectedAt: new Date(Math.max(start, Math.min(i.now.getTime(), closedLimit))), corrected: true };
  }
  return { collectedAt: i.phoneTime, corrected: false };
}
