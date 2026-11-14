// Why a record was sent for approval, in plain words. One list for every screen and the approval inbox,
// so a request sent for a missing picture reads "Test picture missing" everywhere.

/** Looks up a test's name from its code (RULE_FAIL:<code>). Returns the code when the name is unknown. */
export type TestNameOf = (code: string) => string;

const sameCode: TestNameOf = (code) => code;

/** Full sentence, for the detail of a request. */
export function exceptionReasonText(reason: string, nameOf: TestNameOf = sameCode): string {
  if (reason.startsWith('RULE_FAIL:')) return `${nameOf(reason.slice('RULE_FAIL:'.length))} is outside the SOP range.`;
  if (reason.startsWith('PICTURE_MISSING:') || reason.startsWith('PHOTO_MISSING:')) {
    const raw = reason.slice(reason.indexOf(':') + 1).trim();
    const name = raw ? nameOf(raw) : '';
    return name ? `Required picture is missing for ${name}.` : 'A required test picture is missing.';
  }
  switch (reason) {
    case 'MISMATCH':
    case 'DECISION_MISMATCH':
      return 'The person’s decision differs from the test result.';
    case 'PICTURE_MISSING':
    case 'PHOTO_MISSING':
      return 'A required test picture is missing.';
    case 'MISSING_FIELD':
    case 'COMPULSORY_TEST_MISSING':
      return 'A compulsory test was not done.';
    case 'LAB_REPORT_MISSING':
      return 'The picture of the hand-written lab report is missing.';
    case 'AWAY_FROM_SHOP':
    case 'GEOFENCE':
    case 'OUTSIDE_GEOFENCE':
      return 'Collected away from the shop’s location.';
    case 'SEAL_MISMATCH':
      return 'The seal number at the plant differs from the dispatch seal.';
    case 'SEAL_REQUIRED':
      return 'A seal number is required.';
    case 'SEAL_DUPLICATE':
      return 'This seal number is already used.';
    case 'UNAPPROVED':
      return 'The supplier is not approved yet.';
    case 'OVERRIDE':
      return 'The person overrode the system decision.';
    default:
      return sentence(reason);
  }
}

/** Short label, for chips and list rows. */
export function exceptionReasonShort(reason: string, nameOf: TestNameOf = sameCode): string {
  if (reason.startsWith('RULE_FAIL:')) return `${nameOf(reason.slice('RULE_FAIL:'.length))} out of range`;
  if (reason.startsWith('PICTURE_MISSING:') || reason.startsWith('PHOTO_MISSING:')) {
    const raw = reason.slice(reason.indexOf(':') + 1).trim();
    const name = raw ? nameOf(raw) : '';
    return name ? `${name} picture missing` : 'Picture missing';
  }
  switch (reason) {
    case 'MISMATCH':
    case 'DECISION_MISMATCH':
      return 'Decision differs from result';
    case 'PICTURE_MISSING':
    case 'PHOTO_MISSING':
      return 'Picture missing';
    case 'MISSING_FIELD':
    case 'COMPULSORY_TEST_MISSING':
      return 'Compulsory test not done';
    case 'LAB_REPORT_MISSING':
      return 'Lab report picture missing';
    case 'AWAY_FROM_SHOP':
    case 'GEOFENCE':
    case 'OUTSIDE_GEOFENCE':
      return 'Away from shop';
    case 'SEAL_MISMATCH':
      return 'Seal mismatch';
    case 'SEAL_REQUIRED':
      return 'Seal missing';
    case 'SEAL_DUPLICATE':
      return 'Seal already used';
    case 'UNAPPROVED':
      return 'Supplier not approved';
    case 'OVERRIDE':
      return 'Decision overridden';
    default:
      return sentence(reason);
  }
}

/** Tag for a card: three words or fewer. The test names are in the full sentence. */
export function exceptionReasonLabel(reason: string): string {
  if (reason.startsWith('RULE_FAIL:')) return 'Out of range';
  if (reason.startsWith('PICTURE_MISSING:') || reason.startsWith('PHOTO_MISSING:')) return 'Picture missing';
  switch (reason) {
    case 'MISMATCH':
    case 'DECISION_MISMATCH':
      return 'Decision differs';
    case 'PICTURE_MISSING':
    case 'PHOTO_MISSING':
      return 'Picture missing';
    case 'MISSING_FIELD':
    case 'COMPULSORY_TEST_MISSING':
      return 'Test not done';
    case 'LAB_REPORT_MISSING':
      return 'Lab report missing';
    default: {
      const short = exceptionReasonShort(reason);
      return short.split(/\s+/).length <= 3 ? short : short.split(/\s+/).slice(0, 3).join(' ');
    }
  }
}

/** Tags for a list of reason codes; a repeated tag shows its count. */
export function reasonLabels(codes: string[]): string[] {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const label = exceptionReasonLabel(c);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, n]) => (n > 1 ? `${label} ×${n}` : label));
}

/** Reason codes from a stored JSON value, without duplicates. */
export function reasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((r): r is string => typeof r === 'string' && r.trim() !== '')));
}

/** A test-name lookup built from stored test rows ({ testCode, testName }). */
export function testNameLookup(tests: ReadonlyArray<{ testCode?: string | null; testName?: string | null }>): TestNameOf {
  const names = new Map<string, string>();
  for (const t of tests) if (t.testCode && t.testName) names.set(t.testCode, t.testName);
  return (code) => names.get(code) ?? code;
}

function sentence(code: string): string {
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other reason';
}

/** One sentence per stored reason. `tests` is the stored test list ({ testCode, testName }), used for test names. */
export function reasonSentences(reasons: unknown, tests?: unknown): string[] {
  const rows = Array.isArray(tests) ? (tests.filter((t) => t && typeof t === 'object') as Array<{ testCode?: string; testName?: string }>) : [];
  const nameOf = testNameLookup(rows);
  return Array.from(new Set(reasonCodes(reasons).map((c) => exceptionReasonText(c, nameOf))));
}

/** Tests stored in a decision-details JSON: `tests`, or `portions[].tests` for a dispatch. */
export function storedDecisionTests(details: unknown): unknown[] {
  if (!details || typeof details !== 'object') return [];
  const d = details as { tests?: unknown; portions?: Array<{ tests?: unknown }> };
  if (Array.isArray(d.tests)) return d.tests;
  if (Array.isArray(d.portions)) return d.portions.flatMap((p) => (Array.isArray(p?.tests) ? p.tests : []));
  return [];
}
