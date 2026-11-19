import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import { dispatchNeedsApproval } from '@/backend/services/dispatchScope';

const base = { ruleFailures: [] as string[], missingCompulsory: [] as string[], missingPhotos: [] as string[], remarks: '', deciderCanApprove: false };

test('a clear dispatch from the ZMCC lab attendant goes straight through', () => {
  const d = evaluateDecision({ ...base, personDecision: 'ACCEPT' });
  assert.equal(d.route, 'PROCEED');
  assert.equal(dispatchNeedsApproval({ action: 'SUBMIT', route: d.route, canDirectlyApprove: false }), false);
});

test('a clear dispatch rejection (test failed, person rejects) is not sent up', () => {
  const d = evaluateDecision({ ...base, ruleFailures: ['FAT'], personDecision: 'REJECT', remarks: 'low fat' });
  assert.equal(d.route, 'REJECT');
  assert.equal(dispatchNeedsApproval({ action: 'SUBMIT', route: d.route, canDirectlyApprove: false }), false);
});

test('a dispatch against the system, or with a missing picture, waits for the manager', () => {
  const mismatch = evaluateDecision({ ...base, ruleFailures: ['FAT'], personDecision: 'ACCEPT', remarks: 'retested' });
  assert.equal(mismatch.route, 'SEND_TO_APPROVER');
  assert.equal(dispatchNeedsApproval({ action: 'SUBMIT', route: mismatch.route, canDirectlyApprove: false }), true);
  const noPicture = evaluateDecision({ ...base, missingPhotos: ['Fat'], personDecision: 'ACCEPT', remarks: 'camera broke' });
  assert.equal(dispatchNeedsApproval({ action: 'SUBMIT', route: noPicture.route, canDirectlyApprove: false }), true);
});

test('a manager deciding an exception does not send it to themselves; anyone can still choose to send a request', () => {
  const d = evaluateDecision({ ...base, ruleFailures: ['FAT'], personDecision: 'ACCEPT', remarks: 'ok', deciderCanApprove: true });
  assert.equal(d.route, 'DECIDE_NOW');
  assert.equal(dispatchNeedsApproval({ action: 'SUBMIT', route: d.route, canDirectlyApprove: true }), false);
  assert.equal(dispatchNeedsApproval({ action: 'SEND_REQUEST', route: 'PROCEED', canDirectlyApprove: false }), true);
});

test('plant QA: a missing required test with a QAE rejection is a plain rejection; accepting it is a mismatch', () => {
  const reject = evaluateDecision({ ...base, missingCompulsory: ['Fat'], personDecision: 'REJECT', remarks: 'no fat test' });
  assert.equal(reject.route, 'REJECT');
  assert.equal(reject.finalDecision, 'REJECTED');
  const accept = evaluateDecision({ ...base, missingCompulsory: ['Fat'], personDecision: 'ACCEPT', remarks: 'looks fine' });
  assert.equal(accept.route, 'SEND_TO_APPROVER');
  assert.ok(accept.exceptionReasons.includes('MISMATCH') && accept.exceptionReasons.includes('MISSING_FIELD'));
});
