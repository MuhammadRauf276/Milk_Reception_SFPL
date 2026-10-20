'use client';

/**
 * Stage decision panel (Phase 4a, reused by P4b–d): each test as PASS / FAIL / WARN (colour + icon + word),
 * the system result, the person's ✓ ACCEPT / ✗ REJECT choice, a reason box when one is needed, and a
 * primary button whose text follows the decision route. The route is only a preview: the server decides.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Gavel, Loader2, MinusCircle, Send, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DecisionResult, DecisionRoute, ExceptionReason, PersonDecision } from '@/types/stage1-decision';

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
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  className?: string;
}

const OUTCOME_STYLE: Record<DecisionTestOutcome, { word: string; className: string; Icon: typeof CheckCircle2 }> = {
  PASS: { word: 'Pass', className: 'border-green-300 bg-green-50 text-green-800', Icon: CheckCircle2 },
  FAIL: { word: 'Fail', className: 'border-red-300 bg-red-50 text-red-800', Icon: XCircle },
  WARN: { word: 'Warning', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  NOT_TESTED: { word: 'Not tested', className: 'border-slate-300 bg-slate-50 text-slate-600', Icon: MinusCircle },
};

/** Simple English for each exception reason. */
export function exceptionReasonText(reason: ExceptionReason): string {
  if (reason === 'MISMATCH') return 'Your choice is different from the test result.';
  if (reason === 'PICTURE_MISSING') return 'A test picture is missing.';
  if (reason === 'MISSING_FIELD') return 'A must-do test is empty.';
  if (reason === 'AWAY_FROM_SHOP') return 'You are far from the shop.';
  if (reason.startsWith('RULE_FAIL:')) return `${reason.slice('RULE_FAIL:'.length)} failed the rule.`;
  return reason;
}

export function DecisionRulePanel({
  tests,
  decision,
  personDecision,
  onPersonDecisionChange,
  remarks,
  onRemarksChange,
  warnings = [],
  approverLabel = 'Zonal Manager',
  routeLabels,
  onSubmit,
  submitting = false,
  disabled = false,
  className,
}: DecisionRulePanelProps) {
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

  const buttonClass =
    route === 'REJECT'
      ? 'bg-red-700 hover:bg-red-800'
      : route === 'SEND_TO_APPROVER'
        ? 'bg-violet-700 hover:bg-violet-800'
        : route === 'DECIDE_NOW'
          ? 'bg-amber-700 hover:bg-amber-800'
          : 'bg-green-700 hover:bg-green-800';
  const ButtonIcon =
    route === 'REJECT' ? XCircle : route === 'SEND_TO_APPROVER' ? Send : route === 'DECIDE_NOW' ? Gavel : CheckCircle2;

  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-white p-3', className)}>
      {tests.length > 0 && (
        <ul className="space-y-1.5" aria-label="Test results">
          {tests.map((t) => {
            const s = OUTCOME_STYLE[t.outcome];
            return (
              <li key={t.key} className="flex items-start justify-between gap-2 rounded-lg border border-border px-2.5 py-2">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {t.name}
                    {t.valueText ? <span className="ml-1.5 font-normal text-slate-600 tabular-nums">{t.valueText}</span> : null}
                  </span>
                  {t.note && <span className="block text-xs text-slate-600">{t.note}</span>}
                </div>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                    s.className
                  )}
                >
                  <s.Icon className="h-4 w-4" aria-hidden="true" />
                  {s.word}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {decision && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold',
            decision.systemOutcome === 'PASS'
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          )}
        >
          {decision.systemOutcome === 'PASS' ? (
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          ) : (
            <XCircle className="h-5 w-5" aria-hidden="true" />
          )}
          <span>System result: {decision.systemOutcome === 'PASS' ? 'Tests passed' : 'Tests failed'}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-sm font-semibold text-foreground">Your decision</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Your decision">
          <button
            type="button"
            role="radio"
            aria-checked={personDecision === 'ACCEPT'}
            onClick={() => onPersonDecisionChange('ACCEPT')}
            disabled={disabled}
            className={cn(
              'flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition',
              personDecision === 'ACCEPT'
                ? 'border-green-700 bg-green-700 text-white'
                : 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
            )}
          >
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            <span>✓ ACCEPT</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={personDecision === 'REJECT'}
            onClick={() => onPersonDecisionChange('REJECT')}
            disabled={disabled}
            className={cn(
              'flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition',
              personDecision === 'REJECT'
                ? 'border-red-700 bg-red-700 text-white'
                : 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
            )}
          >
            <XCircle className="h-6 w-6" aria-hidden="true" />
            <span>✗ REJECT</span>
          </button>
        </div>
      </div>

      {personDecision && decision && decision.exceptionReasons.length > 0 && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            route === 'DECIDE_NOW' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-violet-300 bg-violet-50 text-violet-900'
          )}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            {route === 'DECIDE_NOW' ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Clock className="h-4 w-4" aria-hidden="true" />
            )}
            {route === 'DECIDE_NOW' ? 'Needs decision: you can decide it now.' : `This goes to the ${approverLabel}.`}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {decision.exceptionReasons.map((r) => (
              <li key={r}>{exceptionReasonText(r)}</li>
            ))}
          </ul>
        </div>
      )}

      {remarksNeeded && (
        <div>
          <label className="mb-1 block text-sm font-semibold text-foreground">
            Reason <span className="text-red-700">*</span>
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            placeholder="Write a short reason"
            className={cn(
              'w-full min-w-0 resize-y rounded-xl border p-2.5 text-sm focus:ring-2 focus:ring-primary',
              remarksMissing ? 'border-red-300 bg-red-50/40' : 'border-border bg-white'
            )}
          />
          {remarksMissing && <p className="mt-1 text-xs font-semibold text-red-700">Please write at least 3 letters.</p>}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className={cn(
          'flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold text-white shadow-xs transition disabled:opacity-50',
          route ? buttonClass : 'bg-slate-500'
        )}
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ButtonIcon className="h-5 w-5" aria-hidden="true" />}
        <span>{submitting ? 'Saving…' : route ? labels[route] : 'Tap ✓ ACCEPT or ✗ REJECT'}</span>
      </button>
    </div>
  );
}
