import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalRole } from '../../types';
import {
  CANONICAL_ROLES,
  FIELD_ROLES,
  ROLE_PARENT,
  canActAs,
  expandToAncestors,
  getAncestorRoles,
  getChildRoles,
  getDescendantRoles,
  getParentRole,
  isCanonicalRole,
  isOutsideDelegationRules,
  isZmccFieldOfficer,
  pickActingRole,
} from '../hierarchy';
import { ROLE_LABELS, getRoleLabel } from '../labels';
import { ROLE_ACCESS_POLICIES } from '../../../modules/access-control/rolePolicies';

// Every CanonicalRole, checked by the compiler: adding a role to the union
// without adding it here is a type error.
const ALL_ROLES_RECORD: Record<CanonicalRole, true> = {
  SUPER_ADMIN: true,
  EXECUTIVE_MANAGEMENT: true,
  DATA_EXECUTIVE: true,
  HEAD_OF_MPD: true,
  ADMIN_HEAD: true,
  QA_HEAD: true,
  PRODUCTION_HEAD: true,
  FINANCE_ACCOUNTS: true,
  ZMCC_MANAGER: true,
  CONTRACTOR_MANAGER: true,
  PHE_OPERATOR: true,
  MDO: true,
  ZMCC_LAB_ATTENDANT: true,
  MOT: true,
  CONTRACTOR_OPERATOR: true,
  SECURITY_OPERATOR: true,
  QA_LAB_ATTENDANT: true,
  WEIGHBRIDGE_OPERATOR: true,
  PRODUCTION_RECEPTION_OPERATOR: true,
};
const ALL_ROLES = Object.keys(ALL_ROLES_RECORD) as CanonicalRole[];

test('every CanonicalRole has a parent entry, a label and an access policy', () => {
  assert.deepEqual([...CANONICAL_ROLES].sort(), [...ALL_ROLES].sort());
  for (const role of ALL_ROLES) {
    assert.ok(Object.prototype.hasOwnProperty.call(ROLE_PARENT, role), `missing ROLE_PARENT.${role}`);
    assert.ok(ROLE_LABELS[role], `missing ROLE_LABELS.${role}`);
    assert.ok(ROLE_ACCESS_POLICIES[role], `missing ROLE_ACCESS_POLICIES.${role}`);
    assert.equal(isCanonicalRole(role), true);
  }
});

test('exactly one root, and it is SUPER_ADMIN', () => {
  const roots = ALL_ROLES.filter((role) => ROLE_PARENT[role] === null);
  assert.deepEqual(roots, ['SUPER_ADMIN']);
});

test('no cycles: every role reaches the root', () => {
  for (const role of ALL_ROLES) {
    const seen = new Set<string>([role]);
    let current = getParentRole(role);
    while (current) {
      assert.ok(!seen.has(current), `cycle at ${role} -> ${current}`);
      seen.add(current);
      current = getParentRole(current);
    }
    if (role !== 'SUPER_ADMIN') {
      assert.equal(getAncestorRoles(role).at(-1), 'SUPER_ADMIN', `${role} does not reach SUPER_ADMIN`);
    }
  }
});

test('tree matches the plan', () => {
  assert.equal(ROLE_PARENT.MDO, 'ZMCC_MANAGER');
  assert.equal(ROLE_PARENT.CONTRACTOR_MANAGER, 'HEAD_OF_MPD');
  assert.equal(ROLE_PARENT.CONTRACTOR_OPERATOR, 'CONTRACTOR_MANAGER');
  assert.equal(ROLE_PARENT.QA_LAB_ATTENDANT, 'QA_HEAD');
  assert.equal(isCanonicalRole('QA_MANAGER'), false);
  assert.equal(ROLE_LABELS.QA_MANAGER, 'QA Manager (retired)');
  assert.deepEqual(getChildRoles('ZMCC_MANAGER'), ['PHE_OPERATOR', 'MDO', 'ZMCC_LAB_ATTENDANT', 'MOT']);
  assert.deepEqual(getChildRoles('PRODUCTION_HEAD'), ['WEIGHBRIDGE_OPERATOR', 'PRODUCTION_RECEPTION_OPERATOR']);
  assert.deepEqual(getAncestorRoles('MOT'), ['ZMCC_MANAGER', 'HEAD_OF_MPD', 'DATA_EXECUTIVE', 'SUPER_ADMIN']);
  assert.deepEqual(getAncestorRoles('SUPER_ADMIN'), []);
  assert.deepEqual(getAncestorRoles('NOT_A_ROLE'), []);
});

