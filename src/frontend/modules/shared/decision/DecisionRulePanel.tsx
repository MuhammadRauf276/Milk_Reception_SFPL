'use client';

/**
 * Stage decision panel (Phase 4a, reused by P4b–d): each test as PASS / FAIL / WARN (colour + icon + word),
 * the system result, the person's Accept / Reject choice (large radio cards), exception reason chips,
 * a reason box when one is needed, and a primary button whose text and colour follow the decision route.
 * The route is only a preview: the server decides.
 *
 * Wizards that keep the button in a sticky footer pass `showSubmit={false}` and render
 * <DecisionSubmitButton> there with the same props.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, Gavel, Loader2, MinusCircle, Send, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DecisionResult, DecisionRoute, ExceptionReason, PersonDecision } from '@/types/stage1-decision';
import { exceptionReasonShort, exceptionReasonText as reasonSentence } from '@/lib/exceptionReasons';

export type DecisionTestOutcome = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED';

export interface DecisionRuleTestRow {
  key: string;
  name: string;
  outcome: DecisionTestOutcome;
  /** Shown next to the name, e.g. "28.5". */
  valueText?: string | null;
  /** Small hint under the row, e.g. "Picture missing". */
  note?: string | null;
}

export interface DecisionRulePanelProps {
  tests: DecisionRuleTestRow[];
  /** Live preview of the decision (null until there is enough to compute it). */
  decision: DecisionResult | null;
  personDecision: PersonDecision | null;
  onPersonDecisionChange: (d: PersonDecision) => void;
  remarks: string;
  onRemarksChange: (value: string) => void;
  warnings?: string[];
  /** Who receives exceptions, e.g. "Zonal Manager". */
  approverLabel?: string;
  /** Primary button text per route (defaults: Submit / Reject / Send to <approver> / Decide now). */
  routeLabels?: Partial<Record<DecisionRoute, string>>;
  /** Choice card text (defaults: Accept / Reject). */
  acceptLabel?: string;
  rejectLabel?: string;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  /** Hide the built-in submit button (the caller renders <DecisionSubmitButton> elsewhere). */
  showSubmit?: boolean;
  /** Hide the System result banner (e.g. when tests show live status on inputs). */
  hideSystemResult?: boolean;
  /** Hide the detailed test rules list. */
  hideTestList?: boolean;
  className?: string;
}

