import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDispatchSource,
  dispatchListFilter,
  dispatchSourceIdToLoad,
  operationalReadScopeForUser,
  operationalReadScopeFromActing,
  resolveDispatchActing,
  type DispatchSourceRow,
} from '../dispatchScope';
import { resolveActingContext } from '../../core/acting-context';
import type { User } from '../../core/types';
import type { ActingContext } from '../../../types/acting';

const ZMCC_A: DispatchSourceRow = { id: BigInt(10), source_type: 'ZMCC', is_active: true };
const ZMCC_B: DispatchSourceRow = { id: BigInt(11), source_type: 'ZMCC', is_active: true };
const CONTRACTOR_C: DispatchSourceRow = { id: BigInt(20), source_type: 'CONTRACTOR', is_active: true };

function makeUser(role: string, source?: DispatchSourceRow): User {
  return {
    id: '7',
    username: `user.${role.toLowerCase()}`,
    name: role,
    role: role as User['role'],
    department: 'MPD',
    procurement_source_id: source ? source.id.toString() : null,
    procurement_source: source
      ? { id: source.id.toString(), code: `S${source.id}`, name: `Source ${source.id}`, source_type: source.source_type || '', is_active: source.is_active }
      : null,
  };
}

function ctxFor(role: string, source?: DispatchSourceRow, requestedAs?: string): ActingContext {
  const result = resolveActingContext(makeUser(role, source), ['ZMCC_LAB_ATTENDANT', 'CONTRACTOR_OPERATOR'], { requestedAs });
  assert.ok(result.ok, `expected acting context for ${role}`);
  return result.ctx;
}

test('SOURCE scope: the dispatch source is forced to the bound source', () => {
  const ctx = ctxFor('ZMCC_LAB_ATTENDANT', ZMCC_A);
  assert.deepEqual(dispatchSourceIdToLoad(ctx.scope, null), { ok: true, sourceId: ZMCC_A.id });
  assert.deepEqual(checkDispatchSource(ctx, null, ZMCC_A), { ok: true, sourceId: ZMCC_A.id, sourceType: 'ZMCC' });
  assert.deepEqual(checkDispatchSource(ctx, '10', ZMCC_A), { ok: true, sourceId: ZMCC_A.id, sourceType: 'ZMCC' });
});

test('SOURCE scope: another requested source is OUTSIDE_SCOPE', () => {
  const ctx = ctxFor('ZMCC_LAB_ATTENDANT', ZMCC_A);
  assert.deepEqual(checkDispatchSource(ctx, '11', ZMCC_B), { ok: false, code: 'OUTSIDE_SCOPE' });
  assert.deepEqual(dispatchSourceIdToLoad(ctx.scope, BigInt(11)), { ok: false, code: 'OUTSIDE_SCOPE' });
  // A row that is not the bound source is never accepted.
  assert.deepEqual(checkDispatchSource(ctx, null, ZMCC_B), { ok: false, code: 'OUTSIDE_SCOPE' });
});

test('Super Admin acting as ZMCC_LAB_ATTENDANT with a CONTRACTOR source is SOURCE_TYPE_MISMATCH', () => {
  const ctx = ctxFor('SUPER_ADMIN', undefined, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.scope.kind, 'SYSTEM');
  assert.equal(ctx.isDelegated, false);
  assert.deepEqual(checkDispatchSource(ctx, '20', CONTRACTOR_C), { ok: false, code: 'SOURCE_TYPE_MISMATCH' });
  assert.deepEqual(checkDispatchSource(ctx, '10', ZMCC_A), { ok: true, sourceId: ZMCC_A.id, sourceType: 'ZMCC' });
});

