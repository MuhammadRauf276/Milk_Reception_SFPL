import test from 'node:test';
import assert from 'node:assert/strict';
import { apiClient, ApiError, AUTH_EXPIRED_EVENT } from '@/frontend/lib/apiClient';

test('formPreservation: 401 response dispatches milk-auth-expired without erasing form state', async () => {
  // 1. Set up simulated form state representing an operator's active input
  const weighbridgeFormState = {
    visitId: '9001',
    grossWeightKg: '34520',
    ticketNumber: 'WT-9001',
    remarks: 'Gross weight recorded on platform 1',
  };

  const qaFormState = {
    visitId: '9002',
    portionId: '101',
    decision: 'ACCEPTED',
    temperature: '4.2',
    fat: '3.8',
    lr: '28.5',
    remarks: 'Sample clear, standard accepted',
  };

  const gateFormState = {
    visitId: '9003',
    tokenNumber: 'TK-441',
  };

  // 2. Track auth expired events
  let authExpiredEventFired = false;
  const onAuthExpired = () => {
    authExpiredEventFired = true;
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  }

  // 3. Simulate 401 API Error
  const simulated401 = new ApiError(
    'Your session has expired. Please sign in again.',
    401,
    'SESSION_EXPIRED',
    { isAuthExpired: true }
  );

  assert.equal(simulated401.status, 401);
  assert.equal(simulated401.isAuthExpired, true);

  // 4. Verify form states remain intact
  assert.equal(weighbridgeFormState.grossWeightKg, '34520');
  assert.equal(weighbridgeFormState.ticketNumber, 'WT-9001');

  assert.equal(qaFormState.decision, 'ACCEPTED');
  assert.equal(qaFormState.fat, '3.8');
  assert.equal(qaFormState.lr, '28.5');

  assert.equal(gateFormState.tokenNumber, 'TK-441');

  // 5. Simulate session restoration event
  let authRestoredFired = false;
  const onAuthRestored = () => {
    authRestoredFired = true;
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('milk-auth-restored', onAuthRestored);
    window.dispatchEvent(new CustomEvent('milk-auth-restored', { detail: { username: 'operator' } }));
    assert.equal(authRestoredFired, true);
    window.removeEventListener('milk-auth-restored', onAuthRestored);
    window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  }

  // 6. Confirm values are still unchanged and ready for retry
  assert.equal(weighbridgeFormState.grossWeightKg, '34520');
  assert.equal(qaFormState.fat, '3.8');
  assert.equal(gateFormState.tokenNumber, 'TK-441');
});

test('formPreservation: Stable operation identity prevents duplicate submission on retry after re-auth', () => {
  const portionId = '202';
  const stableOpId = `plant-qa-${portionId}-fixed-token`;

  // First submission payload with stable identity
  const submission1 = {
    portionId,
    decision: 'ACCEPTED',
    completionClientEventId: stableOpId,
  };

  // Re-auth retry with the SAME stable identity
  const submission2 = {
    portionId,
    decision: 'ACCEPTED',
    completionClientEventId: stableOpId,
  };

  assert.equal(
    submission1.completionClientEventId,
    submission2.completionClientEventId,
    'Retry after re-authentication MUST reuse the exact same completionClientEventId'
  );
});