const OUTCOME_STYLE: Record<DecisionTestOutcome, { word: string; className: string; Icon: typeof CheckCircle2 }> = {
  PASS: { word: 'Pass', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  FAIL: { word: 'Fail', className: 'border-rose-300 bg-rose-50 text-rose-800', Icon: XCircle },
  WARN: { word: 'Warning', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  NOT_TESTED: { word: 'Not tested', className: 'border-border-strong bg-subtle text-secondary-foreground', Icon: MinusCircle },
};

const ROUTE_BUTTON: Record<DecisionRoute, { className: string; Icon: typeof CheckCircle2 }> = {
  PROCEED: { className: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs', Icon: CheckCircle2 },
  REJECT: { className: 'bg-rose-600 hover:bg-rose-700', Icon: XCircle },
  SEND_TO_APPROVER: { className: 'bg-neutral-800 hover:bg-neutral-900', Icon: Send },
  DECIDE_NOW: { className: 'bg-amber-700 hover:bg-amber-800', Icon: Gavel },
};

/** Simple English for each exception reason. */
export function exceptionReasonText(reason: ExceptionReason): string {
  return reasonSentence(reason);
}

/** Short chip text for each exception reason. */
export function exceptionReasonChip(reason: ExceptionReason): string {
  return exceptionReasonShort(reason);
}

type SubmitProps = Pick<
  DecisionRulePanelProps,
  'decision' | 'personDecision' | 'approverLabel' | 'routeLabels' | 'onSubmit' | 'submitting' | 'disabled' | 'className'
>;

function submitState({ decision, personDecision, approverLabel = 'Zonal Manager', routeLabels, submitting, disabled }: SubmitProps) {
  const route = personDecision && decision ? decision.route : null;
  const labels: Record<DecisionRoute, string> = {
    PROCEED: 'Submit',
    REJECT: 'Reject',
    SEND_TO_APPROVER: `Send to ${approverLabel}`,
    DECIDE_NOW: 'Decide now',
    ...routeLabels,
  };
  const remarksNeeded = Boolean(personDecision && decision?.remarksRequired);
  const remarksMissing = remarksNeeded && !decision?.remarksOk;
  const canSubmit = Boolean(route) && !remarksMissing && !submitting && !disabled;
  return { route, labels, remarksNeeded, remarksMissing, canSubmit };
}

/** The route-coloured primary button (56px). */
export function DecisionSubmitButton(props: SubmitProps) {
  const { route, labels, canSubmit } = submitState(props);
  const style = route ? ROUTE_BUTTON[route] : null;
  const Icon = style?.Icon ?? Circle;
  return (
    <button
      type="button"
      onClick={props.onSubmit}
      disabled={!canSubmit}
      className={cn(
        'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold text-white shadow-xs transition disabled:opacity-50',
        style ? style.className : 'bg-neutral-400',
        props.className
      )}
    >
      {props.submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Icon className="h-5 w-5" aria-hidden="true" />}
      <span>{props.submitting ? 'Saving…' : route ? labels[route] : 'Choose Accept or Reject'}</span>
    </button>
  );
}

export function DecisionRulePanel(props: DecisionRulePanelProps) {
  const {
    tests,
    decision,
    personDecision,
    onPersonDecisionChange,
    remarks,
    onRemarksChange,
    warnings = [],
    approverLabel = 'Zonal Manager',
    acceptLabel = 'Accept',
    rejectLabel = 'Reject',
    disabled = false,
    showSubmit = true,
    hideSystemResult = false,
    hideTestList = false,
    className,
  } = props;
  const { route, remarksNeeded, remarksMissing } = submitState(props);

  const choice = (value: PersonDecision) => {
    const accept = value === 'ACCEPT';
    const checked = personDecision === value;
    const Icon = accept ? CheckCircle2 : XCircle;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={() => onPersonDecisionChange(value)}
        disabled={disabled}
        className={cn(
          'flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-base font-semibold transition disabled:opacity-50',
          checked
            ? accept
              ? 'border-emerald-600 bg-emerald-600 text-white ring-2 ring-emerald-600 ring-offset-2 hover:bg-emerald-700'
              : 'border-rose-600 bg-rose-600 text-white ring-2 ring-rose-600 ring-offset-2 hover:bg-rose-700'
            : accept
              ? 'border-emerald-300 bg-card text-emerald-800 hover:bg-emerald-50'
              : 'border-rose-300 bg-card text-rose-800 hover:bg-rose-50'
        )}
      >
        <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
        <span>{accept ? acceptLabel : rejectLabel}</span>
      </button>
    );
  };

  return (
    <div className={cn('space-y-4 rounded-2xl border border-border bg-card p-3', className)}>
      {decision && !hideSystemResult && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-base font-semibold',
            decision.systemOutcome === 'PASS'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-rose-300 bg-rose-50 text-rose-900'
          )}
        >
          {decision.systemOutcome === 'PASS' ? (
            <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="h-6 w-6 shrink-0" aria-hidden="true" />
          )}
          <span>System result: {decision.systemOutcome === 'PASS' ? 'Tests passed' : 'Tests failed'}</span>
        </div>
      )}

      {tests.length > 0 && !hideTestList && (
        <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Test results">
          {tests.map((t) => {
            const s = OUTCOME_STYLE[t.outcome];
            return (
              <li key={t.key} className="flex min-h-12 items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {t.name}
                    {t.valueText ? <span className="ml-2 font-normal tabular-nums text-secondary-foreground">{t.valueText}</span> : null}
                  </span>
                  {t.note && <span className="block text-xs font-semibold text-amber-800">{t.note}</span>}
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1 text-xs font-semibold', s.className)}>
                  <s.Icon className="h-4 w-4" aria-hidden="true" />
                  {s.word}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-amber-900">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Your decision</p>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2" role="radiogroup" aria-label="Your decision">
          {choice('ACCEPT')}
          {choice('REJECT')}
        </div>
      </div>

      {personDecision && decision && decision.exceptionReasons.length > 0 && (
        <div
          className={cn(
            'space-y-2 rounded-xl border px-3 py-2',
            route === 'DECIDE_NOW' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border bg-muted text-foreground'
          )}
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            {route === 'DECIDE_NOW' ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
            {route === 'DECIDE_NOW' ? 'Needs decision: you can decide it now.' : `This goes to the ${approverLabel}.`}
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="Exception reasons">
            {decision.exceptionReasons.map((r) => (
              <li
                key={r}
                title={exceptionReasonText(r)}
                className={cn(
                  'rounded-md border bg-card px-3 py-1 text-xs font-semibold',
                  route === 'DECIDE_NOW' ? 'border-amber-300' : 'border-border'
                )}
              >
                {exceptionReasonChip(r)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {remarksNeeded && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-foreground">
            Reason <span className="text-rose-700">(required)</span>
          </label>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            placeholder="Write a short reason…"
            className={cn(
              'min-h-12 w-full min-w-0 resize-y rounded-lg border-2 p-3 text-base focus:outline-none focus:ring-2 focus:ring-border',
              remarksMissing ? 'border-rose-300 bg-rose-50/40' : 'border-border-strong bg-card'
            )}
          />
          {remarksMissing && <p className="mt-1 text-sm font-semibold text-rose-700">Please write at least 3 letters.</p>}
        </div>
      )}

      {showSubmit && <DecisionSubmitButton {...props} className={undefined} />}
    </div>
  );
}
