import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNotificationDeepLink, VALID_APP_ROUTES } from '../notification-links';

test('resolveNotificationDeepLink repairs legacy /control-center links to /super-admin/audit', () => {
  assert.equal(
    resolveNotificationDeepLink('/control-center?audit=1&id=4408', {
      eventKey: 'SELF_APPROVAL_REVIEW',
      role: 'SUPER_ADMIN',
    }),
    '/super-admin/audit'
  );
});

test('resolveNotificationDeepLink repairs legacy /zmcc and /finance/reconciliation links', () => {
  assert.equal(
    resolveNotificationDeepLink('/zmcc', {
      eventKey: 'MOT_RETURNING_TO_ZMCC',
      role: 'PHE_OPERATOR',
    }),
    '/phe'
  );
  assert.equal(
    resolveNotificationDeepLink('/zmcc', {
      eventKey: 'MOT_RETURNING_TO_ZMCC',
      role: 'ZMCC_MANAGER',
    }),
    '/mpd/zmcc-manager?tab=MOT_JOURNEYS'
  );
  assert.equal(
    resolveNotificationDeepLink('/zmcc', {
      eventKey: 'ZMCC_CLOSE_REQUEST_PENDING',
      role: 'ZMCC_MANAGER',
    }),
    '/mpd/zmcc-manager?tab=APPROVALS'
  );
  assert.equal(
    resolveNotificationDeepLink('/finance/reconciliation', {
      eventKey: 'FINANCE_TARGET_CHANGED',
      role: 'FINANCE_ACCOUNTS',
    }),
    '/super-admin/reports'
  );
});

test('resolveNotificationDeepLink repairs invalid COLLECTIONS tab query on /mpd/zmcc-manager', () => {
  assert.equal(
    resolveNotificationDeepLink('/mpd/zmcc-manager?tab=COLLECTIONS', {
      eventKey: 'MOT_SHOP_WARNING_LOGGED',
      role: 'ZMCC_MANAGER',
    }),
    '/mpd/zmcc-manager?tab=OVERVIEW'
  );
});

test('resolveNotificationDeepLink rejects external URLs and unknown routes safely', () => {
  assert.equal(
    resolveNotificationDeepLink('https://evil.example/phish', {
      eventKey: 'PLANT_QA_EXCEPTION_PENDING',
      role: 'QA_HEAD',
    }),
    '/department/qa-head'
  );
  assert.equal(
    resolveNotificationDeepLink('/non-existent-route', {
      role: 'CONTRACTOR_MANAGER',
    }),
    '/contractor/manager'
  );
});

test('correction request notifications link to the ticket pages', () => {
  assert.equal(
    resolveNotificationDeepLink('/request-correction?tab=requests', { eventKey: 'CORRECTION_WITH_ZMCC_MANAGER', role: 'ZMCC_MANAGER' }),
    '/request-correction?tab=requests'
  );
  assert.equal(
    resolveNotificationDeepLink(null, { eventKey: 'CORRECTION_WITH_HEAD_OF_MPD', role: 'HEAD_OF_MPD' }),
    '/request-correction?tab=requests'
  );
  assert.equal(
    resolveNotificationDeepLink('/super-admin/corrections?tab=requests', { eventKey: 'CORRECTION_OPEN', role: 'DATA_EXECUTIVE' }),
    '/super-admin/corrections?tab=requests'
  );
});

test('resolveNotificationDeepLink preserves valid routes and query parameters', () => {
  assert.equal(
    resolveNotificationDeepLink('/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS', {
      eventKey: 'ZMCC_LAB_EXCEPTION_PENDING',
      role: 'ZMCC_MANAGER',
    }),
    '/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS'
  );
  assert.ok(VALID_APP_ROUTES.has('/super-admin/audit'));
  assert.ok(!VALID_APP_ROUTES.has('/control-center'));
});
