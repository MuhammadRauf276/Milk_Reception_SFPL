import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role } from '@/backend/core/types';
import { POST as startDispatchHandler } from '@/app/api/dispatches/start/route';
import { POST as submitDispatchHandler } from '@/app/api/dispatches/route';
import { POST as gateEntryHandler } from '@/app/api/security/gate-entry/route';
import { POST as gateExitHandler } from '@/app/api/security/gate-exit/route';
import { POST as grossWeightHandler } from '@/app/api/scale/gross-weight/route';
import { POST as tareWeightHandler } from '@/app/api/scale/tare-weight/route';
import { POST as qaPortionsHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/route';
import { POST as qaCompleteHandler } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { POST as unloadingStartHandler } from '@/app/api/production/vehicle-visits/[visitId]/portions/[portionId]/start/route';
import { POST as unloadingCompleteHandler } from '@/app/api/production/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';
import { getDispatchResources } from '@/backend/services/dispatch/dispatchResourceService';
import { decideDispatchApproval } from '@/backend/services/dispatch/dispatchDecisionService';

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

test('ZMCC Dispatch to Plant Gate Reception & Resource Release Complete Lifecycle', async () => {
  assertTestDatabaseSafety();

  const runId = `E2E-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const tokenNumber = `TOK-${runId}`;

  // 1. Verify Hasilpur dispatch resources and find an available vehicle & MOT escort
  const initialResources = await getDispatchResources(BigInt(1));
  assert.equal(initialResources.sourceType, 'ZMCC');
  assert.ok(initialResources.vehicles.length >= 10, 'Expected at least 10 vehicles configured for Hasilpur');
  assert.ok(initialResources.motProfiles.length >= 6, 'Expected at least 6 MOT escorts configured for Hasilpur');

  const availableVehicles = initialResources.vehicles.filter((v) => v.is_available);
  const availableMots = initialResources.motProfiles.filter((m) => m.is_available);
  assert.ok(availableVehicles.length > 0, 'Must have at least one free vehicle available for dispatch');
  assert.ok(availableMots.length > 0, 'Must have at least one free MOT escort available for dispatch');

  const selectedVehicle = availableVehicles[0];
  const selectedMot = availableMots[0];
  console.log(`[E2E] Testing with Vehicle: ${selectedVehicle.vehicle_number} (id: ${selectedVehicle.id}), MOT Escort: ${selectedMot.name} (${selectedMot.mot_code})`);

  // 2. Resolve users for each station
  const zmccUser = await prisma.user.findFirst({
    where: { role: 'ZMCC_LAB_ATTENDANT', procurement_source_id: BigInt(1), is_active: true },
  });
  const zmccManagerDb = await prisma.user.findFirst({
    where: { role: 'ZMCC_MANAGER', procurement_source_id: BigInt(1), is_active: true },
    include: { procurement_source: true },
  });
  const secUser = await prisma.user.findFirst({ where: { role: 'SECURITY_OPERATOR', is_active: true } });
  const qaUser = await prisma.user.findFirst({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  const wbUser = await prisma.user.findFirst({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  const prodUser = await prisma.user.findFirst({ where: { role: 'PRODUCTION_RECEPTION_OPERATOR', is_active: true } });

  assert.ok(zmccUser, 'Active ZMCC_LAB_ATTENDANT bound to source 1 required');
  assert.ok(zmccManagerDb, 'Active ZMCC_MANAGER bound to source 1 required');
  assert.ok(secUser, 'Active SECURITY_OPERATOR required');
  assert.ok(qaUser, 'Active QA_LAB_ATTENDANT required');
  assert.ok(wbUser, 'Active WEIGHBRIDGE_OPERATOR required');
  assert.ok(prodUser, 'Active PRODUCTION_RECEPTION_OPERATOR required');

  const zmccManager = {
    id: zmccManagerDb.id.toString(),
    username: zmccManagerDb.username,
    name: zmccManagerDb.full_name || zmccManagerDb.username,
    role: zmccManagerDb.role as Role,
    department: zmccManagerDb.department || 'MPD',
    procurement_source_id: zmccManagerDb.procurement_source_id ? zmccManagerDb.procurement_source_id.toString() : null,
    procurement_source: zmccManagerDb.procurement_source
      ? {
          id: zmccManagerDb.procurement_source.id.toString(),
          code: zmccManagerDb.procurement_source.code,
          name: zmccManagerDb.procurement_source.name,
          source_type: zmccManagerDb.procurement_source.source_type,
          is_active: zmccManagerDb.procurement_source.is_active,
        }
      : null,
  };

  const zmccToken = await createSessionToken({
    id: zmccUser.id.toString(),
    username: zmccUser.username,
    name: zmccUser.full_name || zmccUser.username,
    role: zmccUser.role as Role,
    department: 'MPD',
    scope_type: 'SOURCE',
    procurement_source_id: '1',
  });

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

  // Ensure active silo exists
  let silo = await prisma.silo.findFirst({ where: { is_active: true } });
  if (!silo) {
    silo = await prisma.silo.create({
      data: {
        silo_code: `SILO-${runId.slice(0, 6)}`,
        silo_name: `Synthetic Test Silo ${runId}`,
        capacity_liters: 100000,
        is_active: true,
      },
    });
  }

  // 3. STEP A: Start ZMCC Dispatch Draft
  const startReq = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${zmccToken}`,
    },
    body: JSON.stringify({
      vehicleNumber: selectedVehicle.vehicle_number,
      motVehicleId: selectedVehicle.id,
      motProfileId: selectedMot.id,
      procurementSourceId: '1',
    }),
  });

  const startRes = await startDispatchHandler(startReq);
  const startBody = await startRes.json();
  assert.equal(startRes.status, 201, `Dispatch start failed: ${JSON.stringify(startBody)}`);
  assert.ok(startBody.visitId, 'visitId must be returned from start');
  const visitId = BigInt(startBody.visitId);

  // 4. STEP B: Submit Dispatch Request to Approver
  const dispatchTimestamp = new Date().toISOString();
  const submitReq = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${zmccToken}`,
    },
    body: JSON.stringify({
      visitId: visitId.toString(),
      vehicleNumber: selectedVehicle.vehicle_number,
      motVehicleId: selectedVehicle.id,
      motProfileId: selectedMot.id,
      operationalDate: new Date().toISOString().split('T')[0],
      procurementSourceId: '1',
      rawMilkDispatchNoteNumber: String(Math.floor(100000 + Math.random() * 900000)),
      action: 'SEND_REQUEST',
      decisionRemarks: 'Dispatched for test under manager approval',
      vehicleQuantity: {
        value: 12000,
        unit: 'KG',
        basis: 'MEASURED',
      },
      vehicleLr: 28.5,
      vehicleFat: 4.2,
      portions: [
        {
          portionNumber: 1,
          quantity: {
            value: 12000,
            unit: 'KG',
            basis: 'MEASURED',
            lr: 28.5,
            fat: 4.2,
          },
          dispatchTimestamp,
          seal_number: `SL-${runId}-1`,
        },
      ],
    }),
  });

  const submitRes = await submitDispatchHandler(submitReq);
  const submitBody = await submitRes.json();
  assert.equal(submitRes.status, 201, `Dispatch submit failed: ${JSON.stringify(submitBody)}`);

  // 5. STEP C: ZMCC Manager Approves the Dispatch
  const visitForApproval = await prisma.vehicleVisit.findUnique({
    where: { id: visitId },
    select: { dispatch_version: true, approval_status: true, current_status: true },
  });
  assert.ok(visitForApproval, 'Visit must exist');
  assert.equal(visitForApproval.approval_status, 'PENDING');

  const approvalResult = await decideDispatchApproval(
    zmccManager as any,
    null,
    visitId,
    {
      verdict: 'OKAY',
      version: visitForApproval.dispatch_version,
      remarks: 'Approved by ZMCC Manager for transit',
    }
  );
  assert.equal(approvalResult.status, 200, `Manager approval failed: ${approvalResult.error}`);

  // Verify DB state of visit
  const dbVisitDispatched = await prisma.vehicleVisit.findUnique({
    where: { id: visitId },
  });
  assert.ok(dbVisitDispatched, 'Visit must exist in DB');
  assert.equal(dbVisitDispatched.current_status, 'DISPATCHED');
  assert.equal(dbVisitDispatched.mot_vehicle_id?.toString(), selectedVehicle.id);
  assert.equal(dbVisitDispatched.mot_profile_id?.toString(), selectedMot.id);

  // 6. STEP D: Verify that Vehicle and MOT Escort are now marked BUSY
  const busyResources = await getDispatchResources(BigInt(1));
  const checkBusyVeh = busyResources.vehicles.find((v) => v.id === selectedVehicle.id);
  const checkBusyMot = busyResources.motProfiles.find((m) => m.id === selectedMot.id);
  assert.ok(checkBusyVeh, 'Vehicle must be in resources');
  assert.equal(checkBusyVeh.is_available, false, 'Dispatched vehicle must be marked busy');
  assert.match(checkBusyVeh.busy_reason || '', /In transit|plant/i);

  assert.ok(checkBusyMot, 'MOT Escort must be in resources');
  assert.equal(checkBusyMot.is_available, false, 'Dispatched MOT escort must be marked busy');
  assert.match(checkBusyMot.busy_reason || '', /Escorting an active dispatch/i);

  try {
    // 7. STEP E: Security Gate Entry
    const entryReq = new Request('http://localhost:3000/api/security/gate-entry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secToken}`,
        'idempotency-key': `ENTRY-${runId}`,
      },
      body: JSON.stringify({
        visitId: visitId.toString(),
        tokenNumber,
        entryTimestamp: new Date().toISOString(),
      }),
    });
    const entryRes = await gateEntryHandler(entryReq);
    const entryBody = await entryRes.json();
    assert.equal(entryRes.status, 200, `Gate entry failed: ${JSON.stringify(entryBody)}`);
    assert.equal(entryBody.success, true);

    const dbVisitAfterEntry = await prisma.vehicleVisit.findUnique({ where: { id: visitId } });
    assert.equal(dbVisitAfterEntry?.current_status, 'TOKEN_ISSUED');

    // 8. STEP F: QA Reception Testing & Acceptance
    const dispatchedPortion = await prisma.visitPortion.findFirst({
      where: { visit_id: visitId },
      orderBy: { portion_number: 'asc' },
    });
    assert.ok(dispatchedPortion, 'Dispatched portion must exist');
    const qaPortionId = dispatchedPortion.id;

    // Assign lab tests & create session
    const assignedTests = await getOrAssignPlantQATests(prisma, visitId);
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
          numericValue: isOptions ? null : t.test_code_snapshot === 'FAT' ? 4.2 : t.test_code_snapshot === 'LR' ? 28.5 : 0.0,
          textValue: isOptions ? selectedOption : null,
          photoUrl: 'http://example.com/photo.jpg',
        };
      });

    await prisma.qATestingSession.create({
      data: {
        visit: { connect: { id: visitId } },
        starter: { connect: { id: qaUser.id } },
        started_at: new Date(),
        status: 'IN_PROGRESS',
      },
    });

    const qaCompleteReq = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visitId}/portions/${qaPortionId}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${qaToken}`,
      },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        action: 'DECIDE_NOW',
        completionClientEventId: `QA-C-${runId}`,
        sealNumber: `SL-${runId}-1`,
        operationalTimestamp: new Date().toISOString(),
        results: testResults,
      }),
    });
    const qaCompleteRes = await qaCompleteHandler(qaCompleteReq, {
      params: Promise.resolve({ visitId: visitId.toString(), portionId: qaPortionId.toString() }),
    });
    const qaCompleteBody = await qaCompleteRes.json();
    assert.equal(qaCompleteRes.status, 200, `QA complete failed: ${JSON.stringify(qaCompleteBody)}`);

    await prisma.vehicleVisit.update({
      where: { id: visitId },
      data: { current_status: 'READY_FOR_GROSS' },
    });

    // 9. STEP G: Weighbridge Gross Weight
    const grossReq = new Request('http://localhost:3000/api/scale/gross-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wbToken}`,
        'idempotency-key': `GROSS-${runId}`,
      },
      body: JSON.stringify({
        visitId: visitId.toString(),
        grossWeightKg: 26000,
        grossTimestamp: new Date().toISOString(),
      }),
    });
    const grossRes = await grossWeightHandler(grossReq);
    const grossBody = await grossRes.json();
    assert.equal(grossRes.status, 200, `Gross weight failed: ${JSON.stringify(grossBody)}`);
    assert.equal(grossBody.grossWeightKg, 26000);

    await prisma.vehicleVisit.update({
      where: { id: visitId },
      data: { current_status: 'READY_FOR_UNLOADING' },
    });

    // 10. STEP H: Silo Unloading Start & Complete
    const unloadStartReq = new Request(`http://localhost:3000/api/production/vehicle-visits/${visitId}/portions/${qaPortionId}/start`, {
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
    const unloadStartRes = await unloadingStartHandler(unloadStartReq as any, {
      params: Promise.resolve({ visitId: visitId.toString(), portionId: qaPortionId.toString() }),
    });
    assert.equal(unloadStartRes.status, 200, 'Unloading start must succeed');

    const unloadCompleteReq = new Request(`http://localhost:3000/api/production/vehicle-visits/${visitId}/portions/${qaPortionId}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${prodToken}`,
      },
      body: JSON.stringify({
        opTimestamp: new Date().toISOString(),
      }),
    });
    const unloadCompleteRes = await unloadingCompleteHandler(unloadCompleteReq as any, {
      params: Promise.resolve({ visitId: visitId.toString(), portionId: qaPortionId.toString() }),
    });
    assert.equal(unloadCompleteRes.status, 200, 'Unloading complete must succeed');

    const dbVisitAfterUnload = await prisma.vehicleVisit.findUnique({ where: { id: visitId } });
    assert.equal(dbVisitAfterUnload?.current_status, 'READY_FOR_TARE');

    // 11. STEP I: Weighbridge Tare Weight
    const tareReq = new Request('http://localhost:3000/api/scale/tare-weight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wbToken}`,
        'idempotency-key': `TARE-${runId}`,
      },
      body: JSON.stringify({
        visitId: visitId.toString(),
        tareWeightKg: 14000,
        tareTimestamp: new Date().toISOString(),
      }),
    });
    const tareRes = await tareWeightHandler(tareReq);
    const tareBody = await tareRes.json();
    assert.equal(tareRes.status, 200, `Tare weight failed: ${JSON.stringify(tareBody)}`);
    assert.equal(tareBody.tareWeightKg, 14000);
    assert.equal(tareBody.netWeightKg, 12000);

    await prisma.vehicleVisit.update({
      where: { id: visitId },
      data: { current_status: 'READY_FOR_GATE_EXIT' },
    });

    // 12. STEP J: Security Gate Exit
    const exitReq = new Request('http://localhost:3000/api/security/gate-exit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secToken}`,
        'idempotency-key': `EXIT-${runId}`,
      },
      body: JSON.stringify({
        visitId: visitId.toString(),
        exitTimestamp: new Date().toISOString(),
        tankerWashed: true,
      }),
    });
    const exitRes = await gateExitHandler(exitReq);
    const exitBody = await exitRes.json();
    assert.equal(exitRes.status, 200, `Gate exit failed: ${JSON.stringify(exitBody)}`);
    assert.equal(exitBody.success, true);

    const dbVisitTerminal = await prisma.vehicleVisit.findUnique({ where: { id: visitId } });
    assert.equal(dbVisitTerminal?.current_status, 'COMPLETED');

    // 13. STEP K: Verify Vehicle and MOT Escort are now freed and available again!
    const releasedResources = await getDispatchResources(BigInt(1));
    const checkReleasedVeh = releasedResources.vehicles.find((v) => v.id === selectedVehicle.id);
    const checkReleasedMot = releasedResources.motProfiles.find((m) => m.id === selectedMot.id);

    assert.ok(checkReleasedVeh, 'Vehicle must be present in released resources');
    assert.equal(checkReleasedVeh.is_available, true, `Vehicle ${selectedVehicle.vehicle_number} must be released and marked available after gate exit`);
    assert.equal(checkReleasedVeh.busy_reason, undefined);

    assert.ok(checkReleasedMot, 'MOT Escort must be present in released resources');
    assert.equal(checkReleasedMot.is_available, true, `MOT Escort ${selectedMot.name} must be released and marked available after gate exit`);
    assert.equal(checkReleasedMot.busy_reason, undefined);

    console.log(`[E2E] SUCCESS: Complete lifecycle executed! Vehicle ${selectedVehicle.vehicle_number} and MOT Escort ${selectedMot.name} are released and available.`);
  } finally {
    // Clean up test records
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { record_id: visitId },
          { table_name: 'vehicle_visit', record_id: visitId },
        ],
      },
    }).catch(() => {});
  }
});
