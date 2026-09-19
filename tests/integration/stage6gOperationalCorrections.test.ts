import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource } from '../fixtures/testFixtures';
import { PaperReferenceService, PaperValidationError } from '@/backend/services/paperReferenceService';
import { recordGateExit } from '@/backend/services/zmccArrivalService';
import { PATCH as correctResultsPatch } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/correct-results/route';
import { POST as correctDecisionPost } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/correct-decision/route';
import { startOrResumeSession, correctCompletedSession } from '@/backend/services/zmccLabService';
import { createSessionToken } from '@/backend/core/auth';
import { NextRequest } from 'next/server';

describe('Stage 6G-G: Operational Paper References & Authorized Corrections (Integration)', () => {
  const prisma = getTestPrisma();
  let zmccSource: any;
  let superAdminUser: any;
  let zmccManagerUser: any;
  let zmccLabAttendantUser: any;
  let qaManagerUser: any;
  let pheUser: any;
  let motUser: any;
  let zmccTank: any;

  beforeAll(async () => {
    await clearTestDatabase(prisma);
  });

  afterAll(async () => {
    await clearTestDatabase(prisma);
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await clearTestDatabase(prisma);
    await seedStandardTestLabCatalog(prisma);

    zmccSource = await createTestZmccSource(prisma, 'ZMCC_6G_01');

    superAdminUser = await prisma.user.create({
      data: {
        username: `super_admin_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'SUPER_ADMIN',
        full_name: 'Super Admin 6G',
        is_active: true,
      },
    });

    zmccManagerUser = await prisma.user.create({
      data: {
        username: `zmcc_mgr_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'ZMCC_MANAGER',
        full_name: 'ZMCC Manager 6G',
        is_active: true,
        procurement_source_id: zmccSource.id,
      },
    });

    qaManagerUser = await prisma.user.create({
      data: {
        username: `qa_mgr_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'QA_MANAGER',
        full_name: 'Plant QA Manager 6G',
        is_active: true,
      },
    });

    pheUser = await prisma.user.create({
      data: {
        username: `phe_op_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'PHE_OPERATOR',
        full_name: 'PHE Operator 6G',
        is_active: true,
        procurement_source_id: zmccSource.id,
      },
    });

    motUser = await prisma.user.create({
      data: {
        username: `mot_user_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'MOT',
        full_name: 'MOT Officer 6G',
        is_active: true,
        procurement_source_id: zmccSource.id,
      },
    });

    zmccLabAttendantUser = await prisma.user.create({
      data: {
        username: `zmcc_att_${Date.now()}`,
        password_hash: 'test_hash',
        role: 'ZMCC_LAB_ATTENDANT',
        full_name: 'ZMCC Lab Attendant 6G',
        is_active: true,
        procurement_source_id: zmccSource.id,
      },
    });

    zmccTank = await prisma.zmccTank.create({
      data: {
        zmcc_id: zmccSource.id,
        tank_code: `TANK-6G-${Date.now()}`,
        tank_name: 'Intake Tank 1',
        capacity_liters: 50000,
        is_active: true,
        created_by_user_id: superAdminUser.id,
      },
    });

    // Ensure default PaperReferencePolicies exist
    await prisma.paperReferencePolicy.createMany({
      data: [
        { reference_type: 'SHOP_RMR', policy_mode: 'REQUIRED', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
        { reference_type: 'RAW_MILK_TOKEN', policy_mode: 'OPTIONAL', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
        { reference_type: 'RAW_MILK_DISPATCH_NOTE', policy_mode: 'REQUIRED', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
      ],
    });

    const lrTest = await prisma.labTest.findUnique({ where: { testCode: 'LT-000008' } });
    const fatTest = await prisma.labTest.findUnique({ where: { testCode: 'LT-000001' } });
    if (lrTest && fatTest) {
      await prisma.milkTestPolicyAssignment.createMany({
        data: [
          {
            lab_test_id: lrTest.id,
            testing_point: 'ZMCC_LAB_MOT',
            is_required: true,
            display_order: 1,
            is_active: true,
            created_by_user_id: superAdminUser.id,
          },
          {
            lab_test_id: fatTest.id,
            testing_point: 'ZMCC_LAB_MOT',
            is_required: true,
            display_order: 2,
            is_active: true,
            created_by_user_id: superAdminUser.id,
          },
        ],
      });
    }
  });

  describe('1. Paper Reference Policy & Duplicate Prevention', () => {
    it('validates digits-only string, preserves leading zeros, and prevents duplicate within series', async () => {
      // 1. Validate & verify first dispatch note
      const note1 = await PaperReferenceService.validateAndVerify(
        'RAW_MILK_DISPATCH_NOTE',
        '004821',
        { tx: prisma }
      );
      expect(note1).toBe('004821');

      // Create a VehicleVisit with note 004821
      const visit1 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-6G-${Date.now()}-1`,
          vehicle_number: 'LEA-0048',
          procurement_source_id: zmccSource.id,
          raw_milk_dispatch_note_number: note1,
          current_status: 'DISPATCHED',
          created_by: zmccManagerUser.id,
        },
      });
      expect(visit1.raw_milk_dispatch_note_number).toBe('004821');

      // 2. Attempting second dispatch note with identical number throws duplicate PaperValidationError
      await expect(
        PaperReferenceService.validateAndVerify(
          'RAW_MILK_DISPATCH_NOTE',
          '004821',
          { tx: prisma }
        )
      ).rejects.toThrow(PaperValidationError);

      // 3. Verifying the same note while excluding visit1.id passes (self-update)
      const selfUpdate = await PaperReferenceService.validateAndVerify(
        'RAW_MILK_DISPATCH_NOTE',
        '004821',
        { excludeEntityId: visit1.id, tx: prisma }
      );
      expect(selfUpdate).toBe('004821');

      // 4. A different valid number with leading zero succeeds
      const note2 = await PaperReferenceService.validateAndVerify(
        'RAW_MILK_DISPATCH_NOTE',
        '004822',
        { tx: prisma }
      );
      expect(note2).toBe('004822');
    });

    it('rejects paper reference containing non-digits with PaperValidationError', async () => {
      await expect(
        PaperReferenceService.validateAndVerify(
          'RAW_MILK_DISPATCH_NOTE',
          'DISP-004821',
          { tx: prisma }
        )
      ).rejects.toThrow(/must contain digits only/);
    });
  });

  describe('2. Physical Exit Guard & Gate Exit Validation', () => {
    it('blocks gate exit with 409 MANAGER_REVIEW_PENDING when manager review is pending', async () => {
      // Create MOT Journey & Arrival
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: 'R-6G-01', name: 'Route 6G 01', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: 'MOT-6G-01', name: 'MOT 6G', phone_number: '03001234567', cnic: '31202-0000000-1', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-01', created_by: zmccManagerUser.id },
      });

      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-6G-${Date.now()}`,
          idempotency_key: `idem-j-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });

      const arrivalTime = new Date(Date.now() - 3600000);
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005511',
          zmcc_token: `TK-6G-${Date.now()}`,
          arrival_timestamp: arrivalTime,
          arrival_date: arrivalTime,
          client_event_id: `evt-arr-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
          exit_timestamp: null,
        },
      });

      // Lab session with manager review pending
      await prisma.zmccLabSession.create({
        data: {
          zmcc_id: zmccSource.id,
          arrival_type: 'MOT',
          mot_arrival_id: arrival.id,
          status: 'COMPLETED',
          decision: null,
          system_quality_outcome: 'OUT_OF_SPEC',
          manager_review_status: 'PENDING',
          manager_requested_decision: 'ACCEPTED',
          started_by_user_id: pheUser.id,
          completed_at: new Date(Date.now() - 1800000),
        },
      });

      // Attempting gate exit should fail closed
      const exitRes1 = await recordGateExit(pheUser, 'MOT', arrival.id, {
        client_event_id: `evt-exit-${Date.now()}`,
        exit_timestamp: new Date().toISOString(),
      });
      expect(exitRes1.status).toBe(409);
      expect(exitRes1.error).toBe('MANAGER_REVIEW_PENDING');
    });

    it('blocks gate exit when arrival already exited', async () => {
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: 'R-6G-02', name: 'Route 6G 02', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: 'MOT-6G-02', name: 'MOT 6G 02', phone_number: '03001234568', cnic: '31202-0000000-2', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-02', created_by: zmccManagerUser.id },
      });

      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-6G-EX-${Date.now()}`,
          idempotency_key: `idem-j-ex-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });

      const exitTime = new Date();
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005522',
          zmcc_token: `TK-6G-EX-${Date.now()}`,
          arrival_timestamp: new Date(exitTime.getTime() - 3600000),
          arrival_date: new Date(),
          client_event_id: `evt-arr-ex-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
          exit_timestamp: exitTime, // ALREADY EXITED
        },
      });

      // Attempting second exit fails with ALREADY_EXITED
      const exitRes2 = await recordGateExit(pheUser, 'MOT', arrival.id, {
        client_event_id: `evt-exit-2-${Date.now()}`,
        exit_timestamp: new Date().toISOString(),
      });
      expect(exitRes2.status).toBe(409);
      expect(exitRes2.error).toContain('already been recorded');
    });
  });

  describe('3. Post-Final-Receipt Guard on QA Corrections', () => {
    it('blocks QA result corrections with HTTP 400 when PlantFinalDualReconciliation exists', async () => {
      // 1. Create a completed VehicleVisit with portion and reconciliation record
      const visit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-REC-${Date.now()}`,
          vehicle_number: 'LEA-REC-01',
          procurement_source_id: zmccSource.id,
          current_status: 'COMPLETED',
          created_by: superAdminUser.id,
        },
      });

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: 1,
          dispatch_quantity_value: 5000,
          dispatch_quantity_unit: 'KG',
          dispatch_quantity_basis: 'MEASURED',
          current_status: 'COMPLETED',
          plant_decision: 'ACCEPTED',
        },
      });

      const silo = await prisma.silo.create({
        data: {
          silo_code: `SILO-TEST-${Date.now()}`,
          silo_name: 'Test Silo',
          capacity_liters: 200000,
          is_active: true,
        },
      });

      const siloTx = await prisma.siloInventoryTransaction.create({
        data: {
          silo_id: silo.id,
          visit_id: visit.id,
          portion_id: portion.id,
          transaction_type: 'RECEIPT',
          quantity_liters: 4860,
          operational_timestamp: new Date(),
          performed_by: superAdminUser.id,
        },
      });

      // Create PlantFinalDualReconciliation
      await prisma.plantFinalDualReconciliation.create({
        data: {
          visit_id: visit.id,
          final_receipt_transaction_id: siloTx.id,
          received_gross_liters: 4860,
          received_at_13ts_liters: 4600,
          reconciled_at: new Date(),
        },
      });

      // 2. Call correct-results route as QA_MANAGER
      const token = await createSessionToken({
        id: qaManagerUser.id.toString(),
        username: qaManagerUser.username,
        name: qaManagerUser.full_name || 'QA Manager',
        role: qaManagerUser.role,
        department: 'QA',
      });

      const req = new NextRequest(
        `http://localhost/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/correct-results`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `auth_token=${token}`,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            reason: 'Testing post-final-receipt guard',
            results: [
              { test_id: '1', numeric_value: 4.10, performance_status: 'PERFORMED' },
            ],
          }),
        }
      );

      const res = await correctResultsPatch(req, {
        params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('POST_FINAL_RECEIPT_CORRECTION_BLOCKED');
      expect(json.message).toContain('reconciliation has been executed');
    });
  });

  describe('4. Plant QA Manager Exception Review (On-Site vs After-Exit)', () => {
    it('approves on-site exception and transitions visit to READY_FOR_GROSS', async () => {
      const visit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-PLANT-ONSITE-${Date.now()}`,
          vehicle_number: 'LES-ONSITE-01',
          procurement_source_id: zmccSource.id,
          current_status: 'PLANT_QA',
          created_by: superAdminUser.id,
        },
      });

      await prisma.gateLog.create({
        data: {
          visit_id: visit.id,
          entry_timestamp: new Date(),
          exit_timestamp: null, // On-site
          entry_guard_id: superAdminUser.id,
        },
      });

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: 1,
          dispatch_quantity_value: 4000,
          dispatch_quantity_unit: 'LITER',
          dispatch_quantity_basis: 'MEASURED',
          current_status: 'PLANT_QA',
          plant_decision: 'REJECTED',
          manager_review_status: 'PENDING',
          system_quality_outcome: 'OUT_OF_SPEC',
        },
      });

      const token = await createSessionToken({
        id: qaManagerUser.id.toString(),
        username: qaManagerUser.username,
        name: qaManagerUser.full_name || 'QA Manager',
        role: qaManagerUser.role,
        department: 'QA',
      });

      const req = new NextRequest(
        `http://localhost/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/correct-decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `auth_token=${token}`,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            decision: 'APPROVE',
            reason: 'Plant QA manager approves exception for on-site vehicle',
          }),
        }
      );

      const res = await correctDecisionPost(req, {
        params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.reviewOnly).toBe(false);
      expect(data.newVisitStatus).toBe('READY_FOR_GROSS');

      // Verify DB updates
      const updatedPortion = await prisma.visitPortion.findUnique({ where: { id: portion.id } });
      expect(updatedPortion?.plant_decision).toBe('ACCEPTED');
      expect(updatedPortion?.manager_review_status).toBe('APPROVED');
      expect(updatedPortion?.corrected_plant_decision).toBe('ACCEPTED');

      const updatedVisit = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
      expect(updatedVisit?.current_status).toBe('READY_FOR_GROSS');
    });

    it('records audit-only review when vehicle has physically exited without altering plant_decision or creating silo stock', async () => {
      const exitTime = new Date();
      const visit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-PLANT-EXIT-${Date.now()}`,
          vehicle_number: 'LES-EXIT-01',
          procurement_source_id: zmccSource.id,
          current_status: 'READY_FOR_GATE_EXIT',
          created_by: superAdminUser.id,
        },
      });

      await prisma.gateLog.create({
        data: {
          visit_id: visit.id,
          entry_timestamp: new Date(exitTime.getTime() - 7200000),
          exit_timestamp: exitTime, // Exited
          entry_guard_id: superAdminUser.id,
          exit_guard_id: superAdminUser.id,
        },
      });

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: 1,
          dispatch_quantity_value: 4000,
          dispatch_quantity_unit: 'LITER',
          dispatch_quantity_basis: 'MEASURED',
          current_status: 'REJECTED',
          plant_decision: 'REJECTED',
          manager_review_status: 'PENDING',
          system_quality_outcome: 'OUT_OF_SPEC',
        },
      });

      const token = await createSessionToken({
        id: qaManagerUser.id.toString(),
        username: qaManagerUser.username,
        name: qaManagerUser.full_name || 'QA Manager',
        role: qaManagerUser.role,
        department: 'QA',
      });

      const req = new NextRequest(
        `http://localhost/api/qa/vehicle-visits/${visit.id}/portions/${portion.id}/correct-decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `auth_token=${token}`,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            decision: 'APPROVE',
            reason: 'Post-exit manager review for audit trail',
          }),
        }
      );

      const res = await correctDecisionPost(req, {
        params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.reviewOnly).toBe(true);

      // Verify DB: decision remains REJECTED, status is REVIEWED_EXITED
      const updatedPortion = await prisma.visitPortion.findUnique({ where: { id: portion.id } });
      expect(updatedPortion?.plant_decision).toBe('REJECTED');
      expect(updatedPortion?.manager_review_status).toBe('REVIEWED_EXITED');

      // Verify no fake silo receipts created
      const siloCount = await prisma.siloInventoryTransaction.count({ where: { portion_id: portion.id } });
      expect(siloCount).toBe(0);

      // Verify audit log recorded
      const audit = await prisma.auditLog.findFirst({
        where: { record_id: portion.id, action: 'PLANT_QA_MANAGER_REVIEW_AFTER_EXIT' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('5. ZMCC Lab Testing Role Boundaries', () => {
    it('blocks Super Admin from performing normal lab testing sessions (Attendant only)', async () => {
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: `R-ATT-${Date.now()}`, name: 'Route Att', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: `MOT-ATT-${Date.now()}`, name: 'MOT Att', phone_number: '03001234569', cnic: '31202-0000000-3', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-ATT', created_by: zmccManagerUser.id },
      });
      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-ATT-${Date.now()}`,
          idempotency_key: `idem-j-att-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005533',
          zmcc_token: `TK-ATT-${Date.now()}`,
          arrival_timestamp: new Date(),
          arrival_date: new Date(),
          client_event_id: `evt-att-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
        },
      });

      // Super Admin attempting START_OR_RESUME_SESSION must fail closed with 403
      const resAdmin = await startOrResumeSession(superAdminUser, {
        arrival_type: 'MOT',
        arrival_id: arrival.id.toString(),
      });
      expect(resAdmin.status).toBe(403);
      expect(resAdmin.error).toContain('Only ZMCC Lab Attendants may perform testing sessions');

      // ZMCC Lab Attendant succeeds
      const resAtt = await startOrResumeSession(zmccLabAttendantUser, {
        arrival_type: 'MOT',
        arrival_id: arrival.id.toString(),
      });
      expect([200, 201]).toContain(resAtt.status);
      expect(resAtt.data?.id).toBeDefined();
    });
  });

  describe('6. ZMCC Manager Exception Review & Corrections (On-Site vs After-Exit)', () => {
    it('blocks Super Admin from correcting/reviewing completed lab sessions (Manager only)', async () => {
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: `R-SA-${Date.now()}`, name: 'Route SA', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: `MOT-SA-${Date.now()}`, name: 'MOT SA', phone_number: '03001234568', cnic: '31202-0000000-2', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-SA', created_by: zmccManagerUser.id },
      });
      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-SA-${Date.now()}`,
          idempotency_key: `idem-j-sa-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005522',
          zmcc_token: `TK-SA-${Date.now()}`,
          arrival_timestamp: new Date(),
          arrival_date: new Date(),
          client_event_id: `evt-sa-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
        },
      });

      const session = await prisma.zmccLabSession.create({
        data: {
          zmcc_id: zmccSource.id,
          arrival_type: 'MOT',
          mot_arrival_id: arrival.id,
          status: 'COMPLETED',
          decision: 'REJECTED',
          rejection_reason: 'Quality parameter breach',
          manager_review_status: 'PENDING',
          started_by_user_id: zmccLabAttendantUser.id,
          completed_at: new Date(),
          quantity_value: 3000,
          quantity_unit: 'LITER',
        },
      });

      const res = await correctCompletedSession(superAdminUser, session.id, {
        decision: 'ACCEPTED',
        reason: 'Super Admin trying to approve manager review',
      });
      expect(res.status).toBe(403);
      expect(res.error).toContain('Only ZMCC Managers may correct finalized lab records');
    });

    it('approves on-site exception and creates exactly 1 tank receipt and inventory transaction', async () => {
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: `R-ONSITE-${Date.now()}`, name: 'Route Onsite', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: `MOT-ONSITE-${Date.now()}`, name: 'MOT Onsite', phone_number: '03001234570', cnic: '31202-0000000-4', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-ON', created_by: zmccManagerUser.id },
      });
      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-ON-${Date.now()}`,
          idempotency_key: `idem-j-on-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005544',
          zmcc_token: `TK-ON-${Date.now()}`,
          arrival_timestamp: new Date(),
          arrival_date: new Date(),
          client_event_id: `evt-on-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
          exit_timestamp: null, // ON-SITE
        },
      });

      const session = await prisma.zmccLabSession.create({
        data: {
          zmcc_id: zmccSource.id,
          arrival_type: 'MOT',
          mot_arrival_id: arrival.id,
          status: 'COMPLETED',
          decision: 'REJECTED',
          rejection_reason: 'Acidity above threshold',
          manager_review_status: 'PENDING',
          system_quality_outcome: 'OUT_OF_SPEC',
          started_by_user_id: zmccLabAttendantUser.id,
          completed_at: new Date(),
          quantity_value: 2500,
          quantity_unit: 'LITER',
        },
      });

      const res = await correctCompletedSession(zmccManagerUser, session.id, {
        decision: 'ACCEPTED',
        reason: 'Manager approved exception for on-site MOT arrival',
      });

      expect(res.status).toBe(200);
      expect(res.data.decision).toBe('ACCEPTED');
      expect(res.data.manager_review_status).toBe('APPROVED');

      // Verify exactly 1 tank receipt
      const receipts = await prisma.zmccTankReceipt.findMany({ where: { lab_session_id: session.id } });
      expect(receipts.length).toBe(1);

      // Verify exactly 1 tank inventory transaction of type RECEIPT
      const invTxs = await prisma.zmccTankInventoryTransaction.findMany({ where: { tank_receipt_id: receipts[0].id } });
      expect(invTxs.length).toBe(1);
      expect(invTxs[0].transaction_type).toBe('RECEIPT');
    });

    it('records audit-only review when arrival has already exited without altering decision to ACCEPTED and without creating tank receipt or stock', async () => {
      const exitTime = new Date();
      const route = await prisma.zmccRoute.create({
        data: { zmcc_id: zmccSource.id, route_code: `R-EX-${Date.now()}`, name: 'Route Ex', origin: 'A', destination: 'B', created_by: zmccManagerUser.id },
      });
      const motProfile = await prisma.motProfile.create({
        data: { zmcc_id: zmccSource.id, mot_code: `MOT-EX-${Date.now()}`, name: 'MOT Ex', phone_number: '03001234571', cnic: '31202-0000000-5', created_by: zmccManagerUser.id },
      });
      const motVeh = await prisma.motVehicle.create({
        data: { zmcc_id: zmccSource.id, vehicle_number: 'MOT-VEH-EX', created_by: zmccManagerUser.id },
      });
      const journey = await prisma.motJourney.create({
        data: {
          journey_number: `J-EX-${Date.now()}`,
          idempotency_key: `idem-j-ex2-${Date.now()}`,
          zmcc_id: zmccSource.id,
          route_id: route.id,
          mot_profile_id: motProfile.id,
          mot_vehicle_id: motVeh.id,
          status: 'COMPLETED',
          operational_date: new Date(),
          assigned_by: zmccManagerUser.id,
          assigned_at: new Date(),
          started_at: new Date(),
          assignment_latitude: 29.0,
          assignment_longitude: 72.0,
          start_latitude: 29.0,
          start_longitude: 72.0,
        },
      });
      const arrival = await prisma.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: zmccSource.id,
          raw_milk_token_number: '005555',
          zmcc_token: `TK-EX2-${Date.now()}`,
          arrival_timestamp: new Date(exitTime.getTime() - 3600000),
          arrival_date: new Date(),
          client_event_id: `evt-ex2-${Date.now()}`,
          recorded_by_user_id: pheUser.id,
          gate_exit_required: true,
          exit_timestamp: exitTime, // EXITED
        },
      });

      const session = await prisma.zmccLabSession.create({
        data: {
          zmcc_id: zmccSource.id,
          arrival_type: 'MOT',
          mot_arrival_id: arrival.id,
          status: 'COMPLETED',
          decision: 'REJECTED',
          rejection_reason: 'Temperature too high',
          manager_review_status: 'PENDING',
          system_quality_outcome: 'OUT_OF_SPEC',
          started_by_user_id: zmccLabAttendantUser.id,
          completed_at: new Date(exitTime.getTime() - 1800000),
          quantity_value: 2800,
          quantity_unit: 'LITER',
        },
      });

      const res = await correctCompletedSession(zmccManagerUser, session.id, {
        decision: 'ACCEPTED',
        reason: 'Manager review conducted after vehicle departure',
      });

      expect(res.status).toBe(200);
      // Preserves REJECTED physical reality
      expect(res.data.decision).toBe('REJECTED');
      expect(res.data.manager_review_status).toBe('REVIEWED_EXITED');

      // Verify NO tank receipt was created
      const receipts = await prisma.zmccTankReceipt.findMany({ where: { lab_session_id: session.id } });
      expect(receipts.length).toBe(0);

      // Verify NO tank inventory transaction created
      const txCount = await prisma.zmccTankInventoryTransaction.count({
        where: { reference_type: 'ZMCC_LAB_SESSION', reference_id: session.id.toString() },
      });
      expect(txCount).toBe(0);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { record_id: session.id, action: 'ZMCC_MANAGER_REVIEW_AFTER_EXIT' },
      });
      expect(audit).not.toBeNull();
    });
  });
});
