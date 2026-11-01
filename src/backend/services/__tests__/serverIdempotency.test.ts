import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import {
  canonicalizeValue,
  canonicalizeJson,
  computePayloadHash,
  findOperationRecord,
  recordOperation,
  verifyReplay,
  validateReplayPayload,
} from '../operationIdempotencyService';

test('operationIdempotency: canonicalizeValue and computePayloadHash deterministic JSON normalization', () => {
  // 1. Key ordering does not affect hash
  const obj1 = { z: 1, a: 2, m: { nestedB: 'hello', nestedA: 'world' } };
  const obj2 = { a: 2, m: { nestedA: 'world', nestedB: 'hello' }, z: 1 };
  assert.equal(canonicalizeJson(obj1), canonicalizeJson(obj2));
  assert.equal(computePayloadHash(obj1), computePayloadHash(obj2));

  // 2. String contents are preserved without generic global trimming
  const str1 = { name: '  tanker-01  ', code: 'T1' };
  const str2 = { name: 'tanker-01', code: 'T1' };
  assert.notEqual(computePayloadHash(str1), computePayloadHash(str2));
  assert.equal(canonicalizeJson(str1), '{"code":"T1","name":"  tanker-01  "}');

  // 3. Nested arrays preserve order but items are canonicalized
  const arr1 = { items: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };
  const arr2 = { items: [{ a: 1, b: 2 }, { c: 3, d: 4 }] };
  assert.equal(canonicalizeJson(arr1), canonicalizeJson(arr2));
  assert.equal(computePayloadHash(arr1), computePayloadHash(arr2));

  // 4. Undefined fields are omitted deterministically
  const undef1 = { a: 1, b: undefined };
  const undef2 = { a: 1 };
  assert.equal(canonicalizeJson(undef1), canonicalizeJson(undef2));

  // 5. Null vs missing fields are not equivalent
  const withNull = { a: 1, b: null };
  const withoutField = { a: 1 };
  assert.notEqual(canonicalizeJson(withNull), canonicalizeJson(withoutField));
  assert.notEqual(computePayloadHash(withNull), computePayloadHash(withoutField));

  // 6. BigInt and Date handling
  const bigIntVal = { id: BigInt(123456789), date: new Date('2026-11-01T12:00:00.000Z') };
  const expectedJson = '{"date":"2026-11-01T12:00:00.000Z","id":"123456789"}';
  assert.equal(canonicalizeJson(bigIntVal), expectedJson);
  assert.equal(typeof computePayloadHash(bigIntVal), 'string');
  assert.equal(computePayloadHash(bigIntVal).length, 64); // SHA-256 hex length
});

test('operationIdempotency: validateReplayPayload strictly verifies payloads and rejects missing stored payloads', () => {
  assert.equal(validateReplayPayload({ a: 1 }, { a: 1 }), true);
  assert.equal(validateReplayPayload({ a: 1 }, { a: 2 }), false);
  assert.equal(validateReplayPayload(null, { a: 1 }), false, 'Missing stored payload must not validate incoming payload');
  assert.equal(validateReplayPayload({ a: 1 }, null), false);
  assert.equal(validateReplayPayload(undefined, { a: 1 }), false);
  assert.equal(validateReplayPayload(null, null), true);
  assert.equal(validateReplayPayload(undefined, undefined), true);
});

