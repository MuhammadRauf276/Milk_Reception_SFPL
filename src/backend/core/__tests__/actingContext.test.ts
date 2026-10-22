import test from 'node:test';
import assert from 'node:assert/strict';
import type { Role, User } from '../types';
import type { ActingContext } from '../../../types/acting';
import { CANONICAL_ROLES, canActAs } from '../roles/hierarchy';
import {
  ROLE_HOME_DEPARTMENT,
  asRoleFields,
  assertResourceInScope,
  departmentsForRole,
  primaryActorFields,
  resolveActingContext,
  targetSourceTypeFor,
} from '../acting-context';

const ZMCC_SOURCE = { id: '11', code: 'ZM-HAS', name: 'Hasilpur', source_type: 'ZMCC', is_active: true };
const CONTRACTOR_SOURCE = { id: '22', code: 'CT-1', name: 'Contractor 1', source_type: 'CONTRACTOR', is_active: true };

function userFor(role: Role, extra: Partial<User> = {}): User {
  const source = targetSourceTypeFor(role) === 'ZMCC' ? ZMCC_SOURCE : targetSourceTypeFor(role) === 'CONTRACTOR' ? CONTRACTOR_SOURCE : null;
  return {
    id: '7',
    username: role.toLowerCase(),
    name: role,
    role,
    department: (ROLE_HOME_DEPARTMENT as Record<string, string | undefined>)[role] ?? 'Head Office',
    procurement_source_id: source?.id ?? null,
    procurement_source: source,
    ...extra,
  };
}

function resolveOk(...args: Parameters<typeof resolveActingContext>): ActingContext {
  const result = resolveActingContext(...args);
  assert.ok(result.ok, result.ok ? undefined : `expected ok, got ${result.code}`);
  return result.ctx;
}

function resolveCode(...args: Parameters<typeof resolveActingContext>): string {
  const result = resolveActingContext(...args);
  assert.ok(!result.ok, 'expected failure');
  return result.code;
}

// ---------- canActAs table ----------

const CAN_ACT_AS_TABLE: Array<[string, string, boolean]> = [
  ['ZMCC_MANAGER', 'PHE_OPERATOR', true],
  ['ZMCC_MANAGER', 'MDO', true],
  ['ZMCC_MANAGER', 'ZMCC_LAB_ATTENDANT', true],
  ['ZMCC_MANAGER', 'MOT', true],
  ['ZMCC_MANAGER', 'ZMCC_MANAGER', true],
  ['ZMCC_MANAGER', 'CONTRACTOR_OPERATOR', false],
  ['ZMCC_MANAGER', 'CONTRACTOR_MANAGER', false],
  ['ZMCC_MANAGER', 'HEAD_OF_MPD', false],
  ['CONTRACTOR_MANAGER', 'CONTRACTOR_OPERATOR', true],
  ['CONTRACTOR_MANAGER', 'PHE_OPERATOR', false],
  ['HEAD_OF_MPD', 'ZMCC_LAB_ATTENDANT', true],
  ['HEAD_OF_MPD', 'CONTRACTOR_OPERATOR', true],
  ['HEAD_OF_MPD', 'QA_LAB_ATTENDANT', false],
  ['ADMIN_HEAD', 'SECURITY_OPERATOR', true],
  ['ADMIN_HEAD', 'QA_LAB_ATTENDANT', false],
  ['ADMIN_HEAD', 'QA_MANAGER', false],
  ['ADMIN_HEAD', 'ZMCC_LAB_ATTENDANT', false],
  ['QA_HEAD', 'QA_LAB_ATTENDANT', true],
  ['QA_HEAD', 'QA_MANAGER', false],
  ['QA_HEAD', 'SECURITY_OPERATOR', false],
  ['PRODUCTION_HEAD', 'WEIGHBRIDGE_OPERATOR', true],
  ['PRODUCTION_HEAD', 'PRODUCTION_RECEPTION_OPERATOR', true],
  ['PRODUCTION_HEAD', 'QA_LAB_ATTENDANT', false],
  ['PHE_OPERATOR', 'ZMCC_MANAGER', false],
  ['PHE_OPERATOR', 'MDO', false],
];

