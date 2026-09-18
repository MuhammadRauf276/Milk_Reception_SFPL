import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource } from '../fixtures/testFixtures';
import { PaperReferenceService, PaperValidationError } from '@/backend/services/paperReferenceService';
import { recordGateExit } from '@/backend/services/zmccArrivalService';
import { PATCH as correctResultsPatch } from '@/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/correct-results/route';
import { createSessionToken } from '@/backend/core/auth';
import { NextRequest } from 'next/server';

describe('Stage 6G-G: Operational Paper References & Authorized Corrections (Integration)', () => {
  const prisma = getTestPrisma();
  let zmccSource: any;
  let superAdminUser: any;
  let zmccManagerUser: any;
  let qaManagerUser: any;
  let pheUser: any;
  let motUser: any;

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

    // Ensure default PaperReferencePolicies exist
    await prisma.paperReferencePolicy.createMany({
      data: [
        { reference_type: 'SHOP_RMR', policy_mode: 'REQUIRED', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
        { reference_type: 'RAW_MILK_TOKEN', policy_mode: 'OPTIONAL', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
        { reference_type: 'RAW_MILK_DISPATCH_NOTE', policy_mode: 'REQUIRED', allow_duplicates: false, duplicate_scope: 'GLOBAL', updated_by_user_id: superAdminUser.id },
      ],
    });
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
});
