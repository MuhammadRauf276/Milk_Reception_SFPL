import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role, User } from '@/backend/core/types';
import { POST as gateEntryHandler } from '@/app/api/security/gate-entry/route';
import { POST as qaCompleteHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { POST as qaPortionsHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/route';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

const APPROVED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const APPROVED_DB_NAMES = new Set([
  'milk_reception_test',
  'milk_reception_test_db',
  'milk_reception_dev',
  'milk_reception_db',
  'sfpl_milk_test',
]);

function assertTestDatabaseSafety() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set.');
  const parsed = new URL(dbUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0].toLowerCase();

  if (!APPROVED_HOSTS.has(host) || !APPROVED_DB_NAMES.has(dbName)) {
    throw new Error(`SAFETY REFUSAL: Tests cannot run against unverified host ${host} or db ${dbName}`);
  }
}

test('apiRouteIdempotencyIntegration: Gate Entry replay, lost response retry, and 409 conflict', async () => {
  assertTestDatabaseSafety();

  const runId = `INTEG-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const testVehicle = `TEST-VEH-${runId}`;
  const testVisitNum = `V-${runId}`;
  const tokenNumber = `TOK-${runId}`;
  const idempotencyKey = `GATE-ENTRY-KEY-${runId}`;

  const secUser = await prisma.user.findFirst({
    where: { role: 'SECURITY_OPERATOR', is_active: true },
  });
  assert.ok(secUser, 'Active SECURITY_OPERATOR must exist in test database');

  const authUser: User = {
    id: secUser.id.toString(),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as Role,
    department: 'Security',
    scope_type: 'DEPARTMENT',
  };
  const token = await createSessionToken(authUser);

  // 1. Create a synthetic test vehicle visit ready for gate entry
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNum,
      vehicle_number: testVehicle,
      current_status: 'DISPATCHED',
      operational_date: new Date(),
    },
  });

  try {
    // 2. Initial Gate Entry Request (simulates first submission)
    const initialPayload = {
      visitId: visit.id.toString(),
      tokenNumber,
      entryTimestamp: new Date().toISOString(),
    };

    const req1 = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(initialPayload),
    });

    const res1 = await gateEntryHandler(req1);
    assert.equal(res1.status, 200, 'Initial gate entry must return 200');
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.tokenNumber, tokenNumber);

    // Verify DB state after initial request
    const gateLogCount1 = await prisma.gateLog.count({ where: { visit_id: visit.id } });
    assert.equal(gateLogCount1, 1, 'Exactly one gate log must exist in database');

    const opCount1 = await prisma.operationIdempotencyRecord.count({ where: { key: idempotencyKey } });
    assert.equal(opCount1, 1, 'Exactly one idempotency record must exist');

    // 3. Scenario: Response lost, client retries with the exact same key and payload
    const reqRetry = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(initialPayload),
    });

    const resRetry = await gateEntryHandler(reqRetry);
    assert.equal(resRetry.status, 200, 'Retry must return 200');
    const bodyRetry = await resRetry.json();
    assert.equal(bodyRetry.is_replay, true, 'Retry must be recognized as a replay');
    assert.equal(bodyRetry.tokenNumber, tokenNumber);

    // Verify DB still contains exactly one gate log
    const gateLogCountAfterRetry = await prisma.gateLog.count({ where: { visit_id: visit.id } });
    assert.equal(gateLogCountAfterRetry, 1, 'Database must contain exactly 1 gate log after retry');

    // 4. Scenario: Client sends changed payload under the same key -> Must return 409 Conflict
    const changedPayload = {
      visitId: visit.id.toString(),
      tokenNumber: `DIFF-${tokenNumber.substring(0, 15)}`,
      entryTimestamp: new Date().toISOString(),
    };

    const reqConflict = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(changedPayload),
    });

    const resConflict = await gateEntryHandler(reqConflict);
    assert.equal(resConflict.status, 409, 'Modified payload with same key must return 409 Conflict');
    const bodyConflict = await resConflict.json();
    assert.ok(bodyConflict.error?.includes('conflict') || bodyConflict.error?.includes('Idempotency'));
  } finally {
    // Clean up synthetic test records
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key: idempotencyKey } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: Concurrent Gate Entry requests create exactly one record', async () => {
  assertTestDatabaseSafety();

  const runId = `CONC-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const testVehicle = `TEST-VEH-${runId}`;
  const testVisitNum = `V-${runId}`;
  const tokenNumber = `TOK-${runId}`;
  const concurrentKey = `CONC-KEY-${runId}`;

  const secUser = await prisma.user.findFirst({
    where: { role: 'SECURITY_OPERATOR', is_active: true },
  });
  assert.ok(secUser);

  const authUser: User = {
    id: secUser.id.toString(),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as Role,
    department: 'Security',
    scope_type: 'DEPARTMENT',
  };
  const token = await createSessionToken(authUser);

  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNum,
      vehicle_number: testVehicle,
      current_status: 'DISPATCHED',
      operational_date: new Date(),
    },
  });

  try {
    const payload = {
      visitId: visit.id.toString(),
      tokenNumber,
      entryTimestamp: new Date().toISOString(),
    };

    // Construct two identical requests sent concurrently
    const reqA = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': concurrentKey,
      },
      body: JSON.stringify(payload),
    });

    const reqB = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': concurrentKey,
      },
      body: JSON.stringify(payload),
    });

    // Execute concurrently
    const [resA, resB] = await Promise.all([
      gateEntryHandler(reqA),
      gateEntryHandler(reqB),
    ]);

    assert.equal(resA.status, 200, 'Request A must succeed with 200');
    assert.equal(resB.status, 200, 'Request B must succeed with 200');

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    // Exactly one is the primary winner and the other is recognized as replay
    const hasReplay = bodyA.is_replay === true || bodyB.is_replay === true;
    assert.ok(hasReplay, 'At least one of the concurrent responses must be marked as replay');

    // Database must have EXACTLY 1 gate log
    const gateLogCount = await prisma.gateLog.count({ where: { visit_id: visit.id } });
    assert.equal(gateLogCount, 1, 'Only one GateLog record must be created concurrently');

    // Exactly 1 OperationIdempotencyRecord
    const opCount = await prisma.operationIdempotencyRecord.count({ where: { key: concurrentKey } });
    assert.equal(opCount, 1, 'Only one idempotency record must exist');
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key: concurrentKey } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: QA Portion Creation idempotency, audit log non-duplication, and concurrent requests', async () => {
  assertTestDatabaseSafety();

  const runId = `QAPORT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const testVehicle = `TEST-QA-${runId}`;
  const testVisitNum = `V-QA-${runId}`;
  const portionOpId = `qa-add-op-${runId}`;

  const qaUser = await prisma.user.findFirst({
    where: { role: 'QA_LAB_ATTENDANT', is_active: true },
  });
  assert.ok(qaUser);

  const authUser: User = {
    id: qaUser.id.toString(),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as Role,
    department: 'QA',
    scope_type: 'DEPARTMENT',
  };
  const token = await createSessionToken(authUser);

  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNum,
      vehicle_number: testVehicle,
      current_status: 'GATE_ENTERED',
      operational_date: new Date(),
    },
  });

  try {
    // 1. Initial Portion Creation
    const req1 = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientOperationId: portionOpId }),
    });

    const res1 = await qaPortionsHandler(req1, {
      params: Promise.resolve({ visitId: visit.id.toString() }),
    });

    assert.equal(res1.status, 200, 'QA portion creation must succeed');
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.ok(body1.portion?.id);
    const createdPortionId = BigInt(body1.portion.id);

    // Database check: Exactly 1 portion, 1 audit log
    const portionCount1 = await prisma.visitPortion.count({ where: { visit_id: visit.id } });
    assert.equal(portionCount1, 1, 'Exactly one portion must exist');

    const auditCount1 = await prisma.auditLog.count({
      where: {
        table_name: 'visit_portion',
        record_id: createdPortionId,
        action: 'PLANT_QA_PORTION_ADDED',
      },
    });
    assert.equal(auditCount1, 1, 'Exactly one audit log record must be created');

    // 2. Retry with same clientOperationId -> Must return 200 with is_replay: true
    const reqRetry = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientOperationId: portionOpId }),
    });

    const resRetry = await qaPortionsHandler(reqRetry, {
      params: Promise.resolve({ visitId: visit.id.toString() }),
    });

    assert.equal(resRetry.status, 200, 'Portion creation retry must return 200');
    const bodyRetry = await resRetry.json();
    assert.equal(bodyRetry.is_replay, true, 'Retry must be marked as replay');
    assert.equal(bodyRetry.portion.id, createdPortionId.toString());

    // Database check: Portion count and audit count MUST NOT be duplicated
    const portionCountAfterRetry = await prisma.visitPortion.count({ where: { visit_id: visit.id } });
    assert.equal(portionCountAfterRetry, 1, 'Portion count must still be exactly 1');

    const auditCountAfterRetry = await prisma.auditLog.count({
      where: {
        table_name: 'visit_portion',
        record_id: createdPortionId,
        action: 'PLANT_QA_PORTION_ADDED',
      },
    });
    assert.equal(auditCountAfterRetry, 1, 'Audit log must not be duplicated on replay');

    // 3. Concurrent portion creation using a new key
    const concOpId = `qa-add-conc-${runId}`;
    const reqA = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientOperationId: concOpId }),
    });

    const reqB = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientOperationId: concOpId }),
    });

    const [resA, resB] = await Promise.all([
      qaPortionsHandler(reqA, { params: Promise.resolve({ visitId: visit.id.toString() }) }),
      qaPortionsHandler(reqB, { params: Promise.resolve({ visitId: visit.id.toString() }) }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const bodyA = await resA.json();
    const bodyB = await resB.json();
    assert.ok(bodyA.is_replay === true || bodyB.is_replay === true, 'One of concurrent portion creations must be replay');

    // Exactly 1 new portion was added (total portions for visit = 2)
    const totalPortions = await prisma.visitPortion.count({ where: { visit_id: visit.id } });
    assert.equal(totalPortions, 2, 'Total portions must be 2 after concurrent creation with single new key');
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({
      where: { key: { in: [portionOpId, `qa-add-conc-${runId}`] } },
    });
    const portions = await prisma.visitPortion.findMany({ where: { visit_id: visit.id } });
    for (const p of portions) {
      await prisma.auditLog.deleteMany({ where: { record_id: p.id } });
    }
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: QA Complete canonical payload hashing, exact replay, and changed payload 409 conflict', async () => {
  assertTestDatabaseSafety();

  const runId = `QACOMP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const testVehicle = `TEST-QA-${runId}`;
  const testVisitNum = `V-QA-${runId}`;
  const completionOpId = `qa-op-${runId}`;

  const qaUser = await prisma.user.findFirst({
    where: { role: 'QA_LAB_ATTENDANT', is_active: true },
  });
  assert.ok(qaUser);

  const authUser: User = {
    id: qaUser.id.toString(),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as Role,
    department: 'QA',
    scope_type: 'DEPARTMENT',
  };
  const token = await createSessionToken(authUser);

  // Create synthetic visit and portion
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNum,
      vehicle_number: testVehicle,
      current_status: 'GATE_ENTERED',
      operational_date: new Date(),
    },
  });

  const portion = await prisma.visitPortion.create({
    data: {
      visit_id: visit.id,
      portion_number: 1,
      current_status: 'UNDER_TEST',
      plant_decision: 'PENDING',
      manager_review_status: 'NONE',
    },
  });

  const session = await prisma.qATestingSession.create({
    data: {
      visit: { connect: { id: visit.id } },
      starter: { connect: { id: qaUser.id } },
      started_at: new Date(Date.now() - 60000),
      status: 'IN_PROGRESS',
    },
  });

  // Assign lab tests to this visit
  const assignedTests = await getOrAssignPlantQATests(prisma, visit.id);
  assert.ok(assignedTests.length > 0, 'Plant tests must be assigned');

  // Build full valid test results matching all required tests
  const testResults = assignedTests
    .filter((t) => t.result_type_snapshot !== 'CALCULATED')
    .map((t) => {
      const options = (t.result_options_snapshot as any[] | null) || null;
      const isOptions = Array.isArray(options) && options.length > 0;
      const selectedOption = isOptions
        ? (options.find((o) => (o.value || o.label)?.toUpperCase() === 'OK')?.value ||
           options.find((o) => (o.value || o.label)?.toUpperCase() === 'NEGATIVE')?.value ||
           options[0]?.value || 'OK')
        : null;
      return {
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED' as const,
        numericValue: isOptions ? null : t.test_code_snapshot === 'FAT' ? 4.5 : t.test_code_snapshot === 'LR' ? 29.0 : 1.0,
        textValue: isOptions ? selectedOption : null,
        photoUrl: null,
      };
    });

  try {
    const validPayload = {
      decision: 'ACCEPTED' as const,
      completionClientEventId: completionOpId,
      sealNumber: 'SEAL-12345',
      operationalTimestamp: new Date().toISOString(),
      results: testResults,
    };

    // 1. Submit initial QA completion
    const req1 = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload),
    });

    const res1 = await qaCompleteHandler(req1, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
    });

    const body1 = await res1.json();
    assert.equal(res1.status, 200, 'QA Complete initial submission must succeed');
    assert.equal(body1.success, true);
    assert.ok(body1.plantDecision);

    // 2. Replay with exact same payload and same completionClientEventId
    const reqReplay = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload),
    });

    const resReplay = await qaCompleteHandler(reqReplay, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
    });

    assert.equal(resReplay.status, 200, 'Replay must return 200');
    const bodyReplay = await resReplay.json();
    assert.equal(bodyReplay.is_replay, true, 'Must be marked as replay');
    assert.equal(bodyReplay.plantDecision, body1.plantDecision);

    // 3. Changed payload under same operation ID (e.g. modified numericValue of first test) -> Must return 409
    const alteredResults = [...testResults];
    if (alteredResults.length > 0) {
      alteredResults[0] = { ...alteredResults[0], numericValue: 9.9 };
    }
    const alteredPayload = {
      ...validPayload,
      results: alteredResults,
    };

    const reqConflict = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(alteredPayload),
    });

    const resConflict = await qaCompleteHandler(reqConflict, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
    });

    assert.equal(resConflict.status, 409, 'Altered test results under same operation ID must return 409 Conflict');
    const bodyConflict = await resConflict.json();
    assert.ok(bodyConflict.error?.includes('conflict') || bodyConflict.error?.includes('Idempotency'));
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key: completionOpId } });
    await prisma.plantLabResult.deleteMany({ where: { portion_id: portion.id } });
    await prisma.auditLog.deleteMany({ where: { record_id: portion.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});
