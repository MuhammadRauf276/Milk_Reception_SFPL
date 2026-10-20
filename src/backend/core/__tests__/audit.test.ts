import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { auditActorFromUser, buildAuditLogData, writeAuditLog, type AuditDb } from '../audit';
import type { ActingContext } from '@/types/acting';

const base = { tableName: 'zmcc_tank', recordId: BigInt(5), action: 'X' };

function ctxOf(actorRole: string, actingAs: string, isDelegated: boolean): ActingContext {
  return { userId: BigInt(3), actorRole, actingAs, isDelegated, scope: { kind: 'SYSTEM' } } as unknown as ActingContext;
}

test('AuditActor maps real user, roles, delegation and device', () => {
  const d = buildAuditLogData({
    ...base,
    actor: { userId: BigInt(7), actorRole: 'ZONAL_MANAGER', performedAsRole: 'ZMCC_LAB_ATTENDANT', isDelegated: true, deviceId: BigInt(9) },
  });
  assert.equal(d.user_id, BigInt(7));
  assert.equal(d.actor_role, 'ZONAL_MANAGER');
  assert.equal(d.performed_as_role, 'ZMCC_LAB_ATTENDANT');
  assert.equal(d.is_delegated, true);
  assert.equal(d.device_id, BigInt(9));
  assert.equal(d.table_name, 'zmcc_tank');
  assert.equal(d.record_id, BigInt(5));
});

test('AuditActor defaults performed_as to actor role and not delegated', () => {
  const d = buildAuditLogData({ ...base, actor: { userId: BigInt(1), actorRole: 'QA_MANAGER' } });
  assert.equal(d.performed_as_role, 'QA_MANAGER');
  assert.equal(d.is_delegated, false);
  assert.equal(d.device_id, null);
});

test('ActingContext maps actingAs and isDelegated', () => {
  const d = buildAuditLogData({ ...base, actor: ctxOf('HEAD_OF_MPD', 'ZONAL_MANAGER', true), deviceId: BigInt(4) });
  assert.equal(d.user_id, BigInt(3));
  assert.equal(d.actor_role, 'HEAD_OF_MPD');
  assert.equal(d.performed_as_role, 'ZONAL_MANAGER');
  assert.equal(d.is_delegated, true);
  assert.equal(d.device_id, BigInt(4));
});

test('SUPER_ADMIN and DATA_EXECUTIVE are never delegated', () => {
  for (const role of ['SUPER_ADMIN', 'DATA_EXECUTIVE']) {
    const a = buildAuditLogData({ ...base, actor: { userId: BigInt(1), actorRole: role, performedAsRole: 'ZONAL_MANAGER', isDelegated: true } });
    assert.equal(a.is_delegated, false);
    assert.equal(buildAuditLogData({ ...base, actor: ctxOf(role, 'ZONAL_MANAGER', true) }).is_delegated, false);
  }
});

test('null JSON becomes DbNull, undefined is omitted, values pass through', () => {
  const actor = { userId: BigInt(1), actorRole: 'SUPER_ADMIN' };
  const d = buildAuditLogData({ ...base, actor, oldValues: null, newValues: { a: 1 } });
  assert.equal(d.old_values, Prisma.DbNull);
  assert.deepEqual(d.new_values, { a: 1 });
  const e = buildAuditLogData({ ...base, actor });
  assert.equal('old_values' in e, false);
  assert.equal('new_values' in e, false);
});

test('writeAuditLog passes built data to db and returns id', async () => {
  let seen: unknown;
  const db = {
    auditLog: {
      create: async (args: { data: unknown }) => {
        seen = args.data;
        return { id: BigInt(42) };
      },
    },
  } as unknown as AuditDb;
  const r = await writeAuditLog(db, { ...base, actor: auditActorFromUser({ id: '11', role: 'SUPER_ADMIN' }, BigInt(2)) });
  assert.equal(r.id, BigInt(42));
  assert.equal((seen as { user_id: bigint }).user_id, BigInt(11));
  assert.equal((seen as { device_id: bigint }).device_id, BigInt(2));
});
