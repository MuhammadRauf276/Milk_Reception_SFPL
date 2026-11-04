import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_BANNER_AUTO_DISMISS_MS, authBannerReducer, INITIAL_AUTH_BANNER_STATE, type AuthBannerEvent } from '../authBanner';

const run = (events: AuthBannerEvent[]) => events.reduce(authBannerReducer, INITIAL_AUTH_BANNER_STATE);

test('auto-dismiss delay is 6 seconds', () => assert.equal(AUTH_BANNER_AUTO_DISMISS_MS, 6000));

test('a 401 while online never shows the offline message', () => {
  assert.equal(run([{ type: 'EXPIRED', online: true }]).visible, false);
});

test('a 401 while offline shows it', () => {
  assert.equal(run([{ type: 'EXPIRED', online: false }]).visible, true);
});

test('timeout, dismiss, sign-in and valid-session-online each clear it', () => {
  for (const clear of [{ type: 'TIMEOUT' }, { type: 'DISMISSED' }, { type: 'SIGNED_IN' }, { type: 'ONLINE_SESSION_VALID' }] as AuthBannerEvent[]) {
    assert.equal(run([{ type: 'EXPIRED', online: false }, clear]).visible, false, clear.type);
  }
});

test('clearing when nothing is shown keeps the same state object', () => {
  assert.equal(authBannerReducer(INITIAL_AUTH_BANNER_STATE, { type: 'TIMEOUT' }), INITIAL_AUTH_BANNER_STATE);
});

test('it can show again after being cleared', () => {
  assert.equal(run([{ type: 'EXPIRED', online: false }, { type: 'TIMEOUT' }, { type: 'EXPIRED', online: false }]).visible, true);
});
