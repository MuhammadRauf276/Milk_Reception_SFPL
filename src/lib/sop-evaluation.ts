/**
 * Universal 3-Zone SOP Decision Evaluator for Milk Reception Quality Operations.
 * Pure TypeScript, safe for both browser and Node.js runtimes.
 *
 * Zones:
 *  - Zone 1: PASS (Automatic Release) -> Value within standard spec [min, max]
 *  - Zone 2: WARN (Tolerance Hold) -> Value in tolerance margin [warnLow, min) | (max, warnHigh]
 *            Does NOT auto-reject. Requires officer review. Deduplicates per vehicle.
 *  - Zone 3: FAIL (Rejection Recommendation) -> Value violates rejection threshold (< warnLow or > warnHigh)
 *  - MONITORING: Observation only (yield/pricing), never rejects milk.
 */

export interface SopRuleDefinition {
  min?: number | null;
  max?: number | null;
  warningTrigger?: string | null;      // e.g. "10 – 12" or "6.60 – 6.64 | 6.96 – 7.00"
  decisionConsequence?: string | null; // e.g. "< 0 or > 12"
  acceptableOption?: string | null;    // e.g. "NEGATIVE" or "OK"
  category?: 'RELEASE' | 'MONITORING' | string | null;
  ruleCategory?: string | null;
  testMode?: 'COMPULSORY' | 'OPTIONAL' | 'APPLIED' | 'OFF' | string | null;
  resultType?: string | null;
  resultOptions?: Array<{ value: string; label?: string; isPassing?: boolean | null; outcome?: 'PASS' | 'WARNING' | 'FAIL' }> | null;
  unit?: string | null;
}

export interface SopEvaluationResult {
  verdict: 'PASS' | 'WARN' | 'FAIL' | 'MONITORING' | 'NOT_APPLIED';
  label: string;
  message: string;
  isRuleFailure: boolean; // True ONLY if test is compulsory RELEASE and violates hard rejection threshold
  isWarning: boolean;     // True if reading is in tolerance margin (Zone 2)
  isPass: boolean;
  colorClass: {
    badge: string;
    text: string;
    border: string;
    dot: string;
  };
}

/**
 * Extracts outer low and high warning boundaries from warningTrigger or decisionConsequence.
 * Examples:
 *  - "0 – 0 | 10 – 12" with min=0, max=10 -> warnLow=0, warnHigh=12
 *  - "10 – 12" with min=0, max=10 -> warnLow=0, warnHigh=12
 *  - "< 0 or > 12" -> rejectLow=0, rejectHigh=12
 */
export function parseToleranceBoundaries(
  min: number | null,
  max: number | null,
  warningTrigger?: string | null,
  decisionConsequence?: string | null
): { warnLow: number | null; warnHigh: number | null; rejectLow: number | null; rejectHigh: number | null } {
  let warnLow = min;
  let warnHigh = max;
  let rejectLow = min;
  let rejectHigh = max;

  if (warningTrigger && warningTrigger !== '—') {
    const nums = warningTrigger.match(/([0-9]+(?:\.[0-9]+)?)/g);
    if (nums && nums.length > 0) {
      const parsed = nums.map(Number);
      const minFound = Math.min(...parsed);
      const maxFound = Math.max(...parsed);

      if (min !== null && minFound < min) warnLow = minFound;
      if (max !== null && maxFound > max) warnHigh = maxFound;
    }
  }

  if (decisionConsequence && decisionConsequence !== '—') {
    const nums = decisionConsequence.match(/([0-9]+(?:\.[0-9]+)?)/g);
    if (nums && nums.length > 0) {
      const parsed = nums.map(Number);
      rejectLow = Math.min(...parsed);
      rejectHigh = Math.max(...parsed);
      if (warnLow === null || (rejectLow !== null && rejectLow < warnLow)) warnLow = rejectLow;
      if (warnHigh === null || (rejectHigh !== null && rejectHigh > warnHigh)) warnHigh = rejectHigh;
    }
  }

  return { warnLow, warnHigh, rejectLow, rejectHigh };
}

/**
 * Evaluates a single lab reading against 3-Zone SOP rules.
 */
