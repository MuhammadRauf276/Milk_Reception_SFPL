import test from 'node:test';
import assert from 'node:assert/strict';
import { canDecideApproval } from '../escalation/approvalMatrix';

const own = { approvalType: 'STAGE_3_ZMCC_DISPATCH_EXCEPTION' as const, submittedByUserId: '1', submitterRole: 'ZMCC_LAB_ATTENDANT', zmccId: '2', contractorId: null };

test('a Super Admin can open and decide a request it sent itself', () => {
  // The inbox asks before any reason is written: the request must stay decidable.
  assert.equal(canDecideApproval({ userId: '1', role: 'SUPER_ADMIN' }, own).allowed, true);
  // Sending the decision still needs a short reason, kept in the audit log.
  assert.equal(canDecideApproval({ userId: '1', role: 'SUPER_ADMIN' }, own, 'ok').allowed, false);
  assert.equal(canDecideApproval({ userId: '1', role: 'SUPER_ADMIN' }, own, 'Checked the milk myself').allowed, true);
});
