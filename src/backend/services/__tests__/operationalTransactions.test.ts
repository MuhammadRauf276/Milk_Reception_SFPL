import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role, User } from '@/backend/core/types';
import { POST as gateEntryHandler } from '@/app/api/security/gate-entry/route';
import { POST as gateExitHandler } from '@/app/api/security/gate-exit/route';
import { POST as grossWeightHandler } from '@/app/api/scale/gross-weight/route';
import { POST as tareWeightHandler } from '@/app/api/scale/tare-weight/route';
import { POST as qaPortionsHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/route';
import { POST as qaCompleteHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { POST as unloadingStartHandler } from '@/app/api/production/vehicle-visits/[visitId]/portions/[portionId]/start/route';
import { POST as unloadingCompleteHandler } from '@/app/api/production/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';

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

test('operationalTransactions: Full plant vehicle reception lifecycle commits real database records and audit logs', async () => {
  assertTestDatabaseSafety();

  const runId = `OP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const testVehicle = `TEST-TK-${runId}`;
  const testVisitNum = `V-${runId}`;
  const tokenNumber = `TOK-${runId}`;

  // 1. Resolve active station operators
  const secUser = await prisma.user.findFirst({ where: { role: 'SECURITY_OPERATOR', is_active: true } });
  const qaUser = await prisma.user.findFirst({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  const wbUser = await prisma.user.findFirst({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  const prodUser = await prisma.user.findFirst({ where: { role: 'PRODUCTION_RECEPTION_OPERATOR', is_active: true } });

  assert.ok(secUser, 'Active SECURITY_OPERATOR required');
  assert.ok(qaUser, 'Active QA_LAB_ATTENDANT required');
  assert.ok(wbUser, 'Active WEIGHBRIDGE_OPERATOR required');
  assert.ok(prodUser, 'Active PRODUCTION_RECEPTION_OPERATOR required');

  const secToken = await createSessionToken({
    id: secUser.id.toString(),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as Role,
    department: 'Security',
    scope_type: 'DEPARTMENT',
  });

  const qaToken = await createSessionToken({
    id: qaUser.id.toString(),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as Role,
    department: 'QA',
    scope_type: 'DEPARTMENT',
  });

  const wbToken = await createSessionToken({
    id: wbUser.id.toString(),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as Role,
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  });

  const prodToken = await createSessionToken({
    id: prodUser.id.toString(),
    username: prodUser.username,
    name: prodUser.full_name || prodUser.username,
    role: prodUser.role as Role,
    department: 'Production',
    scope_type: 'DEPARTMENT',
  });

  // 2. Resolve destination active silo
  let silo = await prisma.silo.findFirst({ where: { is_active: true } });
  let createdSilo = false;
  if (!silo) {
    silo = await prisma.silo.create({
      data: {
        silo_code: `SILO-${runId.slice(0, 6)}`,
        silo_name: `Synthetic Test Silo ${runId}`,
        capacity_liters: 100000,
        is_active: true,
      },
    });
    createdSilo = true;
  }

  // 3. Step A: Dispatched Tanker Visit Creation (Source/Contractor dispatch)
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNum,
      vehicle_number: testVehicle,
      current_status: 'DISPATCHED',
      operational_date: new Date(),
    },
  });

  try {
    // 4. Step B: Security Gate Entry
    const entryOpId = `ENTRY-OP-${runId}`;
    const entryReq = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secToken}`,
        'idempotency-key': entryOpId,
      },
      body: JSON.stringify({
        visitId: visit.id.toString(),
        tokenNumber,
        entryTimestamp: new Date(Date.now() - 3600000).toISOString(),
      }),
    });

    const entryRes = await gateEntryHandler(entryReq);
    assert.equal(entryRes.status, 200, 'Gate entry must succeed with 200');
    const entryBody = await entryRes.json();
    assert.equal(entryBody.success, true);

    // Verify DB commit for Gate Entry
    const dbGateLog = await prisma.gateLog.findUnique({ where: { visit_id: visit.id } });
    assert.ok(dbGateLog, 'GateLog row must be committed to database');
    assert.ok(dbGateLog.entry_timestamp, 'GateLog must record entry timestamp');

    const dbVisitAfterEntry = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
    assert.equal(dbVisitAfterEntry?.current_status, 'TOKEN_ISSUED', 'Visit status must advance to TOKEN_ISSUED');

    // 5. Step C: QA Portion Creation & Completion
    const portionOpId = `PORTION-OP-${runId}`;
    const portionReq = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${qaToken}`,
      },
      body: JSON.stringify({ clientOperationId: portionOpId }),
    });

    const portionRes = await qaPortionsHandler(portionReq, {
      params: Promise.resolve({ visitId: visit.id.toString() }),
    });
    assert.equal(portionRes.status, 200, 'QA portion creation must succeed');
    const portionBody = await portionRes.json();
    const portionId = BigInt(portionBody.portion.id);

    // Verify DB commit and audit log for portion creation
    const dbPortion = await prisma.visitPortion.findUnique({ where: { id: portionId } });
    assert.ok(dbPortion, 'VisitPortion row must be committed to database');

    const portionAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'visit_portion',
        record_id: portionId,
        action: 'PLANT_QA_PORTION_ADDED',
      },
    });
    assert.ok(portionAudit, 'Audit log row must exist for PLANT_QA_PORTION_ADDED');

    // Assign plant lab tests and submit QA complete
    const assignedTests = await getOrAssignPlantQATests(prisma, visit.id);
    const testResults = assignedTests
      .filter((t) => t.result_type_snapshot !== 'CALCULATED')
      .map((t) => {
        const options = (t.result_options_snapshot as any[] | null) || null;
        const isOptions = Array.isArray(options) && options.length > 0;
        const selectedOption = isOptions
          ? (options.find((o) => (o.value || o.label)?.toUpperCase() === 'OK')?.value || options[0]?.value || 'OK')
          : null;
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED' as const,
          numericValue: isOptions ? null : t.test_code_snapshot === 'FAT' ? 4.2 : t.test_code_snapshot === 'LR' ? 28.5 : 1.0,
          textValue: isOptions ? selectedOption : null,
          photoUrl: 'http://example.com/test-photo.jpg',
        };
      });

    // Create QA testing session
    await prisma.qATestingSession.create({
      data: {
        visit: { connect: { id: visit.id } },
        starter: { connect: { id: qaUser.id } },
        started_at: new Date(Date.now() - 3600000),
        status: 'IN_PROGRESS',
      },
    });

    const completeOpId = `QA-COMP-${runId}`;
    const qaCompleteReq = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit.id}/portions/${portionId}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${qaToken}`,
      },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        action: 'DECIDE_NOW',
        completionClientEventId: completeOpId,
        sealNumber: 'SEAL-OP-001',
        operationalTimestamp: new Date(Date.now() - 3000000).toISOString(),
        results: testResults,
      }),
    });

    const qaCompleteRes = await qaCompleteHandler(qaCompleteReq, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portionId.toString() }),
    });
    const completeBody = await qaCompleteRes.json();
    assert.equal(qaCompleteRes.status, 200, `QA portion complete must succeed: ${JSON.stringify(completeBody)}`);

    // Verify portion decision accepted and transition to READY_FOR_GROSS
    const updatedPortion = await prisma.visitPortion.findUnique({ where: { id: portionId } });
    assert.equal(updatedPortion?.plant_decision, 'ACCEPTED', 'Portion must be ACCEPTED');

    await prisma.vehicleVisit.update({
      where: { id: visit.id },
      data: { current_status: 'READY_FOR_GROSS' },
    });

    // 6. Step D: Scale 1 Gross Weighing
    const grossOpId = `GROSS-OP-${runId}`;
    const grossReq = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wbToken}`,
        'idempotency-key': grossOpId,
      },
      body: JSON.stringify({
        visitId: visit.id.toString(),
        grossWeightKg: 28500,
        grossTimestamp: new Date().toISOString(),
      }),
    });

    const grossRes = await grossWeightHandler(grossReq);
    const grossBody = await grossRes.json();
    assert.equal(grossRes.status, 200, `Gross weight must succeed: ${JSON.stringify(grossBody)}`);
    assert.equal(grossBody.grossWeightKg, 28500);

    // Verify DB commit and audit log for Gross Weight
    const dbTicket = await prisma.weightTicket.findUnique({ where: { visit_id: visit.id } });
    assert.ok(dbTicket, 'WeightTicket row must be committed to database');
    assert.equal(Number(dbTicket.gross_weight_kg), 28500);

    const grossAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'weight_ticket',
        record_id: dbTicket.id,
        action: 'GROSS_WEIGHT_RECORDED',
      },
    });
    assert.ok(grossAudit, 'Audit log row must exist for GROSS_WEIGHT_RECORDED');

    // Advance visit to READY_FOR_UNLOADING
    await prisma.vehicleVisit.update({
      where: { id: visit.id },
      data: { current_status: 'READY_FOR_UNLOADING' },
    });

    // 7. Step E: Silo Unloading Start & Complete
    const startReq = new Request(`http://localhost:3000/api/production/vehicle-visits/${visit.id}/portions/${portionId}/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${prodToken}`,
      },
      body: JSON.stringify({
        siloId: silo.id.toString(),
        opTimestamp: new Date().toISOString(),
      }),
    });

    const startRes = await unloadingStartHandler(startReq as any, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portionId.toString() }),
    });
    const startBody = await startRes.json();
    assert.equal(startRes.status, 200, `Unloading start must succeed: ${JSON.stringify(startBody)}`);

    // Verify DB commit for Unloading Start
    const dbUnloadLog = await prisma.unloadingLog.findUnique({ where: { portion_id: portionId } });
    assert.ok(dbUnloadLog?.pump_start_timestamp, 'UnloadingLog must record pump_start_timestamp');
    assert.equal(dbUnloadLog.silo_id, silo.id);

    const completeUnloadReq = new Request(`http://localhost:3000/api/production/vehicle-visits/${visit.id}/portions/${portionId}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${prodToken}`,
      },
      body: JSON.stringify({
        opTimestamp: new Date().toISOString(),
      }),
    });

    const completeUnloadRes = await unloadingCompleteHandler(completeUnloadReq as any, {
      params: Promise.resolve({ visitId: visit.id.toString(), portionId: portionId.toString() }),
    });
    const completeUnloadBody = await completeUnloadRes.json();
    assert.equal(completeUnloadRes.status, 200, `Unloading completion must succeed: ${JSON.stringify(completeUnloadBody)}`);

    // Verify DB commit and audit log for Unloading Complete
    const dbUnloadAfterComplete = await prisma.unloadingLog.findUnique({ where: { portion_id: portionId } });
    assert.ok(dbUnloadAfterComplete?.pump_end_timestamp, 'UnloadingLog must record pump_end_timestamp');

    const dbVisitAfterUnload = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
    assert.equal(dbVisitAfterUnload?.current_status, 'READY_FOR_TARE', 'Visit status must advance to READY_FOR_TARE');

    const unloadAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'vehicle_visit',
        record_id: visit.id,
        action: 'UNLOADING_COMPLETED',
      },
    });
    assert.ok(unloadAudit, 'Audit log row must exist for UNLOADING_COMPLETED');

    // 8. Step F: Scale 2 Tare Weighing
    const tareOpId = `TARE-OP-${runId}`;
    const tareReq = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wbToken}`,
        'idempotency-key': tareOpId,
      },
      body: JSON.stringify({
        visitId: visit.id.toString(),
        tareWeightKg: 11200,
        tareTimestamp: new Date().toISOString(),
      }),
    });

    const tareRes = await tareWeightHandler(tareReq);
    const tareBody = await tareRes.json();
    assert.equal(tareRes.status, 200, `Tare weight must succeed: ${JSON.stringify(tareBody)}`);
    assert.equal(tareBody.tareWeightKg, 11200);
    assert.equal(tareBody.netWeightKg, 28500 - 11200);

    // Verify DB commit and audit log for Tare Weight
    const dbTicketAfterTare = await prisma.weightTicket.findUnique({ where: { visit_id: visit.id } });
    assert.equal(Number(dbTicketAfterTare?.tare_weight_kg), 11200);
    assert.equal(Number(dbTicketAfterTare?.net_weight_kg), 17300);

    const tareAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'weight_ticket',
        record_id: dbTicket.id,
        action: 'TARE_WEIGHT_RECORDED',
      },
    });
    assert.ok(tareAudit, 'Audit log row must exist for TARE_WEIGHT_RECORDED');

    // Advance visit to READY_FOR_GATE_EXIT
    await prisma.vehicleVisit.update({
      where: { id: visit.id },
      data: { current_status: 'READY_FOR_GATE_EXIT' },
    });

    // 9. Step G: Security Gate Exit
    const exitOpId = `EXIT-OP-${runId}`;
    const exitReq = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secToken}`,
        'idempotency-key': exitOpId,
      },
      body: JSON.stringify({
        visitId: visit.id.toString(),
        exitTimestamp: new Date().toISOString(),
        tankerWashed: true,
      }),
    });

    const exitRes = await gateExitHandler(exitReq);
    const exitBody = await exitRes.json();
    assert.equal(exitRes.status, 200, `Gate exit must succeed: ${JSON.stringify(exitBody)}`);
    assert.equal(exitBody.success, true);

    // Verify DB commit for Gate Exit
    const dbGateLogAfterExit = await prisma.gateLog.findUnique({ where: { visit_id: visit.id } });
    assert.ok(dbGateLogAfterExit?.exit_timestamp, 'GateLog must record exit timestamp');

    const dbVisitAfterExit = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
    assert.equal(dbVisitAfterExit?.current_status, 'COMPLETED', 'Visit status must be terminal COMPLETED');

    const exitAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'gate_log',
        record_id: dbGateLog.id,
        action: 'GATE_EXIT_RECORDED',
      },
    });
    assert.ok(exitAudit, 'Audit log row must exist for GATE_EXIT_RECORDED');
  } finally {
    // Comprehensive synthetic test cleanup
    await prisma.operationIdempotencyRecord.deleteMany({
      where: { key: { startsWith: runId } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { record_id: visit.id },
          { new_values: { path: ['visit_id'], equals: visit.id.toString() } },
        ],
      },
    });
    const portions = await prisma.visitPortion.findMany({ where: { visit_id: visit.id } });
    for (const p of portions) {
      await prisma.unloadingLog.deleteMany({ where: { portion_id: p.id } });
      await prisma.plantLabResult.deleteMany({ where: { portion_id: p.id } });
      await prisma.auditLog.deleteMany({ where: { record_id: p.id } });
    }
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: visit.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: visit.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
    if (createdSilo && silo) {
      await prisma.silo.delete({ where: { id: silo.id } }).catch(() => {});
    }
  }
});

