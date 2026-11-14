import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role, User } from '@/backend/core/types';
import { POST as gateEntryHandler } from '@/app/api/security/gate-entry/route';
import { POST as gateExitHandler } from '@/app/api/security/gate-exit/route';
import { POST as grossWeightHandler } from '@/app/api/scale/gross-weight/route';
import { POST as tareWeightHandler } from '@/app/api/scale/tare-weight/route';
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

/** Weight tickets and the audit rows written for them (audit rows are keyed by the ticket id, not the visit id). */
async function deleteWeightTicketsWithAudits(visitId: bigint) {
  const tickets = await prisma.weightTicket.findMany({ where: { visit_id: visitId }, select: { id: true } });
  if (tickets.length > 0) {
    await prisma.auditLog.deleteMany({ where: { table_name: 'weight_ticket', record_id: { in: tickets.map((t) => t.id) } } });
  }
  await prisma.weightTicket.deleteMany({ where: { visit_id: visitId } });
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
      await prisma.notification.deleteMany({ where: { source_type: 'PLANT_QA_PORTION', source_id: p.id.toString() } });
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
      // Photos are not attached here, so this is an exception request to AVP QA, which needs remarks.
      exceptionReason: 'Test photos not available in this idempotency test',
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

    // 4. Concurrent QA Complete requests under same completionClientEventId
    const concOpId = `CONC-QA-${Date.now()}`;
    const concVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `V-CQA-${Date.now()}`,
        vehicle_number: `T-CQA-${Date.now()}`,
        current_status: 'PLANT_QA',
        operational_date: new Date(),
        test_mode: 'PORTION_WISE',
        portions: {
          create: {
            portion_number: 1,
            current_status: 'UNDER_TEST',
            plant_decision: 'PENDING',
          },
        },
      },
      include: { portions: true },
    });
    const concPortion = concVisit.portions[0];

    const concSession = await prisma.qATestingSession.create({
      data: {
        visit: { connect: { id: concVisit.id } },
        starter: { connect: { id: qaUser.id } },
        started_at: new Date(Date.now() - 60000),
        status: 'IN_PROGRESS',
      },
    });

    const concAssignedTests = await getOrAssignPlantQATests(prisma, concVisit.id);
    const concTestResults = concAssignedTests
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
          photoUrl: 'https://storage.milk.test/sample.jpg',
        };
      });

    try {
      // DECIDE_NOW is honoured only for roles that may decide at Plant QA, so complete as one.
      const deciderUser =
        (await prisma.user.findFirst({ where: { role: 'QA_HEAD', is_active: true } })) ??
        (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } }));
      assert.ok(deciderUser, 'Active QA_HEAD or SUPER_ADMIN required to decide');
      const deciderToken = await createSessionToken({
        id: deciderUser.id.toString(),
        username: deciderUser.username,
        name: deciderUser.full_name || deciderUser.username,
        role: deciderUser.role as Role,
        department: 'QA',
        scope_type: 'DEPARTMENT',
      });


      const concPayload = {
        completionClientEventId: concOpId,
        decision: 'ACCEPTED',
        action: 'DECIDE_NOW',
        sealNumber: 'SEAL-CONC-99',
        operationalTimestamp: new Date().toISOString(),
        results: concTestResults,
      };

      const [cResA, cResB] = await Promise.all([
        qaCompleteHandler(new Request(`http://localhost:3000/api/qa/vehicle-visits/${concVisit.id}/portions/${concPortion.id}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deciderToken}` },
          body: JSON.stringify(concPayload),
        }), { params: Promise.resolve({ visitId: concVisit.id.toString(), portionId: concPortion.id.toString() }) }),
        qaCompleteHandler(new Request(`http://localhost:3000/api/qa/vehicle-visits/${concVisit.id}/portions/${concPortion.id}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deciderToken}` },
          body: JSON.stringify(concPayload),
        }), { params: Promise.resolve({ visitId: concVisit.id.toString(), portionId: concPortion.id.toString() }) }),
      ]);

      const cBodyA = await cResA.json();
      const cBodyB = await cResB.json();

      assert.equal(cResA.status, 200, `cResA must be 200: ${JSON.stringify(cBodyA)}`);
      assert.equal(cResB.status, 200, `cResB must be 200: ${JSON.stringify(cBodyB)}`);
      assert.ok(cBodyA.is_replay || cBodyB.is_replay);

      const concOpCount = await prisma.operationIdempotencyRecord.count({ where: { key: concOpId } });
      assert.equal(concOpCount, 1, 'Exactly one idempotency record must be committed');
    } finally {
      await prisma.operationIdempotencyRecord.deleteMany({ where: { key: concOpId } });
      await prisma.plantLabResult.deleteMany({ where: { portion_id: concPortion.id } });
      await prisma.auditLog.deleteMany({ where: { record_id: concPortion.id } });
      await prisma.notification.deleteMany({ where: { source_type: 'PLANT_QA_PORTION', source_id: concPortion.id.toString() } });
      await prisma.visitPortion.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.qATestingSession.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.vehicleVisit.delete({ where: { id: concVisit.id } });
    }
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key: completionOpId } });
    await prisma.plantLabResult.deleteMany({ where: { portion_id: portion.id } });
    await prisma.auditLog.deleteMany({ where: { record_id: portion.id } });
    await prisma.notification.deleteMany({ where: { source_type: 'PLANT_QA_PORTION', source_id: portion.id.toString() } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: A Plant QA user sending DECIDE_NOW still gets the AVP-QA request flow', async () => {
  assertTestDatabaseSafety();

  const runId = `QADN-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const completionOpId = `qa-dn-${runId}`;

  const qaUser = await prisma.user.findFirst({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  assert.ok(qaUser);
  const token = await createSessionToken({
    id: qaUser.id.toString(),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as Role,
    department: 'QA',
    scope_type: 'DEPARTMENT',
  });

  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-QA-${runId}`,
      vehicle_number: `TEST-QA-${runId}`,
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
  await prisma.qATestingSession.create({
    data: {
      visit: { connect: { id: visit.id } },
      starter: { connect: { id: qaUser.id } },
      started_at: new Date(Date.now() - 60000),
      status: 'IN_PROGRESS',
    },
  });

  const assignedTests = await getOrAssignPlantQATests(prisma, visit.id);
  assert.ok(assignedTests.length > 0, 'Plant tests must be assigned');
  // No photos are attached, so this portion has an exception that needs a decision.
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
    const res = await qaCompleteHandler(
      new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          decision: 'ACCEPTED',
          action: 'DECIDE_NOW',
          completionClientEventId: completionOpId,
          sealNumber: 'SEAL-DN-1',
          operationalTimestamp: new Date().toISOString(),
          exceptionReason: 'Photos not available for this test',
          results: testResults,
        }),
      }),
      { params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }) },
    );
    const body = await res.json();
    assert.equal(res.status, 200, `Request must succeed: ${JSON.stringify(body)}`);

    const after = await prisma.visitPortion.findUnique({ where: { id: portion.id } });
    assert.equal(after?.plant_decision, 'PENDING', 'A client-sent DECIDE_NOW must not let a Plant QA user decide');
    assert.equal(after?.manager_review_status, 'PENDING', 'Portion must go to AVP-QA review');
    assert.equal(after?.manager_review_requested_by_user_id, qaUser.id);
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key: completionOpId } });
    await prisma.plantLabResult.deleteMany({ where: { portion_id: portion.id } });
    await prisma.auditLog.deleteMany({ where: { record_id: portion.id } });
    await prisma.notification.deleteMany({ where: { source_id: { startsWith: portion.id.toString() } } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: Missing operation ID is rejected with 400 across all operational mutation endpoints', async () => {
  assertTestDatabaseSafety();

  const secUser = await prisma.user.findFirst({ where: { role: 'SECURITY_OPERATOR', is_active: true } });
  assert.ok(secUser);
  const secToken = await createSessionToken({
    id: secUser.id.toString(),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as Role,
    department: 'Security',
    scope_type: 'DEPARTMENT',
  });

  const wbUser = await prisma.user.findFirst({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  assert.ok(wbUser);
  const wbToken = await createSessionToken({
    id: wbUser.id.toString(),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as Role,
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  });

  const qaUser = await prisma.user.findFirst({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  assert.ok(qaUser);
  const qaToken = await createSessionToken({
    id: qaUser.id.toString(),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as Role,
    department: 'QA',
    scope_type: 'DEPARTMENT',
  });

  const runId = `NOKEY-${Date.now()}`;
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-${runId}`,
      vehicle_number: `T-${runId}`,
      current_status: 'DISPATCHED',
      operational_date: new Date(),
    },
  });

  try {
    // 1. Gate Entry without key -> 400
    const reqEntry = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secToken}` },
      body: JSON.stringify({ visitId: visit.id.toString(), tokenNumber: `TOK-${runId}` }),
    });
    const resEntry = await gateEntryHandler(reqEntry);
    assert.equal(resEntry.status, 400, 'Gate entry without key must return 400');

    // 2. Gate Exit without key -> 400
    const reqExit = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secToken}` },
      body: JSON.stringify({ visitId: visit.id.toString() }),
    });
    const resExit = await gateExitHandler(reqExit);
    assert.equal(resExit.status, 400, 'Gate exit without key must return 400');

    // 3. Gross Weight without key -> 400
    const reqGross = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${wbToken}` },
      body: JSON.stringify({ visitId: visit.id.toString(), grossWeightKg: 25000 }),
    });
    const resGross = await grossWeightHandler(reqGross);
    assert.equal(resGross.status, 400, 'Gross weight without key must return 400');

    // 4. Tare Weight without key -> 400
    const reqTare = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${wbToken}` },
      body: JSON.stringify({ visitId: visit.id.toString(), tareWeightKg: 10000 }),
    });
    const resTare = await tareWeightHandler(reqTare);
    assert.equal(resTare.status, 400, 'Tare weight without key must return 400');

    // 5. QA Add Portion without key -> 400
    const reqPortion = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${qaToken}` },
      body: JSON.stringify({}),
    });
    const resPortion = await qaPortionsHandler(reqPortion, { params: Promise.resolve({ visitId: visit.id.toString() }) });
    assert.equal(resPortion.status, 400, 'QA portion creation without key must return 400');

    // 6. QA Complete without key -> 400
    const reqComplete = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/1/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${qaToken}` },
      body: JSON.stringify({ decision: 'ACCEPTED', results: [] }),
    });
    const resComplete = await qaCompleteHandler(reqComplete, { params: Promise.resolve({ visitId: visit.id.toString(), portionId: '1' }) });
    assert.equal(resComplete.status, 400, 'QA complete without key must return 400');
  } finally {
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: Gate Exit replay, 409 conflict, and concurrent requests', async () => {
  assertTestDatabaseSafety();

  const secUser = await prisma.user.findFirst({ where: { role: 'SECURITY_OPERATOR', is_active: true } });
  assert.ok(secUser);
  const token = await createSessionToken({
    id: secUser.id.toString(),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as Role,
    department: 'Security',
    scope_type: 'DEPARTMENT',
  });

  const runId = `EXIT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const key = `EXIT-KEY-${runId}`;

  // Vehicle ready for gate exit
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-${runId}`,
      vehicle_number: `T-EXIT-${runId}`,
      current_status: 'READY_FOR_GATE_EXIT',
      operational_date: new Date(),
      weight_ticket: {
        create: {
          ticket_number: `TK-EX-${runId}`,
          gross_weight_kg: 28000,
          tare_weight_kg: 10000,
          net_weight_kg: 18000,
          gross_timestamp: new Date(Date.now() - 3000000),
          tare_timestamp: new Date(Date.now() - 1000000),
          gross_recorded_by: secUser.id,
          tare_recorded_by: secUser.id,
          gross_submitted_at: new Date(Date.now() - 3000000),
          tare_submitted_at: new Date(Date.now() - 1000000),
        },
      },
      gate_log: {
        create: {
          entry_timestamp: new Date(Date.now() - 3600000),
          entry_guard_id: secUser.id,
          entry_submitted_at: new Date(Date.now() - 3600000),
        },
      },
    },
  });

  try {
    const payload = {
      visitId: visit.id.toString(),
      exitTimestamp: new Date().toISOString(),
      tankerWashed: true,
    };

    // 1. Initial Gate Exit
    const req1 = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const res1 = await gateExitHandler(req1);
    const body1 = await res1.json();
    assert.equal(res1.status, 200, `Initial gate exit must return 200: ${JSON.stringify(body1)}`);
    assert.equal(body1.success, true);

    // Verify DB
    const gateLog = await prisma.gateLog.findUnique({ where: { visit_id: visit.id } });
    assert.ok(gateLog?.exit_timestamp, 'Exit timestamp must be recorded');
    const opCount = await prisma.operationIdempotencyRecord.count({ where: { key } });
    assert.equal(opCount, 1, 'Exactly 1 idempotency record must exist');

    // 2. Exact Replay
    const reqReplay = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const resReplay = await gateExitHandler(reqReplay);
    assert.equal(resReplay.status, 200);
    const bodyReplay = await resReplay.json();
    assert.equal(bodyReplay.is_replay, true, 'Exact replay must return is_replay: true');

    // 3. Changed payload under same key -> 409 Conflict
    const changedPayload = { ...payload, tankerWashed: false };
    const reqConflict = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(changedPayload),
    });
    const resConflict = await gateExitHandler(reqConflict);
    assert.equal(resConflict.status, 409, 'Modified payload under same key must return 409');

    // 4. Concurrent gate exit on another visit
    const concRunId = `CONC-EX-${Date.now()}`;
    const concKey = `CONC-KEY-${concRunId}`;
    const concVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `V-${concRunId}`,
        vehicle_number: `T-${concRunId}`,
        current_status: 'READY_FOR_GATE_EXIT',
        operational_date: new Date(),
        weight_ticket: {
          create: {
            ticket_number: `TK-CEX-${concRunId}`,
            gross_weight_kg: 28000,
            tare_weight_kg: 10000,
            net_weight_kg: 18000,
            gross_timestamp: new Date(Date.now() - 3000000),
            tare_timestamp: new Date(Date.now() - 1000000),
            gross_recorded_by: secUser.id,
            tare_recorded_by: secUser.id,
            gross_submitted_at: new Date(Date.now() - 3000000),
            tare_submitted_at: new Date(Date.now() - 1000000),
          },
        },
        gate_log: {
          create: {
            entry_timestamp: new Date(Date.now() - 3600000),
            entry_guard_id: secUser.id,
            entry_submitted_at: new Date(Date.now() - 3600000),
          },
        },
      },
    });

    try {
      const concPayload = {
        visitId: concVisit.id.toString(),
        exitTimestamp: new Date().toISOString(),
        tankerWashed: true,
      };
      const [resA, resB] = await Promise.all([
        gateExitHandler(new Request('http://localhost:3000/api/security/gate-exit', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
        gateExitHandler(new Request('http://localhost:3000/api/security/gate-exit', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
      ]);
      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);
      const bA = await resA.json();
      const bB = await resB.json();
      assert.ok(bA.is_replay || bB.is_replay, 'At least one concurrent request must be replay');
      const concOpCount = await prisma.operationIdempotencyRecord.count({ where: { key: concKey } });
      assert.equal(concOpCount, 1, 'Exactly 1 idempotency record for concurrent requests');
    } finally {
      await prisma.operationIdempotencyRecord.deleteMany({ where: { key: concKey } });
      await prisma.auditLog.deleteMany({ where: { record_id: concVisit.id } });
      await deleteWeightTicketsWithAudits(concVisit.id);
      await prisma.gateLog.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.vehicleVisit.delete({ where: { id: concVisit.id } });
    }
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key } });
    await prisma.auditLog.deleteMany({ where: { record_id: visit.id } });
    await deleteWeightTicketsWithAudits(visit.id);
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: Gross Weight replay, 409 conflict, and concurrent requests', async () => {
  assertTestDatabaseSafety();

  const wbUser = await prisma.user.findFirst({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  assert.ok(wbUser);
  const token = await createSessionToken({
    id: wbUser.id.toString(),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as Role,
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  });

  const runId = `GROSS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const key = `GROSS-KEY-${runId}`;

  // Vehicle ready for gross weight
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-${runId}`,
      vehicle_number: `T-GROSS-${runId}`,
      current_status: 'READY_FOR_GROSS',
      operational_date: new Date(),
      gate_log: {
        create: {
          entry_timestamp: new Date(Date.now() - 3600000),
          entry_guard_id: wbUser.id,
          entry_submitted_at: new Date(Date.now() - 3600000),
        },
      },
      portions: {
        create: {
          portion_number: 1,
          current_status: 'ACCEPTED',
          plant_decision: 'ACCEPTED',
        },
      },
    },
  });

  try {
    const payload = {
      visitId: visit.id.toString(),
      grossWeightKg: 28500,
      grossTimestamp: new Date().toISOString(),
    };

    // 1. Initial Gross Weight
    const req1 = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const res1 = await grossWeightHandler(req1);
    const body1 = await res1.json();
    assert.equal(res1.status, 200, `Gross weight initial must return 200: ${JSON.stringify(body1)}`);
    assert.equal(body1.success, true);
    assert.equal(body1.grossWeightKg, 28500);

    // Verify DB
    const ticket = await prisma.weightTicket.findUnique({ where: { visit_id: visit.id } });
    assert.ok(ticket);
    assert.equal(Number(ticket.gross_weight_kg), 28500);
    const opCount = await prisma.operationIdempotencyRecord.count({ where: { key } });
    assert.equal(opCount, 1);

    // 2. Exact Replay
    const reqReplay = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const resReplay = await grossWeightHandler(reqReplay);
    assert.equal(resReplay.status, 200);
    const bodyReplay = await resReplay.json();
    assert.equal(bodyReplay.is_replay, true);
    assert.equal(bodyReplay.grossWeightKg, 28500);

    // 3. Changed payload under same key -> 409 Conflict
    const changedPayload = { ...payload, grossWeightKg: 29000 };
    const reqConflict = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(changedPayload),
    });
    const resConflict = await grossWeightHandler(reqConflict);
    assert.equal(resConflict.status, 409, 'Modified gross weight under same key must return 409');

    // 4. Concurrent requests on another visit
    const concRunId = `CONC-GW-${Date.now()}`;
    const concKey = `CONC-KEY-${concRunId}`;
    const concVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `V-${concRunId}`,
        vehicle_number: `T-${concRunId}`,
        current_status: 'READY_FOR_GROSS',
        operational_date: new Date(),
        gate_log: {
          create: {
            entry_timestamp: new Date(Date.now() - 3600000),
            entry_guard_id: wbUser.id,
            entry_submitted_at: new Date(Date.now() - 3600000),
          },
        },
        portions: {
          create: {
            portion_number: 1,
            current_status: 'ACCEPTED',
            plant_decision: 'ACCEPTED',
          },
        },
      },
    });

    try {
      const concPayload = {
        visitId: concVisit.id.toString(),
        grossWeightKg: 30000,
        grossTimestamp: new Date().toISOString(),
      };
      const [resA, resB] = await Promise.all([
        grossWeightHandler(new Request('http://localhost:3000/api/scale/gross-weight', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
        grossWeightHandler(new Request('http://localhost:3000/api/scale/gross-weight', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
      ]);
      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);
      const bA = await resA.json();
      const bB = await resB.json();
      assert.ok(bA.is_replay || bB.is_replay);
      const concOpCount = await prisma.operationIdempotencyRecord.count({ where: { key: concKey } });
      assert.equal(concOpCount, 1);
    } finally {
      await prisma.operationIdempotencyRecord.deleteMany({ where: { key: concKey } });
      await deleteWeightTicketsWithAudits(concVisit.id);
      await prisma.visitPortion.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.gateLog.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.vehicleVisit.delete({ where: { id: concVisit.id } });
    }
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key } });
    await deleteWeightTicketsWithAudits(visit.id);
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});

test('apiRouteIdempotencyIntegration: Tare Weight atomic transaction, replay, 409 conflict, and concurrent requests', async () => {
  assertTestDatabaseSafety();

  const wbUser = await prisma.user.findFirst({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  assert.ok(wbUser);
  const token = await createSessionToken({
    id: wbUser.id.toString(),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as Role,
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  });

  const runId = `TARE-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const key = `TARE-KEY-${runId}`;

  // Vehicle ready for tare weight
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-${runId}`,
      vehicle_number: `T-TARE-${runId}`,
      current_status: 'READY_FOR_TARE',
      operational_date: new Date(),
      weight_ticket: {
        create: {
          ticket_number: `TK-${runId}`,
          gross_weight_kg: 28500,
          gross_timestamp: new Date(Date.now() - 1800000),
          gross_recorded_by: wbUser.id,
          gross_submitted_at: new Date(Date.now() - 1800000),
        },
      },
      portions: {
        create: {
          portion_number: 1,
          current_status: 'UNLOADED',
          plant_decision: 'ACCEPTED',
          first_weight_kg: 28500,
          first_weight_at: new Date(Date.now() - 1800000),
          first_weight_by_user_id: wbUser.id,
        },
      },
    },
  });

  try {
    const payload = {
      visitId: visit.id.toString(),
      tareWeightKg: 11200,
      tareTimestamp: new Date().toISOString(),
    };

    // 1. Initial Tare Weight (Atomicity check: mutation + audit + idempotency record in single transaction)
    const req1 = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const res1 = await tareWeightHandler(req1);
    const body1 = await res1.json();
    assert.equal(res1.status, 200, `Tare weight initial must return 200: ${JSON.stringify(body1)}`);
    assert.equal(body1.success, true);
    assert.equal(body1.tareWeightKg, 11200);
    assert.equal(body1.netWeightKg, 28500 - 11200);

    // Verify DB
    const ticket = await prisma.weightTicket.findUnique({ where: { visit_id: visit.id } });
    assert.ok(ticket);
    assert.equal(Number(ticket.tare_weight_kg), 11200);
    assert.equal(Number(ticket.net_weight_kg), 17300);

    const opRecord = await prisma.operationIdempotencyRecord.findUnique({ where: { key } });
    assert.ok(opRecord, 'Idempotency record must be committed atomically in the transaction');
    assert.equal(opRecord.operation_type, 'SCALE_TARE_WEIGHT');

    // 2. Exact Replay
    const reqReplay = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    const resReplay = await tareWeightHandler(reqReplay);
    assert.equal(resReplay.status, 200);
    const bodyReplay = await resReplay.json();
    assert.equal(bodyReplay.is_replay, true);
    assert.equal(bodyReplay.tareWeightKg, 11200);

    // 3. Changed payload under same key -> 409 Conflict
    const changedPayload = { ...payload, tareWeightKg: 12000 };
    const reqConflict = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(changedPayload),
    });
    const resConflict = await tareWeightHandler(reqConflict);
    assert.equal(resConflict.status, 409, 'Modified tare weight under same key must return 409');

    // 4. Concurrent tare weight requests
    const concRunId = `CONC-TW-${Date.now()}`;
    const concKey = `CONC-KEY-${concRunId}`;
    const concVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `V-${concRunId}`,
        vehicle_number: `T-${concRunId}`,
        current_status: 'READY_FOR_TARE',
        operational_date: new Date(),
        weight_ticket: {
          create: {
            ticket_number: `TK-${concRunId}`,
            gross_weight_kg: 28500,
            gross_timestamp: new Date(Date.now() - 1800000),
            gross_recorded_by: wbUser.id,
            gross_submitted_at: new Date(Date.now() - 1800000),
          },
        },
        portions: {
          create: {
            portion_number: 1,
            current_status: 'UNLOADED',
            plant_decision: 'ACCEPTED',
            first_weight_kg: 28500,
            first_weight_at: new Date(Date.now() - 1800000),
            first_weight_by_user_id: wbUser.id,
          },
        },
      },
    });

    try {
      const concPayload = {
        visitId: concVisit.id.toString(),
        tareWeightKg: 10500,
        tareTimestamp: new Date().toISOString(),
      };
      const [resA, resB] = await Promise.all([
        tareWeightHandler(new Request('http://localhost:3000/api/scale/tare-weight', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
        tareWeightHandler(new Request('http://localhost:3000/api/scale/tare-weight', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': concKey },
          body: JSON.stringify(concPayload),
        })),
      ]);
      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);
      const bA = await resA.json();
      const bB = await resB.json();
      assert.ok(bA.is_replay || bB.is_replay);
      const concOpCount = await prisma.operationIdempotencyRecord.count({ where: { key: concKey } });
      assert.equal(concOpCount, 1);
    } finally {
      await prisma.operationIdempotencyRecord.deleteMany({ where: { key: concKey } });
      await prisma.auditLog.deleteMany({ where: { record_id: concVisit.id } });
      await deleteWeightTicketsWithAudits(concVisit.id);
      await prisma.visitPortion.deleteMany({ where: { visit_id: concVisit.id } });
      await prisma.vehicleVisit.delete({ where: { id: concVisit.id } });
    }
  } finally {
    await prisma.operationIdempotencyRecord.deleteMany({ where: { key } });
    await prisma.auditLog.deleteMany({ where: { record_id: visit.id } });
    await deleteWeightTicketsWithAudits(visit.id);
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }
});
