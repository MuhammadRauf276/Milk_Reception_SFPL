/**
 * Text for the small "SOP ..." chip on a test card.
 * Everything comes from the saved Super Admin rule for that test and stage: nothing is guessed
 * from test names or codes, and a missing rule gives no chip at all.
 */

export interface SopChipInput {
  resultType?: string | null;
  min?: number | null;
  max?: number | null;
  /** Options the rule accepts, as saved on the rule. */
  allowed?: ReadonlyArray<string> | null;
  /** The test's own answer list, used to show the label and to ignore values it does not offer. */
  options?: ReadonlyArray<string | { value: string; label?: string | null }> | null;
}

const NUMERIC_TYPES = new Set(['NUMERIC', 'CALCULATED']);

export function isNumericResultType(resultType?: string | null): boolean {
  return NUMERIC_TYPES.has((resultType ?? 'NUMERIC').toUpperCase());
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** "26.0 – 32.0", "≥ 3.5", "≤ 3.5", or null. Always null for a categorical test. */
export function numericSopRange(input: SopChipInput): string | null {
  if (!isNumericResultType(input.resultType)) return null;
  const min = input.min ?? null;
  const max = input.max ?? null;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `≥ ${fmt(min)}`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

function acceptedLabels(input: SopChipInput): string[] {
  const allowed = (input.allowed ?? []).map((a) => a.trim()).filter(Boolean);
  const options = (input.options ?? []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value },
  );
  // Without the test's own answer list there is nothing to check the rule against.
  if (allowed.length === 0 || options.length === 0) return [];
  const labels: string[] = [];
  for (const a of allowed) {
    const hit = options.find((o) => o.value.trim().toUpperCase() === a.toUpperCase() || o.label.trim().toUpperCase() === a.toUpperCase());
    if (hit && !labels.includes(hit.label)) labels.push(hit.label);
  }
  return labels;
}

/** "SOP 0.07 – 0.16" for a numeric test, "SOP: Negative" for a categorical one, null when nothing is configured. */
export function buildSopChipText(input: SopChipInput): string | null {
  if (isNumericResultType(input.resultType)) {
    const range = numericSopRange(input);
    return range ? `SOP ${range}` : null;
  }
  const labels = acceptedLabels(input);
  return labels.length > 0 ? `SOP: ${labels.join(', ')}` : null;
}