test('Super Admin without acting-as gets the role that matches the source type', () => {
  const zmcc = resolveDispatchActing(makeUser('SUPER_ADMIN'), null, 'ZMCC');
  assert.ok(zmcc.ok);
  assert.equal(zmcc.ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  const contractor = resolveDispatchActing(makeUser('SUPER_ADMIN'), null, 'CONTRACTOR');
  assert.ok(contractor.ok);
  assert.equal(contractor.ctx.actingAs, 'CONTRACTOR_OPERATOR');
  assert.deepEqual(checkDispatchSource(contractor.ctx, '20', CONTRACTOR_C), { ok: true, sourceId: CONTRACTOR_C.id, sourceType: 'CONTRACTOR' });
  // Asking for the wrong role for the source fails.
  const wrong = resolveDispatchActing(makeUser('SUPER_ADMIN'), 'ZMCC_LAB_ATTENDANT', 'CONTRACTOR');
  assert.deepEqual(wrong, { ok: false, code: 'SOURCE_TYPE_MISMATCH' });
});

test('SYSTEM scope without a source is SOURCE_REQUIRED', () => {
  const ctx = ctxFor('SUPER_ADMIN', undefined, 'ZMCC_LAB_ATTENDANT');
  assert.deepEqual(checkDispatchSource(ctx, null, null), { ok: false, code: 'SOURCE_REQUIRED' });
  assert.deepEqual(checkDispatchSource(ctx, '  ', null), { ok: false, code: 'SOURCE_REQUIRED' });
  assert.deepEqual(checkDispatchSource(ctx, 'abc', null), { ok: false, code: 'SOURCE_INVALID' });
  assert.deepEqual(checkDispatchSource(ctx, '99', null), { ok: false, code: 'SOURCE_NOT_FOUND' });
});

test('Zonal Manager acting as ZMCC_LAB_ATTENDANT is delegated and limited to own ZMCC', () => {
  const resolved = resolveDispatchActing(makeUser('ZMCC_MANAGER', ZMCC_A), null, 'ZMCC');
  assert.ok(resolved.ok);
  const ctx = resolved.ctx;
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.isDelegated, true);
  assert.deepEqual(ctx.scope, { kind: 'SOURCE', sourceId: ZMCC_A.id, sourceType: 'ZMCC' });
  assert.deepEqual(checkDispatchSource(ctx, null, ZMCC_A), { ok: true, sourceId: ZMCC_A.id, sourceType: 'ZMCC' });
  assert.deepEqual(checkDispatchSource(ctx, '11', ZMCC_B), { ok: false, code: 'OUTSIDE_SCOPE' });
  // A Zonal Manager cannot act as a Contractor Operator.
  assert.deepEqual(resolveDispatchActing(makeUser('ZMCC_MANAGER', ZMCC_A), 'CONTRACTOR_OPERATOR', 'ZMCC'), {
    ok: false,
    code: 'CANNOT_ACT_AS',
  });
});

test('inactive source is rejected', () => {
  const ctx = ctxFor('SUPER_ADMIN', undefined, 'ZMCC_LAB_ATTENDANT');
  const inactive: DispatchSourceRow = { id: BigInt(12), source_type: 'ZMCC', is_active: false };
  assert.deepEqual(checkDispatchSource(ctx, '12', inactive), { ok: false, code: 'SOURCE_INACTIVE' });
  // A source-bound user whose source is inactive has no scope at all.
  const bound = resolveActingContext(makeUser('ZMCC_LAB_ATTENDANT', inactive), ['ZMCC_LAB_ATTENDANT']);
  assert.deepEqual(bound, { ok: false, code: 'NO_SCOPE_BOUND' });
});

test('department scope never dispatches and lists nothing', () => {
  const scope = { kind: 'DEPARTMENT', departments: ['Quality Assurance'] } as const;
  assert.deepEqual(dispatchSourceIdToLoad(scope, '10'), { ok: false, code: 'OUTSIDE_SCOPE' });
  assert.deepEqual(dispatchListFilter(scope, '10'), { kind: 'NONE' });
});

test('dispatch list filter follows the scope', () => {
  const sourceScope = { kind: 'SOURCE', sourceId: ZMCC_A.id, sourceType: 'ZMCC' } as const;
  assert.deepEqual(dispatchListFilter(sourceScope, '11'), { kind: 'SOURCE', sourceId: ZMCC_A.id });
  assert.deepEqual(dispatchListFilter({ kind: 'SYSTEM' }, null), { kind: 'ALL' });
  assert.deepEqual(dispatchListFilter({ kind: 'SYSTEM' }, '11'), { kind: 'SOURCE', sourceId: ZMCC_B.id });
  assert.deepEqual(dispatchListFilter({ kind: 'SYSTEM' }, 'x'), { kind: 'NONE' });
});

test('operational read scope fails closed for unknown roles', () => {
  assert.deepEqual(operationalReadScopeForUser(null), { kind: 'NONE' });
  assert.deepEqual(operationalReadScopeForUser({ role: 'MPD_Operator' as User['role'], procurement_source_id: null }), { kind: 'NONE' });
  assert.deepEqual(operationalReadScopeForUser({ role: 'NOT_A_ROLE' as User['role'], procurement_source_id: '10' }), { kind: 'NONE' });
  // Listed source-scoped roles keep today's behaviour.
  assert.deepEqual(operationalReadScopeForUser({ role: 'CONTRACTOR_OPERATOR', procurement_source_id: '20' }), {
    kind: 'SOURCE',
    sourceId: CONTRACTOR_C.id,
    sourceType: 'CONTRACTOR',
  });
  assert.deepEqual(operationalReadScopeForUser({ role: 'ZMCC_MANAGER', procurement_source_id: null }), { kind: 'NONE' });
  // Other ZMCC field roles are limited to their own ZMCC too.
  assert.deepEqual(operationalReadScopeForUser({ role: 'MOT', procurement_source_id: '10' }), {
    kind: 'SOURCE',
    sourceId: ZMCC_A.id,
    sourceType: 'ZMCC',
  });
  // System and plant department roles read everything.
  assert.deepEqual(operationalReadScopeForUser({ role: 'SUPER_ADMIN', procurement_source_id: null }), { kind: 'ALL' });
  assert.deepEqual(operationalReadScopeForUser({ role: 'QA_LAB_ATTENDANT', procurement_source_id: null }), { kind: 'ALL' });
  assert.deepEqual(operationalReadScopeFromActing({ kind: 'SYSTEM' }), { kind: 'ALL' });
});
