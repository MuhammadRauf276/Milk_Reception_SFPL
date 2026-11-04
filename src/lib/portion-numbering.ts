/**
 * Portion numbering. Display labels and stored numbers are always 1..N in list order.
 * Used by the unsaved-list screens (label from position) and by the server when a saved,
 * still-pending portion is removed.
 */

export interface NumberedPortion {
  id: string;
  portionNumber: number;
  /** True once the portion carries a decision or other history that must keep its number. */
  locked: boolean;
}

/** Label for the portion at a zero-based list position. */
export function portionLabelForIndex(index: number, total: number, composite = false): string {
  if (composite && total === 1) return 'Composite Sample';
  return `Portion ${index + 1}`;
}

/** Renumber a plain list of unsaved items 1..N in their current order. */
export function renumberByPosition<T extends { portionNumber: number }>(items: readonly T[]): T[] {
  return items.map((item, i) => ({ ...item, portionNumber: i + 1 }));
}

/**
 * After `removedId` is deleted, work out which saved portions move down to close the gap.
 * Portions are renumbered only when nothing after the gap is locked; otherwise every number
 * stays as stored, so decisions, audit entries and printed documents keep pointing at the
 * same portion. Updates come back lowest number first so each move lands on a free number.
 */
export function planRenumberAfterRemoval(
  portions: readonly NumberedPortion[],
  removedId: string,
): { renumbered: boolean; updates: Array<{ id: string; portionNumber: number }> } {
  const remaining = portions
    .filter((p) => p.id !== removedId)
    .sort((a, b) => a.portionNumber - b.portionNumber);
  const updates: Array<{ id: string; portionNumber: number }> = [];
  remaining.forEach((p, i) => {
    if (p.portionNumber !== i + 1) updates.push({ id: p.id, portionNumber: i + 1 });
  });
  if (updates.length === 0) return { renumbered: false, updates };
  const lockedMoves = updates.some((u) => remaining.find((p) => p.id === u.id)?.locked);
  if (lockedMoves) return { renumbered: false, updates: [] };
  return { renumbered: true, updates };
}