test('getDescendantRoles is breadth-first, nearest first', () => {
  assert.deepEqual(getDescendantRoles('HEAD_OF_MPD'), [
    'CONTRACTOR_MANAGER',
    'ZMCC_MANAGER',
    'CONTRACTOR_OPERATOR',
    'PHE_OPERATOR',
    'MDO',
    'ZMCC_LAB_ATTENDANT',
    'MOT',
  ]);
  assert.deepEqual(getDescendantRoles('MOT'), []);
  assert.deepEqual(getDescendantRoles('NOT_A_ROLE'), []);
  assert.equal(getDescendantRoles('SUPER_ADMIN').length, ALL_ROLES.length - 1);
  assert.equal(getDescendantRoles('DATA_EXECUTIVE').length, ALL_ROLES.length - 2);
});

const CAN_ACT_AS_CASES: Array<[string, string, boolean]> = [
  ['ZMCC_MANAGER', 'ZMCC_LAB_ATTENDANT', true],
  ['ZMCC_MANAGER', 'MDO', true],
  ['ZMCC_MANAGER', 'MOT', true],
  ['ZMCC_MANAGER', 'PHE_OPERATOR', true],
  ['ZMCC_MANAGER', 'ZMCC_MANAGER', true],
  ['ZMCC_MANAGER', 'CONTRACTOR_OPERATOR', false],
  ['ZMCC_MANAGER', 'HEAD_OF_MPD', false],
  ['HEAD_OF_MPD', 'CONTRACTOR_OPERATOR', true],
  ['HEAD_OF_MPD', 'MOT', true],
  ['HEAD_OF_MPD', 'CONTRACTOR_MANAGER', true],
  ['HEAD_OF_MPD', 'SECURITY_OPERATOR', false],
  ['CONTRACTOR_MANAGER', 'CONTRACTOR_OPERATOR', true],
  ['CONTRACTOR_MANAGER', 'MOT', false],
  ['ADMIN_HEAD', 'SECURITY_OPERATOR', true],
  ['ADMIN_HEAD', 'QA_LAB_ATTENDANT', false],
  ['QA_HEAD', 'QA_LAB_ATTENDANT', true],
  ['QA_HEAD', 'PRODUCTION_RECEPTION_OPERATOR', false],
  ['PRODUCTION_HEAD', 'WEIGHBRIDGE_OPERATOR', true],
  ['PRODUCTION_HEAD', 'PRODUCTION_RECEPTION_OPERATOR', true],
  ['DATA_EXECUTIVE', 'MOT', true],
  ['DATA_EXECUTIVE', 'HEAD_OF_MPD', true],
  ['DATA_EXECUTIVE', 'SUPER_ADMIN', false],
  ['EXECUTIVE_MANAGEMENT', 'MOT', false],
  ['FINANCE_ACCOUNTS', 'ZMCC_MANAGER', false],
  ['MDO', 'PHE_OPERATOR', false],
  ['PHE_OPERATOR', 'MDO', false],
  ['MOT', 'ZMCC_MANAGER', false],
  ['NOT_A_ROLE', 'MOT', false],
  ['SUPER_ADMIN', 'NOT_A_ROLE', false],
  ['NOT_A_ROLE', 'NOT_A_ROLE', false],
  ['', '', false],
  ['Admin', 'MOT', false],
];

for (const [actor, target, expected] of CAN_ACT_AS_CASES) {
  test(`canActAs(${actor || '""'}, ${target || '""'}) === ${expected}`, () => {
    assert.equal(canActAs(actor, target), expected);
  });
}

test('SUPER_ADMIN can act as every role', () => {
  for (const role of ALL_ROLES) {
    assert.equal(canActAs('SUPER_ADMIN', role), true, role);
  }
});

test('every role can act as itself; leaves only as themselves', () => {
  for (const role of ALL_ROLES) {
    assert.equal(canActAs(role, role), true, role);
    if (getChildRoles(role).length === 0) {
      for (const other of ALL_ROLES) {
        if (other !== role) assert.equal(canActAs(role, other), false, `${role} -> ${other}`);
      }
    }
  }
});

