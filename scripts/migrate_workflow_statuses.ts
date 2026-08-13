import { prisma } from '../src/backend/core/db';
import { VEHICLE_STATUS, PORTION_STATUS } from '../src/constants/workflow';

async function migrateWorkflowStatuses() {
  console.log('==================================================');
  console.log('MIGRATING DATABASE RECORDS TO CANONICAL STATUSES');
  console.log('==================================================\n');

  // 1. Vehicle Visits Migration
  console.log('1. Migrating VehicleVisit statuses...');

  // Dispatched -> DISPATCHED
  const v1 = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'DISPATCHED'
    WHERE current_status IN ('Dispatched', 'dispatched');
  `);
  console.log(`- Updated Dispatched -> DISPATCHED: ${v1} rows`);

  // GATE / Token Issued -> TOKEN_ISSUED
  const v2 = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'TOKEN_ISSUED'
    WHERE current_status IN ('GATE', 'Token Issued', 'token_issued');
  `);
  console.log(`- Updated GATE / Token Issued -> TOKEN_ISSUED: ${v2} rows`);

  // LAB / Sampling / PLANT_QA -> PLANT_QA
  const v3 = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'PLANT_QA'
    WHERE current_status IN ('LAB', 'Sampling', 'plant_qa');
  `);
  console.log(`- Updated LAB / Sampling -> PLANT_QA: ${v3} rows`);

  // SCALE_1 -> Check WeightTicket
  const v4a = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit v
    SET current_status = 'GROSS_WEIGHED'
    FROM weight_ticket w
    WHERE v.id = w.visit_id AND v.current_status IN ('SCALE_1', 'First Weight') AND w.gross_weight_kg IS NOT NULL;
  `);
  const v4b = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'READY_FOR_GROSS'
    WHERE current_status IN ('SCALE_1', 'First Weight');
  `);
  console.log(`- Updated SCALE_1 / First Weight -> GROSS_WEIGHED: ${v4a} rows, READY_FOR_GROSS: ${v4b} rows`);

  // UNLOAD -> UNLOADING
  const v5 = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'UNLOADING'
    WHERE current_status IN ('UNLOAD', 'Silo Reception');
  `);
  console.log(`- Updated UNLOAD -> UNLOADING: ${v5} rows`);

  // SCALE_2_READY / Second Weight -> READY_FOR_TARE / TARE_WEIGHED
  const v6a = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'TARE_WEIGHED'
    WHERE current_status IN ('Second Weight', 'second_weight');
  `);
  const v6b = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'READY_FOR_TARE'
    WHERE current_status IN ('SCALE_2_READY', 'scale_2_ready');
  `);
  console.log(`- Updated Second Weight -> TARE_WEIGHED: ${v6a} rows, SCALE_2_READY -> READY_FOR_TARE: ${v6b} rows`);

  // Completed -> COMPLETED
  const v7 = await prisma.$executeRawUnsafe(`
    UPDATE vehicle_visit
    SET current_status = 'COMPLETED'
    WHERE current_status IN ('Completed', 'completed', 'EXIT');
  `);
  console.log(`- Updated Completed -> COMPLETED: ${v7} rows`);

  // 2. Visit Portions Migration
  console.log('\n2. Migrating VisitPortion statuses...');
  const p1 = await prisma.$executeRawUnsafe(`
    UPDATE visit_portion
    SET current_status = 'DISPATCHED'
    WHERE current_status IN ('Dispatched', 'dispatched');
  `);
  console.log(`- Updated Dispatched -> DISPATCHED: ${p1} rows`);

  const p2 = await prisma.$executeRawUnsafe(`
    UPDATE visit_portion
    SET current_status = 'ACCEPTED'
    WHERE current_status IN ('Accepted', 'accepted');
  `);
  console.log(`- Updated Accepted -> ACCEPTED: ${p2} rows`);

  const p3 = await prisma.$executeRawUnsafe(`
    UPDATE visit_portion
    SET current_status = 'REJECTED'
    WHERE current_status IN ('Rejected', 'rejected');
  `);
  console.log(`- Updated Rejected -> REJECTED: ${p3} rows`);

  console.log('\n✅ Workflow Status Database Migration Complete!');
}

migrateWorkflowStatuses()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
