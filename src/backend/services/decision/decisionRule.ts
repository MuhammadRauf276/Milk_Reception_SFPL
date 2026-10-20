// Stage 1 decision rule (pure): system outcome vs the person's decision -> route. No db, safe for the browser.
import type { DecisionInput, DecisionResult, ExceptionReason } from '@/types/stage1-decision';

const MIN_REMARKS_LENGTH = 3;

export function evaluateDecision(i: DecisionInput): DecisionResult {
  const systemPass = i.ruleFailures.length === 0 && i.missingCompulsory.length === 0;
  const systemOutcome = systemPass ? 'PASS' : 'FAIL';

  // Reasons that explain a system FAIL; they only count as exceptions when something else is also off.
  const failReasons: ExceptionReason[] = [];
  if (i.missingCompulsory.length > 0) failReasons.push('MISSING_FIELD');
  for (const code of i.ruleFailures) failReasons.push(`RULE_FAIL:${code}`);

  const otherReasons: ExceptionReason[] = [];
  const mismatch = (systemPass && i.personDecision === 'REJECT') || (!systemPass && i.personDecision === 'ACCEPT');
  if (mismatch) otherReasons.push('MISMATCH');
  if (i.missingPhotos.length > 0) otherReasons.push('PICTURE_MISSING');
  for (const r of i.extraReasons ?? []) if (!otherReasons.includes(r)) otherReasons.push(r);

  const remarksText = (i.remarks ?? '').trim();
  const finish = (
    r: Omit<DecisionResult, 'systemOutcome' | 'remarksRequired' | 'remarksOk'>,
    remarksRequired: boolean
  ): DecisionResult => ({
    ...r,
    systemOutcome,
    remarksRequired,
    remarksOk: !remarksRequired || remarksText.length >= MIN_REMARKS_LENGTH,
  });

  if (otherReasons.length === 0) {
    if (i.personDecision === 'ACCEPT') {
      return finish({ route: 'PROCEED', exceptionReasons: [], finalDecision: 'ACCEPTED', reviewStatus: 'NONE' }, false);
    }
    // REJECT and the system also failed: a plain rejection.
    return finish({ route: 'REJECT', exceptionReasons: [], finalDecision: 'REJECTED', reviewStatus: 'NONE' }, true);
  }

  const reasons = [...otherReasons, ...failReasons.filter((r) => !otherReasons.includes(r))];
  if (i.deciderCanApprove) {
    const accept = i.personDecision === 'ACCEPT';
    return finish(
      {
        route: 'DECIDE_NOW',
        exceptionReasons: reasons,
        finalDecision: accept ? 'ACCEPTED' : 'REJECTED',
        reviewStatus: accept ? 'APPROVED' : 'REJECTED',
      },
      true
    );
  }
  return finish({ route: 'SEND_TO_APPROVER', exceptionReasons: reasons, finalDecision: 'PENDING', reviewStatus: 'PENDING' }, true);
}