test('operationalTransactions: MOT / ZMCC arrival record and audit persistence', async () => {
  assertTestDatabaseSafety();

  const runId = `MOT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const clientEventId = `EVENT-${runId}`;
  const zmccToken = `ZTOK-${runId}`;

  const pheUser = await prisma.user.findFirst({
    where: { role: 'PHE_OPERATOR', is_active: true },
  });
  assert.ok(pheUser, 'Active PHE_OPERATOR required');

  const zmcc = await prisma.procurementSource.findFirst({ where: { is_active: true } });
  assert.ok(zmcc, 'Active ZMCC required');

  let supplier = await prisma.zmccLocalSupplier.findFirst({ where: { zmcc_id: zmcc.id, is_active: true } });
  let createdSupplier = false;
  if (!supplier) {
    supplier = await prisma.zmccLocalSupplier.create({
      data: {
        local_supplier_code: `SUP-${runId.slice(0, 8)}`,
        name: `Supplier ${runId}`,
        phone: '0300-1234567',
        is_active: true,
        zmcc_id: zmcc.id,
        created_by_user_id: pheUser.id,
      },
    });
    createdSupplier = true;
  }

  // Create synthetic ZMCC supplier arrival
  const supplierArrival = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: zmcc.id,
      local_supplier_id: supplier.id,
      vehicle_number: `TK-${runId.slice(0, 8)}`,
      arrival_timestamp: new Date(),
      arrival_date: new Date(),
      zmcc_token: zmccToken,
      client_event_id: clientEventId,
      recorded_by_user_id: pheUser.id,
    },
  });

  try {
    assert.ok(supplierArrival.id, 'ZmccLocalSupplierArrival must be assigned an ID');
    assert.equal(supplierArrival.client_event_id, clientEventId);

    // Write audit log
    await writeAuditLog(prisma, {
      tableName: 'zmcc_local_supplier_arrival',
      recordId: supplierArrival.id,
      action: 'ZMCC_ARRIVAL_RECORDED',
      newValues: {
        arrival_id: supplierArrival.id.toString(),
        zmcc_token: zmccToken,
        client_event_id: clientEventId,
      },
      actor: auditActorFromUser(pheUser),
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        record_id: supplierArrival.id,
        action: 'ZMCC_ARRIVAL_RECORDED',
      },
    });

    assert.ok(audit, 'Audit log row must be committed to database');
    assert.equal(audit.table_name, 'zmcc_local_supplier_arrival');
    assert.equal(audit.action, 'ZMCC_ARRIVAL_RECORDED');
  } finally {
    await prisma.auditLog.deleteMany({ where: { record_id: supplierArrival.id } });
    await prisma.zmccLocalSupplierArrival.delete({ where: { id: supplierArrival.id } });
    if (createdSupplier && supplier) {
      await prisma.zmccLocalSupplier.delete({ where: { id: supplier.id } }).catch(() => {});
    }
  }
});