test('operationIdempotency: verifyReplay detects payload modifications, nested array changes, and operation mismatches', () => {
  const opRecord = {
    id: BigInt(1),
    key: 'test-key-replay-1',
    operation_type: 'QA_PORTION_COMPLETE',
    entity_type: 'visit_portion',
    entity_id: BigInt(101),
    payload_hash: computePayloadHash({
      operationType: 'QA_PORTION_COMPLETE',
      entityType: 'visit_portion',
      entityId: '101',
      payload: {
        decision: 'ACCEPTED',
        results: [
          { testId: 'FAT', numericValue: 4.5, textValue: null },
          { testId: 'LR', numericValue: 29.0, textValue: null },
        ],
      },
    }),
    request_payload: {
      decision: 'ACCEPTED',
      results: [
        { testId: 'FAT', numericValue: 4.5, textValue: null },
        { testId: 'LR', numericValue: 29.0, textValue: null },
      ],
    },
    response_payload: { success: true },
    status_code: 200,
    created_at: new Date(),
  };

  // Exact match
  const exactMatch = verifyReplay(opRecord, {
    operationType: 'QA_PORTION_COMPLETE',
    entityType: 'visit_portion',
    entityId: 101,
    incomingPayload: {
      decision: 'ACCEPTED',
      results: [
        { testId: 'FAT', numericValue: 4.5, textValue: null },
        { testId: 'LR', numericValue: 29.0, textValue: null },
      ],
    },
  });
  assert.equal(exactMatch.isMatch, true);

  // Operation type mismatch (cross-endpoint key reuse)
  const opMismatch = verifyReplay(opRecord, {
    operationType: 'GATE_ENTRY',
    entityType: 'visit_portion',
    entityId: 101,
    incomingPayload: { decision: 'ACCEPTED' },
  });
  assert.equal(opMismatch.isMatch, false);
  assert.ok(opMismatch.reason?.includes('Operation type mismatch'));

  // Entity mismatch
  const entityMismatch = verifyReplay(opRecord, {
    operationType: 'QA_PORTION_COMPLETE',
    entityType: 'visit_portion',
    entityId: 999,
    incomingPayload: {
      decision: 'ACCEPTED',
      results: [
        { testId: 'FAT', numericValue: 4.5, textValue: null },
        { testId: 'LR', numericValue: 29.0, textValue: null },
      ],
    },
  });
  assert.equal(entityMismatch.isMatch, false);
  assert.ok(entityMismatch.reason?.includes('Entity ID mismatch'));

  // Nested array element value changed (FAT 4.5 -> 5.0)
  const nestedChange = verifyReplay(opRecord, {
    operationType: 'QA_PORTION_COMPLETE',
    entityType: 'visit_portion',
    entityId: 101,
    incomingPayload: {
      decision: 'ACCEPTED',
      results: [
        { testId: 'FAT', numericValue: 5.0, textValue: null },
        { testId: 'LR', numericValue: 29.0, textValue: null },
      ],
    },
  });
  assert.equal(nestedChange.isMatch, false);
  assert.ok(nestedChange.reason?.includes('Payload hash mismatch'));

  // Decision changed (ACCEPTED -> REJECTED)
  const decisionChange = verifyReplay(opRecord, {
    operationType: 'QA_PORTION_COMPLETE',
    entityType: 'visit_portion',
    entityId: 101,
    incomingPayload: {
      decision: 'REJECTED',
      results: [
        { testId: 'FAT', numericValue: 4.5, textValue: null },
        { testId: 'LR', numericValue: 29.0, textValue: null },
      ],
    },
  });
  assert.equal(decisionChange.isMatch, false);
});

test('operationIdempotency: recordOperation and findOperationRecord persistence with SHA-256 payload_hash', async () => {
  const testKey = `test-key-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // 1. Should not exist initially
  const initial = await findOperationRecord(testKey);
  assert.equal(initial, null);

  // 2. Persist record with request payload
  const reqPayload = { param: 'test-value', count: 42, tags: ['a', 'b'] };
  const saved = await recordOperation({
    key: testKey,
    operationType: 'TEST_OP',
    entityType: 'test_entity',
    entityId: BigInt(99999),
    requestPayload: reqPayload,
    responsePayload: { success: true, code: 123 },
    statusCode: 200,
  });

  assert.equal(saved.key, testKey);
  assert.equal(saved.operation_type, 'TEST_OP');
  assert.ok(saved.payload_hash);
  assert.equal(saved.payload_hash.length, 64);

  // 3. Find record and verify replay
  const found = await findOperationRecord(testKey);
  assert.ok(found);
  assert.equal(found?.key, testKey);
  assert.equal(found?.payload_hash, saved.payload_hash);

  const replayCheck = verifyReplay(found!, {
    operationType: 'TEST_OP',
    entityType: 'test_entity',
    entityId: 99999,
    incomingPayload: reqPayload,
  });
  assert.equal(replayCheck.isMatch, true);

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