test('expandToAncestors', () => {
  assert.deepEqual(
    new Set(expandToAncestors(['ZMCC_LAB_ATTENDANT'])),
    new Set(['ZMCC_LAB_ATTENDANT', 'ZMCC_MANAGER', 'HEAD_OF_MPD', 'DATA_EXECUTIVE', 'SUPER_ADMIN'])
  );
  assert.deepEqual(expandToAncestors(['MOT', 'CONTRACTOR_OPERATOR']), [
    'MOT',
    'CONTRACTOR_OPERATOR',
    'ZMCC_MANAGER',
    'HEAD_OF_MPD',
    'DATA_EXECUTIVE',
    'SUPER_ADMIN',
    'CONTRACTOR_MANAGER',
  ]);
  assert.deepEqual(expandToAncestors(['NOT_A_ROLE']), []);
  assert.deepEqual(expandToAncestors([]), []);
});

test('pickActingRole', () => {
  assert.equal(pickActingRole('ZMCC_MANAGER', ['ZMCC_LAB_ATTENDANT', 'ZMCC_MANAGER']), 'ZMCC_MANAGER');
  assert.equal(pickActingRole('ZMCC_MANAGER', ['CONTRACTOR_OPERATOR', 'ZMCC_LAB_ATTENDANT']), 'ZMCC_LAB_ATTENDANT');
  assert.equal(pickActingRole('HEAD_OF_MPD', ['MOT', 'ZMCC_MANAGER']), 'ZMCC_MANAGER');
  assert.equal(pickActingRole('ZMCC_MANAGER', ['CONTRACTOR_OPERATOR']), null);
  assert.equal(pickActingRole('NOT_A_ROLE', ['MOT']), null);
  assert.equal(pickActingRole('SUPER_ADMIN', []), null);
});

test('isOutsideDelegationRules', () => {
  assert.equal(isOutsideDelegationRules('SUPER_ADMIN'), true);
  assert.equal(isOutsideDelegationRules('DATA_EXECUTIVE'), true);
  assert.equal(isOutsideDelegationRules('HEAD_OF_MPD'), false);
  assert.equal(isOutsideDelegationRules(undefined), false);
});

test('FIELD_ROLES and isZmccFieldOfficer', () => {
  assert.equal(FIELD_ROLES.length, 9);
  assert.ok((FIELD_ROLES as readonly string[]).includes('MDO'));
  assert.ok(!(FIELD_ROLES as readonly string[]).includes('ZMCC_MANAGER'));
  assert.equal(isZmccFieldOfficer('PHE_OPERATOR'), true);
  assert.equal(isZmccFieldOfficer('MDO'), true);
  assert.equal(isZmccFieldOfficer('ZMCC_MANAGER'), false);
  assert.equal(isZmccFieldOfficer(null), false);
});

test('MDO access policy mirrors PHE operator plus APPROVE, source scoped', () => {
  assert.equal(ROLE_ACCESS_POLICIES.MDO.scopeKind, 'SOURCE');
  const pheCaps = new Set<string>(ROLE_ACCESS_POLICIES.PHE_OPERATOR.capabilities);
  const mdoCaps = new Set<string>(ROLE_ACCESS_POLICIES.MDO.capabilities);
  for (const cap of pheCaps) assert.ok(mdoCaps.has(cap), cap);
  assert.ok(mdoCaps.has('APPROVE'));
  assert.ok(!pheCaps.has('APPROVE'));
});

test('getRoleLabel', () => {
  assert.equal(getRoleLabel('ZMCC_MANAGER'), 'Zonal Manager');
  assert.equal(getRoleLabel('MDO'), 'MDO (Milk Development Officer)');
  assert.equal(getRoleLabel('SECURITY_OPERATOR'), 'Admin Operator');
  assert.equal(getRoleLabel('Security_Manager'), 'Security Manager');
  assert.equal(getRoleLabel('MPD_Zone_Manager'), 'MPD Zone Manager');
  assert.equal(getRoleLabel(''), 'Workspace');
  assert.equal(getRoleLabel(null, 'Unknown'), 'Unknown');
});
