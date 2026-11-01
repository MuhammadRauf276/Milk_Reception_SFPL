import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import {
  findOperationRecord,
  recordOperation,
  validateReplayPayload,
} from '../operationIdempotencyService';

test('operationIdempotency: validateReplayPayload handles identical and mismatched payloads', () => {
  // Matching payload with critical fields
  const stored = { visitId: '100', tokenNumber: 'T-99', unusedField: 'abc' };
  const incoming = { visitId: '100', tokenNumber: 't-99' };
  assert.equal(validateReplayPayload(stored, incoming, ['visitId', 'tokenNumber']), true);

  // Mismatched token
  const mismatchedToken = { visitId: '100', tokenNumber: 'T-100' };
  assert.equal(validateReplayPayload(stored, mismatchedToken, ['visitId', 'tokenNumber']), false);

  // Mismatched visitId
  const mismatchedVisit = { visitId: '101', tokenNumber: 'T-99' };
  assert.equal(validateReplayPayload(stored, mismatchedVisit, ['visitId', 'tokenNumber']), false);

  // Null / undefined handling
  assert.equal(validateReplayPayload(null, incoming), true);
  assert.equal(validateReplayPayload(stored, null), true);
});

test('operationIdempotency: recordOperation and findOperationRecord persistence and P2002 conflict', async () => {
  const testKey = `test-key-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  
  // 1. Should not exist initially
  const initial = await findOperationRecord(testKey);
  assert.equal(initial, null);

  // 2. Persist record
  const saved = await recordOperation({
    key: testKey,
    operationType: 'TEST_OP',
    entityType: 'test_entity',
    entityId: BigInt(99999),
    requestPayload: { param: 'test-value' },
    responsePayload: { success: true, code: 123 },
    statusCode: 200,
  });

  assert.equal(saved.key, testKey);
  assert.equal(saved.operation_type, 'TEST_OP');

  // 3. Find record
  const found = await findOperationRecord(testKey);
  assert.ok(found);
  assert.equal(found?.key, testKey);
  assert.equal(found?.entity_type, 'test_entity');
  assert.equal(found?.response_payload?.success, true);

  // 4. Duplicate insertion must reject with unique constraint conflict (P2002)
  await assert.rejects(
    async () =>
      recordOperation({
        key: testKey,
        operationType: 'TEST_OP_DUP',
        entityType: 'test_entity',
        entityId: BigInt(99999),
        responsePayload: { dup: true },
      }),
    (err: any) => err.code === 'P2002'
  );

  // Cleanup
  await prisma.operationIdempotencyRecord.delete({ where: { key: testKey } }).catch(() => {});
});

test('operationIdempotency: QA portion creation client event uniqueness contract', async () => {
  const eventId = `test-portion-${Date.now()}`;

  // Clean up if exists
  await prisma.operationIdempotencyRecord.delete({ where: { key: eventId } }).catch(() => {});

  // Simulate storing QA portion creation idempotency
  await recordOperation({
    key: eventId,
    operationType: 'QA_ADD_PORTION',
    entityType: 'visit_portion',
    entityId: 101,
    requestPayload: { visitId: '555' },
    responsePayload: { success: true, portion: { portion_number: 2 } },
  });

  // Replay request with exact payload matches
  const stored = await findOperationRecord(eventId);
  assert.ok(stored);
  assert.equal(validateReplayPayload(stored.request_payload, { visitId: '555' }, ['visitId']), true);

  // Replay request with different visitId is rejected as 409 conflict
  assert.equal(validateReplayPayload(stored.request_payload, { visitId: '777' }, ['visitId']), false);

  // Cleanup
  await prisma.operationIdempotencyRecord.delete({ where: { key: eventId } }).catch(() => {});
});

test('operationIdempotency: Weighbridge gross and tare idempotency key contract', async () => {
  const grossKey = `GROSS-TEST-${Date.now()}`;

  await recordOperation({
    key: grossKey,
    operationType: 'SCALE_GROSS_WEIGHT',
    entityType: 'weight_ticket',
    entityId: 501,
    requestPayload: { visitId: '888', grossWeightKg: '25400' },
    responsePayload: { success: true, grossWeightKg: 25400 },
  });

  const record = await findOperationRecord(grossKey);
  assert.ok(record);
  // Same weight -> matches
  assert.equal(validateReplayPayload(record.request_payload, { visitId: '888', grossWeightKg: '25400' }, ['visitId', 'grossWeightKg']), true);
  // Weight mismatch -> false (409 conflict)
  assert.equal(validateReplayPayload(record.request_payload, { visitId: '888', grossWeightKg: '25500' }, ['visitId', 'grossWeightKg']), false);

  // Cleanup
  await prisma.operationIdempotencyRecord.delete({ where: { key: grossKey } }).catch(() => {});
});