test('canActAs table', () => {
  for (const [actor, target, expected] of CAN_ACT_AS_TABLE) {
    assert.equal(canActAs(actor, target), expected, `${actor} -> ${target}`);
  }
});

test('Data Executive can act as all roles below it but not Super Admin; Super Admin can act as all', () => {
  for (const role of CANONICAL_ROLES) {
    if (role === 'SUPER_ADMIN') {
      assert.equal(canActAs('DATA_EXECUTIVE', role), false, 'DE -> SA');
    } else {
      assert.equal(canActAs('DATA_EXECUTIVE', role), true, `DE -> ${role}`);
    }
    assert.equal(canActAs('SUPER_ADMIN', role), true, `SA -> ${role}`);
  }
});

test('resolveActingContext follows canActAs for every (actor, requestedAs) pair', () => {
  for (const actor of CANONICAL_ROLES) {
    for (const target of CANONICAL_ROLES) {
      const result = resolveActingContext(userFor(actor), [target], { requestedAs: target });
      if (canActAs(actor, target)) {
        assert.ok(result.ok, result.ok ? undefined : `${actor} as ${target}: ${result.code}`);
        assert.equal(result.ctx.actingAs, target);
        assert.equal(result.ctx.actorRole, actor);
      } else {
        assert.deepEqual(result, { ok: false, code: 'CANNOT_ACT_AS' }, `${actor} as ${target}`);
      }
    }
  }
});

// ---------- acting role selection and isDelegated ----------

test('own role allowed and no requestedAs: acts as self, not delegated', () => {
  const ctx = resolveOk(userFor('ZMCC_LAB_ATTENDANT'), ['ZMCC_LAB_ATTENDANT']);
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.isDelegated, false);
  assert.equal(ctx.userId, BigInt(7));
});

test('ancestor of allowed role passes and is delegated', () => {
  const ctx = resolveOk(userFor('ZMCC_MANAGER'), ['ZMCC_LAB_ATTENDANT']);
  assert.equal(ctx.actorRole, 'ZMCC_MANAGER');
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.isDelegated, true);
  assert.deepEqual(ctx.scope, { kind: 'SOURCE', sourceId: BigInt(11), sourceType: 'ZMCC' });
});

test('requestedAs equal to own role is not delegated; below is delegated', () => {
  assert.equal(resolveOk(userFor('ZMCC_MANAGER'), ['ZMCC_MANAGER', 'MDO'], { requestedAs: 'ZMCC_MANAGER' }).isDelegated, false);
  const ctx = resolveOk(userFor('ZMCC_MANAGER'), ['ZMCC_MANAGER', 'MDO'], { requestedAs: 'MDO' });
  assert.equal(ctx.actingAs, 'MDO');
  assert.equal(ctx.isDelegated, true);
});

test('MPD Head picks the allowed role that matches the resource source type', () => {
  const allowed = ['ZMCC_LAB_ATTENDANT', 'CONTRACTOR_OPERATOR'];
  const asContractor = resolveOk(userFor('HEAD_OF_MPD'), allowed, { resource: { sourceType: 'CONTRACTOR', sourceId: BigInt(22) } });
  assert.equal(asContractor.actingAs, 'CONTRACTOR_OPERATOR');
  assert.equal(asContractor.isDelegated, true);
  const asZmcc = resolveOk(userFor('HEAD_OF_MPD'), allowed, { resource: { sourceType: 'ZMCC' } });
  assert.equal(asZmcc.actingAs, 'ZMCC_LAB_ATTENDANT');
});