export function evaluate3ZoneTest(
  ruleDef: SopRuleDefinition,
  rawInput: unknown
): SopEvaluationResult {
  const isAppliedOnly = ruleDef.testMode === 'OPTIONAL' || ruleDef.testMode === 'APPLIED';
  const isMonitoring = ruleDef.category === 'MONITORING' || ruleDef.ruleCategory === 'MONITORING';

  if (rawInput === null || rawInput === undefined || String(rawInput).trim() === '') {
    return {
      verdict: 'PASS',
      label: 'Pending Entry',
      message: 'Awaiting observation entry.',
      isRuleFailure: false,
      isWarning: false,
      isPass: true,
      colorClass: {
        badge: 'bg-slate-100 text-slate-700 border-slate-200',
        text: 'text-slate-600',
        border: 'border-slate-200',
        dot: 'bg-slate-400',
      },
    };
  }

  // Monitoring Norms NEVER reject or fail
  if (isMonitoring) {
    return {
      verdict: 'MONITORING',
      label: 'Monitoring Norm',
      message: 'Quality observation recorded for yield and pricing. Does not trigger hold or rejection.',
      isRuleFailure: false,
      isWarning: false,
      isPass: true,
      colorClass: {
        badge: 'bg-purple-50 text-purple-800 border-purple-200',
        text: 'text-purple-700',
        border: 'border-purple-200',
        dot: 'bg-purple-500',
      },
    };
  }

  // Applied / Non-Compulsory tests do not enforce system failures
  if (isAppliedOnly) {
    return {
      verdict: 'NOT_APPLIED',
      label: 'Optional Test',
      message: 'Not under compulsory release SOP. Rules are not enforced.',
      isRuleFailure: false,
      isWarning: false,
      isPass: true,
      colorClass: {
        badge: 'bg-slate-100 text-slate-700 border-slate-200',
        text: 'text-slate-600',
        border: 'border-slate-200',
        dot: 'bg-slate-400',
      },
    };
  }

  const rawStr = String(rawInput).trim();
  const numVal = Number(rawStr);
  const isNumeric = (ruleDef.resultType === 'NUMERIC' || ruleDef.resultType === 'CALCULATED') && !isNaN(numVal);

  // NUMERIC 3-ZONE EVALUATION
  if (isNumeric) {
    const min = ruleDef.min !== undefined && ruleDef.min !== null ? Number(ruleDef.min) : null;
    const max = ruleDef.max !== undefined && ruleDef.max !== null ? Number(ruleDef.max) : null;

    // Parse tolerance boundaries
    const { warnLow, warnHigh } = parseToleranceBoundaries(
      min,
      max,
      ruleDef.warningTrigger,
      ruleDef.decisionConsequence
    );

    // 1. Zone 1: PASS
    const inPass = (min === null || numVal >= min) && (max === null || numVal <= max);
    if (inPass) {
      return {
        verdict: 'PASS',
        label: 'Pass (Release)',
        message: 'Within SOP standard specification.',
        isRuleFailure: false,
        isWarning: false,
        isPass: true,
        colorClass: {
          badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          text: 'text-emerald-700',
          border: 'border-emerald-300',
          dot: 'bg-emerald-500',
        },
      };
    }

    // 2. Zone 2: TOLERANCE WARNING HOLD
    const inLowWarn = warnLow !== null && min !== null && numVal >= warnLow && numVal < min;
    const inHighWarn = warnHigh !== null && max !== null && numVal > max && numVal <= warnHigh;

    if (inLowWarn || inHighWarn) {
      const marginDesc = inHighWarn
        ? `(${max} to ${warnHigh}${ruleDef.unit ? ` ${ruleDef.unit}` : ''}]`
        : `[${warnLow} to ${min}${ruleDef.unit ? ` ${ruleDef.unit}` : ''})`;

      return {
        verdict: 'WARN',
        label: 'Tolerance Warning',
        message: `In tolerance margin ${marginDesc}.`,
        isRuleFailure: false, // NOT a system rejection!
        isWarning: true,
        isPass: false,
        colorClass: {
          badge: 'bg-amber-50 text-amber-900 border-amber-300',
          text: 'text-amber-800',
          border: 'border-amber-400',
          dot: 'bg-amber-500',
        },
      };
    }

    // 3. Zone 3: REJECTION RECOMMENDATION
    const rejectDesc = max !== null && numVal > (warnHigh ?? max)
      ? `> ${warnHigh ?? max}${ruleDef.unit ? ` ${ruleDef.unit}` : ''}`
      : min !== null && numVal < (warnLow ?? min)
      ? `< ${warnLow ?? min}${ruleDef.unit ? ` ${ruleDef.unit}` : ''}`
      : 'Outside acceptable limits';

    return {
      verdict: 'FAIL',
      label: 'Rejection Limit',
      message: `Exceeds rejection limit (${rejectDesc}).`,
      isRuleFailure: true,
      isWarning: false,
      isPass: false,
      colorClass: {
        badge: 'bg-rose-50 text-rose-900 border-rose-300',
        text: 'text-rose-700',
        border: 'border-rose-400',
        dot: 'bg-rose-500',
      },
    };
  }

  // CATEGORICAL / QUALITATIVE 3-ZONE EVALUATION
  const inputUpper = rawStr.toUpperCase();
  const options = ruleDef.resultOptions || [];

  const matchedOpt = options.find(
    (o) => o.value.toUpperCase() === inputUpper || (o.label && o.label.toUpperCase() === inputUpper)
  );

  if (matchedOpt) {
    const outcome = matchedOpt.outcome || (matchedOpt.isPassing === true ? 'PASS' : matchedOpt.isPassing === false ? 'FAIL' : 'WARNING');

    if (outcome === 'PASS') {
      return {
        verdict: 'PASS',
        label: 'Pass (Acceptable)',
        message: `"${matchedOpt.label || matchedOpt.value}" meets acceptance criteria.`,
        isRuleFailure: false,
        isWarning: false,
        isPass: true,
        colorClass: {
          badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          text: 'text-emerald-700',
          border: 'border-emerald-300',
          dot: 'bg-emerald-500',
        },
      };
    }

    if (outcome === 'WARNING') {
      return {
        verdict: 'WARN',
        label: 'Tolerance Warning',
        message: `"${matchedOpt.label || matchedOpt.value}" is in warning tolerance.`,
        isRuleFailure: false,
        isWarning: true,
        isPass: false,
        colorClass: {
          badge: 'bg-amber-50 text-amber-900 border-amber-300',
          text: 'text-amber-800',
          border: 'border-amber-400',
          dot: 'bg-amber-500',
        },
      };
    }

    return {
      verdict: 'FAIL',
      label: 'Rejection Choice',
      message: `"${matchedOpt.label || matchedOpt.value}" triggers system rejection.`,
      isRuleFailure: true,
      isWarning: false,
      isPass: false,
      colorClass: {
        badge: 'bg-rose-50 text-rose-900 border-rose-300',
        text: 'text-rose-700',
        border: 'border-rose-400',
        dot: 'bg-rose-500',
      },
    };
  }

  // Fallback string matching against acceptableOption
  const acceptable = (ruleDef.acceptableOption || 'PASS').toUpperCase();
  if (inputUpper === acceptable || inputUpper === 'OK' || inputUpper === 'PASS' || inputUpper === 'NEGATIVE') {
    return {
      verdict: 'PASS',
      label: 'Pass (Acceptable)',
      message: 'Result matches acceptable specification.',
      isRuleFailure: false,
      isWarning: false,
      isPass: true,
      colorClass: {
        badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        dot: 'bg-emerald-500',
      },
    };
  }

  // Check if matches warningTrigger
  const warnTrigger = (ruleDef.warningTrigger || '').toUpperCase();
  if (warnTrigger && warnTrigger !== '—' && inputUpper === warnTrigger) {
    return {
      verdict: 'WARN',
      label: 'Tolerance Warning',
      message: `Result matches warning condition "${ruleDef.warningTrigger}".`,
      isRuleFailure: false,
      isWarning: true,
      isPass: false,
      colorClass: {
        badge: 'bg-amber-50 text-amber-900 border-amber-300',
        text: 'text-amber-800',
        border: 'border-amber-400',
        dot: 'bg-amber-500',
      },
    };
  }

  return {
    verdict: 'FAIL',
    label: 'Rejection Choice',
    message: 'Result violates acceptable specification.',
    isRuleFailure: true,
    isWarning: false,
    isPass: false,
    colorClass: {
      badge: 'bg-rose-50 text-rose-900 border-rose-300',
      text: 'text-rose-700',
      border: 'border-rose-400',
      dot: 'bg-rose-500',
    },
  };
}
