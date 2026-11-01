import 'dotenv/config';
import { prisma } from '../src/backend/core/db';

export async function cleanupSyntheticWorkflows() {
  console.log('Cleaning up existing synthetic test records...');

  // 1. Correction Requests
  await prisma.correctionRequest.deleteMany({
    where: { correlation_id: { startsWith: 'SYNTH-' } },
  });

  // 2. ZMCC Routes & Shops
  await prisma.zmccShop.deleteMany({
    where: { shop_code: { startsWith: 'SYNTH-' } },
  });
  await prisma.zmccRoute.deleteMany({
    where: { route_code: { startsWith: 'SYNTH-' } },
  });

  // 3. ZMCC Local Supplier Arrivals and Sessions
  const arrivals = await prisma.zmccLocalSupplierArrival.findMany({
    where: { zmcc_token: { startsWith: 'SYNTH-' } },
    select: { id: true },
  });
  if (arrivals.length > 0) {
    const arrivalIds = arrivals.map((a) => a.id);
    const sessions = await prisma.zmccLabSession.findMany({
      where: { local_supplier_arrival_id: { in: arrivalIds } },
      select: { id: true },
    });
    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);
      await prisma.zmccLabResult.deleteMany({ where: { session_id: { in: sessionIds } } });
      await prisma.zmccLabSession.deleteMany({ where: { id: { in: sessionIds } } });
    }
    await prisma.zmccLocalSupplierArrival.deleteMany({ where: { id: { in: arrivalIds } } });
  }

  // 4. Vehicle Visits and their portions/gate logs
  const visits = await prisma.vehicleVisit.findMany({
    where: { visit_number: { startsWith: 'SYNTH-' } },
    select: { id: true },
  });

  if (visits.length > 0) {
    const visitIds = visits.map((v) => v.id);
    await prisma.gateLog.deleteMany({ where: { visit_id: { in: visitIds } } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: { in: visitIds } } });
    await prisma.vehicleVisit.deleteMany({ where: { id: { in: visitIds } } });
  }

  // 5. MOT Journeys
  const journeys = await prisma.motJourney.findMany({
    where: { journey_number: { startsWith: 'SYNTH-' } },
    select: { id: true },
  });

  if (journeys.length > 0) {
    const journeyIds = journeys.map((j) => j.id);
    await prisma.motJourneyStop.deleteMany({ where: { journey_id: { in: journeyIds } } });
    await prisma.motJourney.deleteMany({ where: { id: { in: journeyIds } } });
  }

  console.log('Cleanup completed successfully.');
}

