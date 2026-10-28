import 'dotenv/config';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../core/db';
import {
  setupLabPortions,
  discardEmptyPortion,
  addLabPortion,
  getArrivalsQueue,
} from '../zmccLabService';
import { rollUpLabSessionTx } from '../zmcc/labPortionReviewService';
import { listWeighingQueue, saveWeighingValues } from '../zmccTankService';
import { getWeighingPolicy, updateWeighingPolicy } from '../zmccWeighingPolicyService';
import type { ActingContext } from '@/types/acting';
import type { User } from '@/backend/core/types';

describe('10-Vehicle Permutations & Lifecycle Suite', () => {
  let zmccId: bigint;
  let supplierId: bigint;
  let testUser: User;
  let labAttendantCtx: ActingContext;
  let superAdminCtx: ActingContext;
  let initialPolicy: { manual_entry_enabled: boolean; allowed_units: string };

  const testTokens: string[] = [];

  before(async () => {
    // 1. Resolve ZMCC
    const zmcc = await prisma.procurementSource.findUnique({ where: { id: BigInt(1) } });
    if (!zmcc) throw new Error('ZMCC 1 not found for testing');
    zmccId = zmcc.id;

    // 2. Resolve Supplier
    let supplier = await prisma.zmccLocalSupplier.findFirst({ where: { zmcc_id: zmccId, is_active: true } });
    if (!supplier) {
      const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      supplier = await prisma.zmccLocalSupplier.create({
        data: {
          local_supplier_code: 'ZLS-TEST-999',
          name: 'Lifecycle Test Supplier',
          phone: '0300-1112233',
          cnic: '31202-1112233-1',
          is_active: true,
          zmcc_id: zmccId,
          created_by_user_id: admin?.id ?? BigInt(1),
        },
      });
    }
    supplierId = supplier.id;

    // 3. Resolve Lab User
    let dbLabUser = await prisma.user.findFirst({
      where: { role: 'ZMCC_LAB_ATTENDANT', procurement_source_id: zmccId, is_active: true },
    });
    if (!dbLabUser) {
      dbLabUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', is_active: true },
      });
    }

    if (!dbLabUser) throw new Error('No active user found for test context');

    testUser = {
      id: dbLabUser.id.toString(),
      username: dbLabUser.username,
      name: dbLabUser.full_name || dbLabUser.username,
      role: dbLabUser.role as any,
      department: 'ZMCC',
      procurement_source_id: zmccId.toString(),
    };

    labAttendantCtx = {
      userId: dbLabUser.id,
      actorRole: 'ZMCC_LAB_ATTENDANT',
      actingAs: 'ZMCC_LAB_ATTENDANT',
      isDelegated: false,
      scope: { kind: 'SOURCE', sourceId: zmccId, sourceType: 'ZMCC' },
    };

    superAdminCtx = {
      userId: dbLabUser.id,
      actorRole: 'SUPER_ADMIN',
      actingAs: 'SUPER_ADMIN',
      isDelegated: false,
      scope: { kind: 'SYSTEM' },
    };

    // 4. Save current weighing policy
    const pol = await getWeighingPolicy();
    initialPolicy = { manual_entry_enabled: pol.manual_entry_enabled, allowed_units: pol.allowed_units };
  });

  after(async () => {
    // Restore policy
    await updateWeighingPolicy(superAdminCtx, initialPolicy);

    // Clean up all seeded test tokens
    for (const tok of testTokens) {
      try {
        const arr = await prisma.zmccLocalSupplierArrival.findFirst({
          where: { zmcc_token: tok },
          include: { lab_session: { include: { portions: true } } },
        });
        if (arr) {
          if (arr.lab_session) {
            await prisma.zmccLabPortion.deleteMany({ where: { lab_session_id: arr.lab_session.id } });
            await prisma.zmccLabSession.delete({ where: { id: arr.lab_session.id } });
          }
          await prisma.zmccLocalSupplierArrival.delete({ where: { id: arr.id } });
        }
      } catch (err) {
        console.error('Cleanup error for token', tok, err);
      }
    }
  });

  async function createVehicleArrival(token: string, vehicleNo: string, portionCount: number) {
    testTokens.push(token);

    // Remove existing if present
    const existing = await prisma.zmccLocalSupplierArrival.findFirst({
      where: { zmcc_token: token },
      include: { lab_session: true },
    });
    if (existing) {
      if (existing.lab_session) {
        await prisma.zmccLabPortion.deleteMany({ where: { lab_session_id: existing.lab_session.id } });
        await prisma.zmccLabSession.delete({ where: { id: existing.lab_session.id } });
      }
      await prisma.zmccLocalSupplierArrival.delete({ where: { id: existing.id } });
    }

    const arrival = await prisma.zmccLocalSupplierArrival.create({
      data: {
        client_event_id: `EV-${token}`,
        zmcc_id: zmccId,
        local_supplier_id: supplierId,
        zmcc_token: token,
        vehicle_number: vehicleNo,
        arrival_timestamp: new Date(),
        arrival_date: new Date(),
        recorded_by_user_id: labAttendantCtx.userId,
      },
    });

    const session = await prisma.zmccLabSession.create({
      data: {
        arrival_type: 'HC',
        local_supplier_arrival_id: arrival.id,
        zmcc_id: zmccId,
        test_mode: portionCount > 1 ? 'PORTION_WISE' : 'COMPOSITE',
        status: 'IN_PROGRESS',
        started_at: new Date(),
        started_by_user_id: labAttendantCtx.userId,
      },
    });

    for (let i = 1; i <= portionCount; i++) {
      await prisma.zmccLabPortion.create({
        data: {
          lab_session_id: session.id,
          portion_number: i,
          gross_liters: 1500,
          density: 1.028,
          lr: 28.5,
          fat: 4.10,
          snf: 8.5,
          ts: 12.6,
          person_decision: null,
          final_decision: 'PENDING',
        },
      });
    }

    return { arrival, session };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 1: 3 of 3 Accepted -> N+1 = 4 Scale Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 1: All 3 portions accepted -> COMPLETED, exits Arrivals Queue, enters Weighing with N+1=4 weights', async () => {
    const token = `TEST-V1-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0001', 3);

    // Accept all 3 portions
    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { person_decision: 'ACCEPTED', final_decision: 'ACCEPTED' },
    });

    // Rollup session
    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    // 1. Session status rollup
    const updated = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.final_decision, 'ACCEPTED');

    // 2. Arrivals Queue Exclusion
    const queueRes = await getArrivalsQueue(testUser);
    assert.equal(queueRes.status, 200);
    const inQueue = (queueRes.data as any[]).some((item: any) => item.zmcc_token === token);
    assert.equal(inQueue, false, 'Vehicle 1 must not be in arrivals queue');

    // 3. Weighbridge Queue Inclusion
    const weighRes = await listWeighingQueue(labAttendantCtx);
    assert.equal(weighRes.status, 200);
    const readyItem = weighRes.data?.ready.find((s) => s.session_id === session.id.toString());
    assert.ok(readyItem, 'Vehicle 1 must appear in weighing queue');
    assert.equal(readyItem.portions.length, 3, 'Should have 3 accepted portions');

    // 4. Weighing Execution (N+1 = 4 scale weights: 16000, 12500, 9300, 6300)
    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [16000, 12500, 9300, 6300],
    });
    assert.equal(saveRes.status, 200);
    const savedSession = saveRes.data?.session;
    assert.ok(savedSession);
    assert.equal(savedSession.portions[0].net_weight_kg, 3500);
    assert.equal(savedSession.portions[1].net_weight_kg, 3200);
    assert.equal(savedSession.portions[2].net_weight_kg, 3000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 2: All 3 Portions Rejected -> Excluded from Weighing
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 2: All 3 portions rejected -> COMPLETED (REJECTED), excluded from Weighing Queue', async () => {
    const token = `TEST-V2-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0002', 3);

    // Reject all 3 portions
    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { person_decision: 'REJECTED', final_decision: 'REJECTED' },
    });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const updated = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.final_decision, 'REJECTED');

    // Excluded from Arrivals Queue
    const queueRes = await getArrivalsQueue(testUser);
    const inQueue = (queueRes.data as any[]).some((item: any) => item.zmcc_token === token);
    assert.equal(inQueue, false);

    // Excluded from Weighbridge Queue
    const weighRes = await listWeighingQueue(labAttendantCtx);
    const readyItem = weighRes.data?.ready.find((s) => s.session_id === session.id.toString());
    assert.equal(readyItem, undefined, 'Vehicle with 0 accepted portions must NOT appear in weighing queue');

    // Attempting to save weights throws 409 Conflict
    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [15000, 10000],
    });
    assert.equal(saveRes.status, 409, 'Must block weighing when no accepted milk exists');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 3: 2 Accepted, 1 Rejected -> N+1 = 3 Scale Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 3: 2 Accepted, 1 Rejected -> Weighbridge prompts for N+1 = 3 weights (2 accepted portions only)', async () => {
    const token = `TEST-V3-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0003', 3);

    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });

    await prisma.zmccLabPortion.update({ where: { id: portions[0].id }, data: { final_decision: 'ACCEPTED' } });
    await prisma.zmccLabPortion.update({ where: { id: portions[1].id }, data: { final_decision: 'ACCEPTED' } });
    await prisma.zmccLabPortion.update({ where: { id: portions[2].id }, data: { final_decision: 'REJECTED' } });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const updated = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.final_decision, 'ACCEPTED');

    // Weighing Queue has only the 2 ACCEPTED portions
    const weighRes = await listWeighingQueue(labAttendantCtx);
    const readyItem = weighRes.data?.ready.find((s) => s.session_id === session.id.toString());
    assert.ok(readyItem);
    assert.equal(readyItem.portions.length, 2, 'Must only prompt for the 2 accepted portions');

    // N+1 = 3 scale weights: [16000, 12500, 9300]
    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [16000, 12500, 9300],
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data?.session.portions[0].net_weight_kg, 3500);
    assert.equal(saveRes.data?.session.portions[1].net_weight_kg, 3200);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 4: 1 Accepted, 2 Rejected -> N+1 = 2 Scale Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 4: 1 Accepted, 2 Rejected -> Weighbridge prompts for N+1 = 2 weights (single accepted portion)', async () => {
    const token = `TEST-V4-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0004', 3);

    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });

    await prisma.zmccLabPortion.update({ where: { id: portions[0].id }, data: { final_decision: 'ACCEPTED' } });
    await prisma.zmccLabPortion.update({ where: { id: portions[1].id }, data: { final_decision: 'REJECTED' } });
    await prisma.zmccLabPortion.update({ where: { id: portions[2].id }, data: { final_decision: 'REJECTED' } });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const weighRes = await listWeighingQueue(labAttendantCtx);
    const readyItem = weighRes.data?.ready.find((s) => s.session_id === session.id.toString());
    assert.ok(readyItem);
    assert.equal(readyItem.portions.length, 1);

    // N+1 = 2 weights: [16000, 12500] -> Net = 3,500 kg
    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [16000, 12500],
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data?.session.portions[0].net_weight_kg, 3500);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 5: Dual Compartment — Both Accepted -> N+1 = 3 Scale Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 5: Dual compartment (2 of 2 Accepted) -> N+1 = 3 weights', async () => {
    const token = `TEST-V5-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0005', 2);

    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { final_decision: 'ACCEPTED' },
    });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [12000, 7000, 2000],
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data?.session.portions[0].net_weight_kg, 5000);
    assert.equal(saveRes.data?.session.portions[1].net_weight_kg, 5000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 6: Dual Compartment — 1 Accepted, 1 Rejected -> N+1 = 2 Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 6: Dual compartment (1 Accepted, 1 Rejected) -> N+1 = 2 weights', async () => {
    const token = `TEST-V6-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0006', 2);

    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });

    await prisma.zmccLabPortion.update({ where: { id: portions[0].id }, data: { final_decision: 'ACCEPTED' } });
    await prisma.zmccLabPortion.update({ where: { id: portions[1].id }, data: { final_decision: 'REJECTED' } });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [12000, 7000],
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data?.session.portions[0].net_weight_kg, 5000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 7: Single Portion Accepted -> N+1 = 2 Weights
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 7: Single portion vehicle accepted -> N+1 = 2 weights (Gross & Tare)', async () => {
    const token = `TEST-V7-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0007', 1);

    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { final_decision: 'ACCEPTED' },
    });

    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const saveRes = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [8000, 5000],
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data?.session.portions[0].net_weight_kg, 3000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 8: Discard Virgin Portions Lifecycle -> Immediate Rollup & Removal
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 8: Discard virgin portions -> triggers automatic rollup to COMPLETED and clears Arrivals Queue', async () => {
    const token = `TEST-V8-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0008', 3);

    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });

    // Accept Portion 1
    await prisma.zmccLabPortion.update({
      where: { id: portions[0].id },
      data: { person_decision: 'ACCEPTED', final_decision: 'ACCEPTED' },
    });

    // Discard Portion 3
    const discard3 = await discardEmptyPortion(testUser, session.id.toString(), 3);
    assert.equal(discard3.status, 200, `Discard portion 3 failed: ${discard3.error}`);

    // Discard Portion 2
    const discard2 = await discardEmptyPortion(testUser, session.id.toString(), 2);
    assert.equal(discard2.status, 200, `Discard portion 2 failed: ${discard2.error}`);

    // Verify session automatically rolled up to COMPLETED!
    const updated = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(updated.status, 'COMPLETED', 'Session must roll up to COMPLETED when empty portions are discarded');
    assert.equal(updated.final_decision, 'ACCEPTED');

    // Verify Arrivals Queue has no ghost entry
    const queueRes = await getArrivalsQueue(testUser);
    const inQueue = (queueRes.data as any[]).some((item: any) => item.zmcc_token === token);
    assert.equal(inQueue, false, 'Vehicle 8 must not remain in arrivals queue');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 9: Reopening Lifecycle via Dynamic +Portion
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 9: Dynamic +Portion appends compartment -> reverts session to IN_PROGRESS and re-enters Arrivals Queue', async () => {
    const token = `TEST-V9-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0009', 1);

    // Accept portion 1 and complete session
    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { final_decision: 'ACCEPTED' },
    });
    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const completed = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(completed.status, 'COMPLETED');

    // Now append a second portion dynamically
    const addRes = await addLabPortion(testUser, session.id.toString());
    assert.equal(addRes.status, 200);

    // Verify session status reverted to IN_PROGRESS
    const reopened = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(reopened.status, 'IN_PROGRESS', 'Session must reopen to IN_PROGRESS');

    // Verify vehicle re-appears in Arrivals Queue with pending portion!
    const queueRes = await getArrivalsQueue(testUser);
    const queueItem = (queueRes.data as any[]).find((item: any) => item.zmcc_token === token);
    assert.ok(queueItem, 'Reopened vehicle must reappear in arrivals queue');
    assert.equal(queueItem.lab_session_status, 'IN_PROGRESS');

    // Now decide the new portion
    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });
    assert.equal(portions.length, 2);
    await prisma.zmccLabPortion.update({
      where: { id: portions[1].id },
      data: { final_decision: 'ACCEPTED' },
    });
    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const reCompleted = await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(reCompleted.status, 'COMPLETED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VEHICLE 10: Super Admin Policy Gating & Mathematical Scale Guards
  // ───────────────────────────────────────────────────────────────────────────
  test('Vehicle 10: Super Admin policy gating (403 when disabled) and scale descending guards (400)', async () => {
    const token = `TEST-V10-${Date.now()}`;
    const { session } = await createVehicleArrival(token, 'TEST-LEJ-0010', 2);

    await prisma.zmccLabPortion.updateMany({
      where: { lab_session_id: session.id },
      data: { final_decision: 'ACCEPTED' },
    });
    await rollUpLabSessionTx(prisma, session.id, labAttendantCtx);

    const portions = await prisma.zmccLabPortion.findMany({
      where: { lab_session_id: session.id },
      orderBy: { portion_number: 'asc' },
    });

    // 10A. Ensure manual entry is disabled -> 403 Forbidden
    await updateWeighingPolicy(superAdminCtx, { manual_entry_enabled: false, allowed_units: 'BOTH' });
    const manualFail = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'MANUAL',
      values: [
        { portion_id: portions[0].id.toString(), value: 3500, unit: 'KG' },
        { portion_id: portions[1].id.toString(), value: 3200, unit: 'KG' },
      ],
    });
    assert.equal(manualFail.status, 403, 'Must reject manual entry with 403 when policy is disabled');

    // 10B. Scale non-descending guard: W2 >= W1 -> 400 Bad Request
    const nonDescending = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [10000, 10500, 5000], // 10500 > 10000!
    });
    assert.equal(nonDescending.status, 400, 'Must reject non-descending scale weights');
    assert.ok(nonDescending.error?.includes('Each weight must be less than the one before it'));

    // 10C. Scale count mismatch guard: 2 weights provided for 2 portions instead of N+1=3
    const countMismatch = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'WEIGHT',
      weights_kg: [10000, 5000],
    });
    assert.equal(countMismatch.status, 400, 'Must reject incorrect number of scale weights');
    assert.ok(countMismatch.error?.includes('Enter 3 weights'));

    // 10D. Enable manual entry in Super Admin policy -> Success
    await updateWeighingPolicy(superAdminCtx, { manual_entry_enabled: true, allowed_units: 'BOTH' });
    const manualSuccess = await saveWeighingValues(labAttendantCtx, session.id.toString(), {
      mode: 'MANUAL',
      values: [
        { portion_id: portions[0].id.toString(), value: 3500, unit: 'KG' },
        { portion_id: portions[1].id.toString(), value: 3200, unit: 'KG' },
      ],
    });
    assert.equal(manualSuccess.status, 200, 'Manual entry must succeed when policy is enabled');
    assert.equal(manualSuccess.data?.session.portions[0].net_value, 3500);
    assert.equal(manualSuccess.data?.session.portions[1].net_value, 3200);
  });
});
