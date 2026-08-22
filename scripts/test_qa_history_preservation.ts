import { prisma } from '../src/backend/core/db';
import { validateOperationalTimestamp } from '../src/backend/services/chronology-validator';

async function runQAHistoryPreservationTest() {
  console.log('==================================================');
  console.log('RUNNING QA HISTORICAL EVENT PRESERVATION VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  const now = new Date();

  // Find or create test user
  const chemistUser = await prisma.user.findFirst({
    where: { role: { in: ['QA_Operator', 'QA'] } },
  });

  if (!chemistUser) {
    console.error('No QA Chemist user found in DB.');
    process.exit(1);
  }

  // --- SCENARIO 1: Start -> Hold -> Resume -> Accept ---
  const visit1 = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-QATEST1-${Date.now()}`,
      vehicle_number: 'QA-HIST-01',
      operational_date: now,
      current_status: 'TOKEN_ISSUED',
      created_by: chemistUser.id,
      portions: {
        create: [
          { portion_number: 1, declared_quantity_value: 10000, current_status: 'DISPATCHED' },
        ],
      },
      gate_log: {
        create: { entry_timestamp: new Date(now.getTime() - 600000), entry_guard_id: chemistUser.id },
      },
    },
    include: { portions: true, gate_log: true },
  });

  // 1. QA Start
  const startTs = new Date(now.getTime() - 500000);
  const session1 = await prisma.qATestingSession.create({
    data: { visit_id: visit1.id, started_by: chemistUser.id, started_at: startTs, status: 'IN_PROGRESS' },
  });
  const startEvent1 = await prisma.qATestingSessionEvent.create({
    data: { session_id: session1.id, event_type: 'START', timestamp: startTs, user_id: chemistUser.id, note: 'Session started' },
  });

  // 2. QA Hold
  const holdTs1 = new Date(now.getTime() - 400000);
  const holdEvent1 = await prisma.qATestingSessionEvent.create({
    data: { session_id: session1.id, event_type: 'HOLD', timestamp: holdTs1, user_id: chemistUser.id, note: 'Awaiting lab re-check' },
  });
  await prisma.visitPortion.update({
    where: { id: visit1.portions[0].id },
    data: { plant_decision: 'HOLD', plant_decided_at: holdTs1, plant_decided_by: chemistUser.id },
  });

  // 3. QA Resume
  const resumeTs1 = new Date(now.getTime() - 300000);
  await prisma.qATestingSessionEvent.create({
    data: { session_id: session1.id, event_type: 'RESUME', timestamp: resumeTs1, user_id: chemistUser.id, note: 'Resumed testing' },
  });

  // 4. QA Accept (overwrites plant_decided_at on portion)
  const acceptTs1 = new Date(now.getTime() - 100000);
  await prisma.visitPortion.update({
    where: { id: visit1.portions[0].id },
    data: { plant_decision: 'ACCEPTED', plant_decided_at: acceptTs1, plant_decided_by: chemistUser.id },
  });
  const acceptEvent1 = await prisma.qATestingSessionEvent.create({
    data: { session_id: session1.id, event_type: 'PORTION_ACCEPTED', timestamp: acceptTs1, user_id: chemistUser.id, note: 'Portion #1 ACCEPTED' },
  });

  // Verify Scenario 1 Historical Preservation
  const retrievedHold1 = await prisma.qATestingSessionEvent.findFirst({
    where: { session_id: session1.id, event_type: 'HOLD' },
  });

  assert(
    !!retrievedHold1 && retrievedHold1.timestamp.getTime() === holdTs1.getTime(),
    'QA-HIST-1A: Hold Operational Timestamp Preserved After Accept',
    `Preserved timestamp = ${retrievedHold1?.timestamp.toISOString()}`
  );

  const holdDelay1Ms = (retrievedHold1?.created_at.getTime() || 0) - (retrievedHold1?.timestamp.getTime() || 0);
  assert(
    holdDelay1Ms >= 0,
    'QA-HIST-1B: Hold Data Entry Delay Derivable After Accept',
    `Hold delay = ${Math.round(holdDelay1Ms / 1000)}s`
  );

  assert(
    retrievedHold1?.user_id === chemistUser.id,
    'QA-HIST-1C: Hold Performed By User Preserved After Accept',
    `Performed by User #${retrievedHold1?.user_id}`
  );

  // --- SCENARIO 2: Start -> Hold -> Resume -> Reject ---
  const visit2 = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-QATEST2-${Date.now()}`,
      vehicle_number: 'QA-HIST-02',
      operational_date: now,
      current_status: 'TOKEN_ISSUED',
      created_by: chemistUser.id,
      portions: {
        create: [
          { portion_number: 1, declared_quantity_value: 8000, current_status: 'DISPATCHED' },
        ],
      },
      gate_log: {
        create: { entry_timestamp: new Date(now.getTime() - 600000), entry_guard_id: chemistUser.id },
      },
    },
    include: { portions: true, gate_log: true },
  });

  const session2 = await prisma.qATestingSession.create({
    data: { visit_id: visit2.id, started_by: chemistUser.id, started_at: startTs, status: 'IN_PROGRESS' },
  });

  // Hold Event
  const holdTs2 = new Date(now.getTime() - 350000);
  const holdEvent2 = await prisma.qATestingSessionEvent.create({
    data: { session_id: session2.id, event_type: 'HOLD', timestamp: holdTs2, user_id: chemistUser.id, note: 'High Acidity suspected' },
  });
  await prisma.visitPortion.update({
    where: { id: visit2.portions[0].id },
    data: { plant_decision: 'HOLD', plant_decided_at: holdTs2 },
  });

  // Resume Event
  const resumeTs2 = new Date(now.getTime() - 250000);
  await prisma.qATestingSessionEvent.create({
    data: { session_id: session2.id, event_type: 'RESUME', timestamp: resumeTs2, user_id: chemistUser.id, note: 'Lab verification completed' },
  });

  // Reject Event
  const rejectTs2 = new Date(now.getTime() - 50000);
  await prisma.visitPortion.update({
    where: { id: visit2.portions[0].id },
    data: { plant_decision: 'REJECTED', plant_decided_at: rejectTs2 },
  });
  const rejectEvent2 = await prisma.qATestingSessionEvent.create({
    data: { session_id: session2.id, event_type: 'PORTION_REJECTED', timestamp: rejectTs2, user_id: chemistUser.id, note: 'Portion #1 REJECTED: Failed COB' },
  });

  // Verify Scenario 2 Historical Preservation
  const retrievedHold2 = await prisma.qATestingSessionEvent.findFirst({
    where: { session_id: session2.id, event_type: 'HOLD' },
  });

  assert(
    !!retrievedHold2 && retrievedHold2.timestamp.getTime() === holdTs2.getTime(),
    'QA-HIST-2A: Hold Operational Timestamp Preserved After Reject',
    `Preserved timestamp = ${retrievedHold2?.timestamp.toISOString()}`
  );

  const retrievedReject = await prisma.qATestingSessionEvent.findFirst({
    where: { session_id: session2.id, event_type: 'PORTION_REJECTED' },
  });

  assert(
    !!retrievedReject && retrievedReject.event_type === 'PORTION_REJECTED',
    'QA-HIST-2B: Immutable Decision Event Disambiguation (PORTION_REJECTED vs PORTION_ACCEPTED)',
    `Event type = ${retrievedReject?.event_type}`
  );

  // Cleanup test visits
  await prisma.vehicleVisit.deleteMany({
    where: { id: { in: [visit1.id, visit2.id] } },
  });

  console.log(`\n==================================================`);
  console.log(`QA HISTORICAL PRESERVATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runQAHistoryPreservationTest().catch((err) => {
  console.error('Fatal error in QA history preservation test:', err);
  process.exit(1);
});