test('Super Admin and Data Executive are never delegated', () => {
  const sa = resolveOk(userFor('SUPER_ADMIN'), ['ZMCC_LAB_ATTENDANT']);
  assert.equal(sa.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(sa.isDelegated, false);
  assert.deepEqual(sa.scope, { kind: 'SYSTEM' });

  const saAs = resolveOk(userFor('SUPER_ADMIN'), ['MOT', 'QA_LAB_ATTENDANT'], { requestedAs: 'QA_LAB_ATTENDANT' });
  assert.equal(saAs.actingAs, 'QA_LAB_ATTENDANT');
  assert.equal(saAs.isDelegated, false);

  const de = resolveOk(userFor('DATA_EXECUTIVE'), ['DATA_EXECUTIVE', 'MOT']);
  assert.equal(de.actingAs, 'DATA_EXECUTIVE');
  assert.equal(de.isDelegated, false);
  assert.deepEqual(de.scope, { kind: 'SYSTEM' });
});

test('Data Executive can act as a role below (e.g. MOT) but cannot act as Super Admin', () => {
  const deAsMot = resolveOk(userFor('DATA_EXECUTIVE'), ['MOT'], { requestedAs: 'MOT' });
  assert.equal(deAsMot.actingAs, 'MOT');
  assert.equal(resolveCode(userFor('DATA_EXECUTIVE'), ['SUPER_ADMIN'], { requestedAs: 'SUPER_ADMIN' }), 'CANNOT_ACT_AS');
});

test('requestedAs above the actor or on another branch: CANNOT_ACT_AS', () => {
  assert.equal(resolveCode(userFor('PHE_OPERATOR'), ['ZMCC_MANAGER', 'PHE_OPERATOR'], { requestedAs: 'ZMCC_MANAGER' }), 'CANNOT_ACT_AS');
  assert.equal(resolveCode(userFor('ZMCC_MANAGER'), ['CONTRACTOR_OPERATOR'], { requestedAs: 'CONTRACTOR_OPERATOR' }), 'CANNOT_ACT_AS');
  assert.equal(resolveCode(userFor('ADMIN_HEAD'), ['QA_LAB_ATTENDANT'], { requestedAs: 'QA_LAB_ATTENDANT' }), 'CANNOT_ACT_AS');
  assert.equal(resolveCode(userFor('MOT'), ['MOT'], { requestedAs: 'NOT_A_ROLE' }), 'CANNOT_ACT_AS');
});

test('requestedAs the actor may act as but not allowed here: FORBIDDEN', () => {
  assert.equal(resolveCode(userFor('ZMCC_MANAGER'), ['PHE_OPERATOR'], { requestedAs: 'MDO' }), 'FORBIDDEN');
});

test('role not allowed and not an ancestor: FORBIDDEN', () => {
  assert.equal(resolveCode(userFor('PHE_OPERATOR'), ['ZMCC_MANAGER']), 'FORBIDDEN');
  assert.equal(resolveCode(userFor('ADMIN_HEAD'), ['QA_LAB_ATTENDANT']), 'FORBIDDEN');
  assert.equal(resolveCode(userFor('MOT'), []), 'FORBIDDEN');
  assert.equal(resolveCode(userFor('MOT', { role: 'Admin' }), ['MOT']), 'FORBIDDEN');
  assert.equal(resolveCode(userFor('MOT', { id: 'usr_fixture' }), ['MOT']), 'FORBIDDEN');
});

test("delegation 'none': exact role only, plus Super Admin", () => {
  assert.equal(resolveCode(userFor('ZMCC_MANAGER'), ['ZMCC_LAB_ATTENDANT'], { delegation: 'none' }), 'FORBIDDEN');
  assert.equal(
    resolveCode(userFor('ZMCC_MANAGER'), ['ZMCC_MANAGER', 'MDO'], { delegation: 'none', requestedAs: 'MDO' }),
    'FORBIDDEN'
  );
  assert.equal(resolveOk(userFor('ZMCC_LAB_ATTENDANT'), ['ZMCC_LAB_ATTENDANT'], { delegation: 'none' }).isDelegated, false);
  const sa = resolveOk(userFor('SUPER_ADMIN'), ['ZMCC_LAB_ATTENDANT'], { delegation: 'none' });
  assert.equal(sa.isDelegated, false);
  assert.equal(resolveCode(userFor('HEAD_OF_MPD'), ['ZMCC_LAB_ATTENDANT'], { delegation: 'none' }), 'FORBIDDEN');
});

test('retired QA_MANAGER cannot act and QA_HEAD cannot act as QA_MANAGER', () => {
  assert.equal(canActAs('QA_HEAD', 'QA_MANAGER'), false);
  assert.equal(canActAs('QA_MANAGER', 'QA_MANAGER'), false);
  assert.deepEqual(resolveActingContext(userFor('QA_MANAGER'), ['QA_MANAGER']), { ok: false, code: 'FORBIDDEN' });
  assert.deepEqual(resolveActingContext(userFor('QA_HEAD'), ['QA_LAB_ATTENDANT'], { requestedAs: 'QA_MANAGER' }), {
    ok: false,
    code: 'CANNOT_ACT_AS',
  });
});

// ---------- scope ----------

test('NO_SCOPE_BOUND: source roles need an active source of the right type', () => {
  assert.equal(resolveCode(userFor('ZMCC_MANAGER', { procurement_source: null, procurement_source_id: null }), ['ZMCC_MANAGER']), 'NO_SCOPE_BOUND');
  assert.equal(resolveCode(userFor('ZMCC_MANAGER', { procurement_source: CONTRACTOR_SOURCE }), ['ZMCC_MANAGER']), 'NO_SCOPE_BOUND');
  assert.equal(
    resolveCode(userFor('PHE_OPERATOR', { procurement_source: { ...ZMCC_SOURCE, is_active: false } }), ['PHE_OPERATOR']),
    'NO_SCOPE_BOUND'
  );
  assert.equal(resolveCode(userFor('CONTRACTOR_OPERATOR', { procurement_source: ZMCC_SOURCE }), ['CONTRACTOR_OPERATOR']), 'NO_SCOPE_BOUND');
  const co = resolveOk(userFor('CONTRACTOR_MANAGER'), ['CONTRACTOR_OPERATOR']);
  assert.deepEqual(co.scope, { kind: 'SOURCE', sourceId: BigInt(22), sourceType: 'CONTRACTOR' });
});

test('OUTSIDE_SCOPE: Zonal Manager on another ZMCC', () => {
  assert.equal(resolveCode(userFor('ZMCC_MANAGER'), ['ZMCC_LAB_ATTENDANT'], { resource: { sourceId: BigInt(12) } }), 'OUTSIDE_SCOPE');
  assert.ok(resolveActingContext(userFor('ZMCC_MANAGER'), ['ZMCC_LAB_ATTENDANT'], { resource: { sourceId: BigInt(11), sourceType: 'ZMCC' } }).ok);
  const ctx = resolveOk(userFor('PHE_OPERATOR'), ['PHE_OPERATOR']);
  assert.deepEqual(assertResourceInScope(ctx, { sourceId: BigInt(99) }), { ok: false, code: 'OUTSIDE_SCOPE' });
  assert.deepEqual(assertResourceInScope(ctx, { sourceId: BigInt(11), sourceType: 'CONTRACTOR' }), { ok: false, code: 'SOURCE_TYPE_MISMATCH' });
  assert.deepEqual(assertResourceInScope(ctx, {}), { ok: true });
});

test('SOURCE_TYPE_MISMATCH: system-scope heads acting on the wrong source type', () => {
  assert.equal(
    resolveCode(userFor('HEAD_OF_MPD'), ['ZMCC_LAB_ATTENDANT'], { resource: { sourceId: BigInt(22), sourceType: 'CONTRACTOR' } }),
    'SOURCE_TYPE_MISMATCH'
  );
  assert.equal(
    resolveCode(userFor('HEAD_OF_MPD'), ['CONTRACTOR_OPERATOR'], { requestedAs: 'CONTRACTOR_OPERATOR', resource: { sourceType: 'zmcc' } }),
    'SOURCE_TYPE_MISMATCH'
  );
  const exec = resolveOk(userFor('EXECUTIVE_MANAGEMENT'), ['EXECUTIVE_MANAGEMENT'], { resource: { sourceType: 'CONTRACTOR' } });
  assert.deepEqual(exec.scope, { kind: 'SYSTEM' });
  const fin = resolveOk(userFor('FINANCE_ACCOUNTS'), ['FINANCE_ACCOUNTS']);
  assert.deepEqual(fin.scope, { kind: 'SYSTEM' });
  assert.deepEqual(
    assertResourceInScope({ ...fin, actingAs: 'ZMCC_MANAGER' }, { sourceType: 'CONTRACTOR' }),
    { ok: false, code: 'SOURCE_TYPE_MISMATCH' }
  );
});

test('department heads: own department plus every department below', () => {
  const admin = resolveOk(userFor('ADMIN_HEAD'), ['SECURITY_OPERATOR']);
  assert.equal(admin.scope.kind, 'DEPARTMENT');
  assert.ok(admin.scope.kind === 'DEPARTMENT' && admin.scope.departments.includes('Security'));
  assert.deepEqual(assertResourceInScope(admin, { department: 'Security' }), { ok: true });
  assert.deepEqual(assertResourceInScope(admin, { department: 'Quality Assurance' }), { ok: false, code: 'OUTSIDE_SCOPE' });

  assert.deepEqual(departmentsForRole('PRODUCTION_HEAD', 'Production'), ['Production', 'Production & Weighbridge']);
  assert.deepEqual(departmentsForRole('QA_HEAD', 'Quality Assurance'), ['Quality Assurance']);
  assert.deepEqual(departmentsForRole('WEIGHBRIDGE_OPERATOR', ''), ['Production & Weighbridge']);
  assert.equal(
    resolveCode(userFor('WEIGHBRIDGE_OPERATOR'), ['WEIGHBRIDGE_OPERATOR'], { resource: { department: 'Security' } }),
    'OUTSIDE_SCOPE'
  );
});

test('targetSourceTypeFor', () => {
  assert.equal(targetSourceTypeFor('ZMCC_MANAGER'), 'ZMCC');
  assert.equal(targetSourceTypeFor('MOT'), 'ZMCC');
  assert.equal(targetSourceTypeFor('ZMCC_LAB_ATTENDANT'), 'ZMCC');
  assert.equal(targetSourceTypeFor('CONTRACTOR_MANAGER'), 'CONTRACTOR');
  assert.equal(targetSourceTypeFor('CONTRACTOR_OPERATOR'), 'CONTRACTOR');
  assert.equal(targetSourceTypeFor('HEAD_OF_MPD'), null);
  assert.equal(targetSourceTypeFor('SUPER_ADMIN'), null);
  assert.equal(targetSourceTypeFor('QA_LAB_ATTENDANT'), null);
  assert.equal(targetSourceTypeFor('nope'), null);
});

// ---------- record fields ----------

test('primaryActorFields and asRoleFields', () => {
  const ctx = resolveOk(userFor('ZMCC_MANAGER'), ['ZMCC_LAB_ATTENDANT']);
  assert.deepEqual(primaryActorFields(ctx), { performed_as_role: 'ZMCC_LAB_ATTENDANT', is_delegated: true });
  const fields = asRoleFields(ctx, 'tested_by');
  assert.deepEqual(Object.keys(fields).sort(), ['tested_by_as_role', 'tested_by_is_delegated']);
  assert.equal(fields.tested_by_as_role, 'ZMCC_LAB_ATTENDANT');
  assert.equal(fields.tested_by_is_delegated, true);
});