export async function seedSyntheticWorkflows() {
  await cleanupSyntheticWorkflows();
  console.log('Seeding synthetic operational test records...');

  // 1. Find mot.driver and linked MotProfile
  const motDriver = await prisma.user.findFirst({ where: { username: 'mot.driver' } });
  if (!motDriver) throw new Error('mot.driver user not found');

  const motProfile = await prisma.motProfile.findFirst({ where: { user_id: motDriver.id } });
  if (!motProfile) throw new Error('MotProfile for mot.driver not found');

  const motVehicle = await prisma.motVehicle.findFirst({
    where: {
      zmcc_id: motProfile.zmcc_id,
      NOT: { journeys: { some: { status: { in: ['COLLECTING', 'RETURNING'] } } } },
    },
  });
  if (!motVehicle) throw new Error('Available MotVehicle for ZMCC not found');

  const shop = await prisma.zmccShop.findFirst({ where: { zmcc_id: motProfile.zmcc_id, is_active: true } });
  if (!shop) throw new Error('Shop for ZMCC not found');

  const route = await prisma.zmccRoute.findFirst({ where: { zmcc_id: motProfile.zmcc_id, is_active: true } });
  if (!route) throw new Error('Route for ZMCC not found');

  // 2. Seed MOT Journey & Stop
  const journey = await prisma.motJourney.create({
    data: {
      journey_number: 'SYNTH-MOT-JRN-01',
      operational_date: new Date(),
      status: 'COLLECTING',
      zmcc_id: motProfile.zmcc_id,
      route_id: route.id,
      mot_profile_id: motProfile.id,
      mot_vehicle_id: motVehicle.id,
      assigned_by: motDriver.id,
      assigned_at: new Date(),
      assignment_latitude: 29.6974,
      assignment_longitude: 72.5539,
      started_at: new Date(),
      start_latitude: 29.6974,
      start_longitude: 72.5539,
      idempotency_key: 'SYNTH-MOT-IK-01',
      stops: {
        create: [
          {
            planned_sequence: 1,
            status: 'PENDING',
            shop_id: shop.id,
            shop_code_snapshot: shop.shop_code,
            shop_name_snapshot: shop.shop_name,
            owner_name_snapshot: shop.owner_name,
            phone_number_snapshot: shop.phone_number,
            area_code_snapshot: 'AR-HAS-01',
            area_name_snapshot: 'Hasilpur East Rural Area',
          },
        ],
      },
    },
  });
  console.log(`- Created synthetic MOT Journey: ${journey.journey_number}`);

  // 3. Seed ZMCC Lab Arrival
  const localSupplier = await prisma.zmccLocalSupplier.findFirst({ where: { zmcc_id: motProfile.zmcc_id } });
  if (!localSupplier) throw new Error('Local supplier for ZMCC not found');

  const arrival = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: motProfile.zmcc_id,
      local_supplier_id: localSupplier.id,
      vehicle_number: 'LES-1001',
      arrival_timestamp: new Date(),
      arrival_date: new Date(),
      zmcc_token: 'SYNTH-ZMCC-TOK-01',
      client_event_id: 'SYNTH-ZMCC-CE-01',
      recorded_by_user_id: motDriver.id,
      lab_session: {
        create: {
          zmcc_id: motProfile.zmcc_id,
          arrival_type: 'HC',
          status: 'IN_PROGRESS',
          started_by_user_id: motDriver.id,
          started_at: new Date(),
        },
      },
    },
  });
  console.log(`- Created synthetic ZMCC Arrival: ${arrival.zmcc_token}`);

  // 4. Seed QA Reception Waiting Tanker
  const qaVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'SYNTH-QA-VISIT-01',
      reception_number: 'SYNTH-REC-01',
      vehicle_number: 'TK-SYNTH-QA-01',
      token_number: 'SYNTH-QA-TOK-01',
      current_status: 'TOKEN_ISSUED',
      procurement_source_id: 1,
      operational_date: new Date(),
      vehicle_dispatch_quantity_value: 15000,
      vehicle_dispatch_quantity_unit: 'LITER',
      gate_log: {
        create: {
          entry_timestamp: new Date(),
          entry_guard_id: 9,
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            current_status: 'TOKEN_ISSUED',
            dispatch_quantity_value: 15000,
            dispatch_quantity_unit: 'LITER',
          },
        ],
      },
    },
  });
  console.log(`- Created synthetic QA Reception Visit: ${qaVisit.vehicle_number}`);

  // 5. Seed QA Head Escalation Portion
  const qaHeadVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'SYNTH-QAH-VISIT-01',
      reception_number: 'SYNTH-REC-02',
      vehicle_number: 'TK-SYNTH-QAH-01',
      token_number: 'SYNTH-QAH-TOK-01',
      current_status: 'TOKEN_ISSUED',
      procurement_source_id: 1,
      operational_date: new Date(),
      gate_log: {
        create: {
          entry_timestamp: new Date(),
          entry_guard_id: 9,
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            current_status: 'TOKEN_ISSUED',
            manager_review_status: 'PENDING',
            manager_review_reason: 'Borderline MBRT test escalation for AVP-QA disposition',
          },
        ],
      },
    },
  });
  console.log(`- Created synthetic QA Head Escalation Visit: ${qaHeadVisit.vehicle_number}`);

  // 6. Seed Weighbridge Scale Tanker
  const wbVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'SYNTH-WB-VISIT-01',
      reception_number: 'SYNTH-REC-03',
      vehicle_number: 'TK-SYNTH-WB-01',
      token_number: 'SYNTH-WB-TOK-01',
      current_status: 'READY_FOR_GROSS',
      procurement_source_id: 1,
      operational_date: new Date(),
      gate_log: {
        create: {
          entry_timestamp: new Date(),
          entry_guard_id: 9,
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            current_status: 'READY_FOR_GROSS',
            plant_decision: 'ACCEPTED',
          },
        ],
      },
    },
  });
  console.log(`- Created synthetic Weighbridge Scale Visit: ${wbVisit.vehicle_number}`);

  // 7. Seed Contractor Manager Dispatch Visit
  const contractorVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'SYNTH-CON-VISIT-01',
      reception_number: 'SYNTH-REC-04',
      vehicle_number: 'TK-SYNTH-CON-01',
      token_number: 'SYNTH-CON-TOK-01',
      current_status: 'PENDING_APPROVAL',
      approval_status: 'PENDING',
      procurement_source_id: 4, // CONT-ALKHAIR
      vehicle_dispatch_gross_liters: 14500,
      vehicle_dispatch_fat: 4.1,
      vehicle_dispatch_lr: 28.6,
      approval_request_remarks: 'Contractor Dispatch pending manager reconciliation',
      approval_requested_at: new Date(),
      portions: {
        create: [
          {
            portion_number: 1,
            current_status: 'PENDING_APPROVAL',
            dispatch_quantity_value: 14500,
            dispatch_quantity_unit: 'LITER',
          },
        ],
      },
    },
  });
  console.log(`- Created synthetic Contractor Dispatch Visit: ${contractorVisit.vehicle_number}`);

  // 8. Seed ZMCC Manager Approval Item (ZmccRoute pending approval)
  const pendingRoute = await prisma.zmccRoute.create({
    data: {
      route_code: 'SYNTH-RT-01',
      name: 'Synthetic Hasilpur Model Route',
      origin: 'Hasilpur ZMCC',
      destination: 'Chak 14',
      zmcc: { connect: { id: 1 } },
      creator: { connect: { id: motDriver.id } },
      approval_status: 'PENDING',
    },
  });
  console.log(`- Created synthetic ZMCC Route: ${pendingRoute.route_code}`);

  // 9. Seed Data Executive Correction Request
  const corrReq = await prisma.correctionRequest.create({
    data: {
      correlation_id: 'SYNTH-CORR-REQ-01',
      module: 'MOT',
      record_id: 'SYNTH-MOT-01',
      source_id: 1,
      impact: 'LOW',
      status: 'REQUESTED',
      reason: 'Correction of recorded stop temperature due to sensor calibration drift',
      requested_changes: { field: 'temperature', old: 7.2, new: 4.1 },
      requested_by_user_id: motDriver.id,
    },
  });
  console.log(`- Created synthetic Correction Request: ${corrReq.correlation_id}`);

  console.log('All synthetic operational test records seeded successfully.');
}

if (require.main === module) {
  const action = process.argv[2] || 'seed';
  if (action === 'cleanup') {
    cleanupSyntheticWorkflows()
      .catch(console.error)
      .finally(() => prisma.$disconnect());
  } else {
    seedSyntheticWorkflows()
      .catch(console.error)
      .finally(() => prisma.$disconnect());
  }
}
