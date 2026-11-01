import 'dotenv/config';
import { prisma } from '../src/backend/core/db';

export interface TestRunContext {
  testRunId: string;
  qaVehicleNumber: string;
  qaHeadVehicleNumber: string;
  wbVehicleNumber: string;
  contractorVehicleNumber: string;
  arrivalToken: string;
  arrivalVehicleNumber: string;
  routeCode: string;
  corrCorrelationId: string;
  createdCorrectionRequestIds: bigint[];
  createdRouteIds: bigint[];
  createdShopIds: bigint[];
  createdArrivalIds: bigint[];
  createdSessionIds: bigint[];
  createdVisitIds: bigint[];
  createdJourneyIds: bigint[];
}

/**
 * Validates that the test is executing against an isolated local/test database
 * and that explicit test flags are present.
 */
export function assertSafeTestDatabaseEnvironment(): void {
  if (process.env.PHASE2_TEST_ENV !== 'true') {
    throw new Error(
      'DATABASE SAFETY REFUSAL: Synthetic workflow seeding requires PHASE2_TEST_ENV=true. ' +
      'Execution aborted to protect production/operational databases.'
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE SAFETY REFUSAL: DATABASE_URL environment variable is missing.');
  }

  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const dbPath = parsed.pathname.toLowerCase();
    const isProductionDb = dbPath.includes('prod') || dbPath.includes('production');

    if (!isLocal || isProductionDb) {
      throw new Error(
        `DATABASE SAFETY REFUSAL: Database host "${host}" / name "${dbPath}" is not an isolated local/test database. Execution aborted.`
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('DATABASE SAFETY REFUSAL')) {
      throw err;
    }
    throw new Error(`DATABASE SAFETY REFUSAL: Could not validate DATABASE_URL: ${String(err)}`);
  }
}

/**
 * Deletes ONLY the specific records created during this test run.
 * Avoids any broad or destructive wildcard deletions.
 */
export async function cleanupSyntheticWorkflows(context: TestRunContext): Promise<void> {
  assertSafeTestDatabaseEnvironment();
  console.log(`Cleaning up synthetic test records for run ${context.testRunId}...`);

  // 1. Correction Requests
  if (context.createdCorrectionRequestIds.length > 0) {
    await prisma.correctionRequest.deleteMany({
      where: { id: { in: context.createdCorrectionRequestIds } },
    });
  }

  // 2. ZMCC Local Supplier Arrivals, Sessions, and Results
  if (context.createdSessionIds.length > 0) {
    await prisma.zmccLabResult.deleteMany({
      where: { session_id: { in: context.createdSessionIds } },
    });
    await prisma.zmccLabSession.deleteMany({
      where: { id: { in: context.createdSessionIds } },
    });
  }
  if (context.createdArrivalIds.length > 0) {
    await prisma.zmccLocalSupplierArrival.deleteMany({
      where: { id: { in: context.createdArrivalIds } },
    });
  }

  // 3. Vehicle Visits and their portions/gate logs
  if (context.createdVisitIds.length > 0) {
    await prisma.gateLog.deleteMany({
      where: { visit_id: { in: context.createdVisitIds } },
    });
    await prisma.visitPortion.deleteMany({
      where: { visit_id: { in: context.createdVisitIds } },
    });
    await prisma.vehicleVisit.deleteMany({
      where: { id: { in: context.createdVisitIds } },
    });
  }

  // 4. MOT Journeys and stops
  if (context.createdJourneyIds.length > 0) {
    await prisma.motJourneyStop.deleteMany({
      where: { journey_id: { in: context.createdJourneyIds } },
    });
    await prisma.motJourney.deleteMany({
      where: { id: { in: context.createdJourneyIds } },
    });
  }

  // 5. ZMCC Routes
  if (context.createdRouteIds.length > 0) {
    await prisma.zmccRoute.deleteMany({
      where: { id: { in: context.createdRouteIds } },
    });
  }

  // 6. ZMCC Shops
  if (context.createdShopIds.length > 0) {
    await prisma.zmccShop.deleteMany({
      where: { id: { in: context.createdShopIds } },
    });
  }

  console.log(`Cleanup successfully completed for test run ${context.testRunId}.`);
}

/**
 * Seeds synthetic test records scoped strictly with a unique testRunId.
 * Returns the TestRunContext tracking all created primary keys.
 */
export async function seedSyntheticWorkflows(): Promise<TestRunContext> {
  assertSafeTestDatabaseEnvironment();

  const testRunId = `RUN_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Seeding synthetic operational test records for run ${testRunId}...`);

  const qaVehicleNumber = `TK-QA-${testRunId}`;
  const qaHeadVehicleNumber = `TK-QAH-${testRunId}`;
  const wbVehicleNumber = `TK-WB-${testRunId}`;
  const contractorVehicleNumber = `TK-CON-${testRunId}`;
  const arrivalToken = `TOK-${testRunId}`;
  const arrivalVehicleNumber = `LES-${testRunId.slice(-4).toUpperCase()}`;
  const routeCode = `RT-${testRunId}`;
  const corrCorrelationId = `CORR-${testRunId}`;

  const context: TestRunContext = {
    testRunId,
    qaVehicleNumber,
    qaHeadVehicleNumber,
    wbVehicleNumber,
    contractorVehicleNumber,
    arrivalToken,
    arrivalVehicleNumber,
    routeCode,
    corrCorrelationId,
    createdCorrectionRequestIds: [],
    createdRouteIds: [],
    createdShopIds: [],
    createdArrivalIds: [],
    createdSessionIds: [],
    createdVisitIds: [],
    createdJourneyIds: [],
  };

  // 1. Find mot.driver and linked MotProfile
  const motDriver = await prisma.user.findFirst({ where: { username: 'mot.driver' } });
  if (!motDriver) throw new Error('mot.driver user not found in database');

  const motProfile = await prisma.motProfile.findFirst({ where: { user_id: motDriver.id } });
  if (!motProfile) throw new Error('MotProfile for mot.driver not found in database');

  const motVehicle = await prisma.motVehicle.findFirst({
    where: {
      zmcc_id: motProfile.zmcc_id,
      NOT: { journeys: { some: { status: { in: ['COLLECTING', 'RETURNING'] } } } },
    },
  });
  if (!motVehicle) throw new Error('Available MotVehicle for ZMCC not found');

  const shop = await prisma.zmccShop.findFirst({ where: { zmcc_id: motProfile.zmcc_id, is_active: true } });
  if (!shop) throw new Error('Active Shop for ZMCC not found');

  const route = await prisma.zmccRoute.findFirst({ where: { zmcc_id: motProfile.zmcc_id, is_active: true } });
  if (!route) throw new Error('Active Route for ZMCC not found');

  // 2. Seed MOT Journey & Stop
  const journey = await prisma.motJourney.create({
    data: {
      journey_number: `JRN-${testRunId}`,
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
      idempotency_key: `IK-${testRunId}`,
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
  context.createdJourneyIds.push(journey.id);
  console.log(`- Created synthetic MOT Journey: ${journey.journey_number}`);

  // 3. Seed ZMCC Lab Arrival
  const localSupplier = await prisma.zmccLocalSupplier.findFirst({ where: { zmcc_id: motProfile.zmcc_id } });
  if (!localSupplier) throw new Error('Local supplier for ZMCC not found');

  const arrival = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: motProfile.zmcc_id,
      local_supplier_id: localSupplier.id,
      vehicle_number: arrivalVehicleNumber,
      arrival_timestamp: new Date(),
      arrival_date: new Date(),
      zmcc_token: arrivalToken,
      client_event_id: `CE-${testRunId}`,
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
    include: {
      lab_session: { select: { id: true } },
    },
  });
  context.createdArrivalIds.push(arrival.id);
  if (arrival.lab_session) {
    context.createdSessionIds.push(arrival.lab_session.id);
  }
  console.log(`- Created synthetic ZMCC Arrival: ${arrival.zmcc_token}`);

  // 4. Seed QA Reception Waiting Tanker
  const qaVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-QA-${testRunId}`,
      reception_number: `REC-QA-${testRunId}`,
      vehicle_number: qaVehicleNumber,
      token_number: `TOK-QA-${testRunId}`,
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
  context.createdVisitIds.push(qaVisit.id);
  console.log(`- Created synthetic QA Reception Visit: ${qaVisit.vehicle_number}`);

  // 5. Seed QA Head Escalation Portion
  const qaHeadVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-QAH-${testRunId}`,
      reception_number: `REC-QAH-${testRunId}`,
      vehicle_number: qaHeadVehicleNumber,
      token_number: `TOK-QAH-${testRunId}`,
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
  context.createdVisitIds.push(qaHeadVisit.id);
  console.log(`- Created synthetic QA Head Escalation Visit: ${qaHeadVisit.vehicle_number}`);

  // 6. Seed Weighbridge Scale Tanker
  const wbVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-WB-${testRunId}`,
      reception_number: `REC-WB-${testRunId}`,
      vehicle_number: wbVehicleNumber,
      token_number: `TOK-WB-${testRunId}`,
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
  context.createdVisitIds.push(wbVisit.id);
  console.log(`- Created synthetic Weighbridge Scale Visit: ${wbVisit.vehicle_number}`);

  // 7. Seed Contractor Manager Dispatch Visit
  const contractorVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-CON-${testRunId}`,
      reception_number: `REC-CON-${testRunId}`,
      vehicle_number: contractorVehicleNumber,
      token_number: `TOK-CON-${testRunId}`,
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
  context.createdVisitIds.push(contractorVisit.id);
  console.log(`- Created synthetic Contractor Dispatch Visit: ${contractorVisit.vehicle_number}`);

  // 8. Seed ZMCC Manager Approval Item (ZmccRoute pending approval)
  const pendingRoute = await prisma.zmccRoute.create({
    data: {
      route_code: routeCode,
      name: `Synthetic Hasilpur Model Route ${testRunId}`,
      origin: 'Hasilpur ZMCC',
      destination: 'Chak 14',
      zmcc: { connect: { id: 1 } },
      creator: { connect: { id: motDriver.id } },
      approval_status: 'PENDING',
    },
  });
  context.createdRouteIds.push(pendingRoute.id);
  console.log(`- Created synthetic ZMCC Route: ${pendingRoute.route_code}`);

  // 9. Seed Data Executive Correction Request
  const corrReq = await prisma.correctionRequest.create({
    data: {
      correlation_id: corrCorrelationId,
      module: 'MOT',
      record_id: `REC-${testRunId}`,
      source_id: 1,
      impact: 'LOW',
      status: 'REQUESTED',
      reason: 'Correction of recorded stop temperature due to sensor calibration drift',
      requested_changes: { field: 'temperature', old: 7.2, new: 4.1 },
      requested_by_user_id: motDriver.id,
    },
  });
  context.createdCorrectionRequestIds.push(corrReq.id);
  console.log(`- Created synthetic Correction Request: ${corrReq.correlation_id}`);

  console.log(`All synthetic operational test records seeded successfully for run ${testRunId}.`);
  return context;
}

if (require.main === module) {
  process.env.PHASE2_TEST_ENV = 'true';
  seedSyntheticWorkflows()
    .then((ctx) => {
      console.log('Seeded successfully with context:', ctx.testRunId);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
