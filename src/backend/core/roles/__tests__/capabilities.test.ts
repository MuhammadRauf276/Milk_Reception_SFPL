import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_ROLES } from '../hierarchy';
import {
  NON_DELEGABLE_CAPABILITIES,
  holdsNonDelegable,
  isCorrectionAuthority,
  isDeviceAdministrator,
} from '../capabilities';
import { ROLE_ACCESS_POLICIES } from '../../../modules/access-control/rolePolicies';

const HOLDERS = new Set(['SUPER_ADMIN', 'DATA_EXECUTIVE']);

test('non-delegable capabilities are CORRECT and ADMINISTER', () => {
  assert.deepEqual([...NON_DELEGABLE_CAPABILITIES], ['CORRECT', 'ADMINISTER']);
});

test('only SUPER_ADMIN and DATA_EXECUTIVE hold CORRECT and ADMINISTER', () => {
  for (const role of CANONICAL_ROLES) {
    const expected = HOLDERS.has(role);
    for (const cap of NON_DELEGABLE_CAPABILITIES) {
      assert.equal(holdsNonDelegable(role, cap), expected, `${role} ${cap}`);
    }
    assert.equal(isCorrectionAuthority(role), expected, `isCorrectionAuthority(${role})`);
    assert.equal(isDeviceAdministrator(role), expected, `isDeviceAdministrator(${role})`);
  }
  assert.equal(isCorrectionAuthority('Admin'), false);
  assert.equal(isDeviceAdministrator(''), false);
});

test('ROLE_ACCESS_POLICIES give CORRECT / ADMINISTER only to SUPER_ADMIN and DATA_EXECUTIVE', () => {
  for (const role of CANONICAL_ROLES) {
    const caps = new Set<string>(ROLE_ACCESS_POLICIES[role].capabilities);
    for (const cap of NON_DELEGABLE_CAPABILITIES) {
      assert.equal(caps.has(cap), HOLDERS.has(role), `${role} ${cap}`);
    }
  }
});
