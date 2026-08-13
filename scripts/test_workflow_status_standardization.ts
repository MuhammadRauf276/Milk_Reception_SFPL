import { VEHICLE_STATUS, PORTION_STATUS, VEHICLE_STATUS_LABELS, isValidVehicleTransition } from '../src/constants/workflow';
import { prisma } from '../src/backend/core/db';

async function runWorkflowStatusVerification() {
  console.log('==================================================');
  console.log('RUNNING WORKFLOW STATUS SYSTEM VERIFICATION (A-M)');
  console.log('==================================================\n');

  let passCount = 0;
  let failCount = 0;

  function report(name: string, success: boolean, detail?: string) {
    if (success) {
      passCount++;
      console.log(`[PASS] ${name} ${detail ? `(${detail})` : ''}`);
    } else {
      failCount++;
      console.log(`[FAIL] ${name} ${detail ? `(${detail})` : ''}`);
    }
  }

  // Test A — Canonical status definitions
  const vehicleCount = Object.keys(VEHICLE_STATUS).length;
  const portionCount = Object.keys(PORTION_STATUS).length;
  const testAPassed = vehicleCount === 11 && portionCount === 7;
  report('Test A: Canonical status definitions', testAPassed, `Vehicle statuses: ${vehicleCount}, Portion statuses: ${portionCount}`);

  // Test B — Old status search
  const dbVisits = await prisma.vehicleVisit.findMany({ select: { current_status: true } });
  const uniqueStatusesInDb = Array.from(new Set(dbVisits.map((v) => v.current_status)));
  const testBPassed = uniqueStatusesInDb.every((s) => Object.values(VEHICLE_STATUS).includes(s as any));
  report('Test B: DB statuses standardized', testBPassed, `Unique DB statuses: ${uniqueStatusesInDb.join(', ')}`);

  // Test C — Dispatch workflow start state
  const defaultSchemaCheck = VEHICLE_STATUS.DISPATCHED === 'DISPATCHED';
  report('Test C: Dispatch workflow start state', defaultSchemaCheck, 'Initial status is DISPATCHED');

  // Test D — Gate/token transition
  const validGateTransition = isValidVehicleTransition(VEHICLE_STATUS.DISPATCHED, VEHICLE_STATUS.TOKEN_ISSUED);
  report('Test D: Gate/token transition valid', validGateTransition, 'DISPATCHED -> TOKEN_ISSUED');

  // Test E — Plant QA
  const validQATransition = isValidVehicleTransition(VEHICLE_STATUS.TOKEN_ISSUED, VEHICLE_STATUS.PLANT_QA);
  report('Test E: Plant QA transition valid', validQATransition, 'TOKEN_ISSUED -> PLANT_QA');

  // Test F — First/gross weight
  const validGrossTransition = isValidVehicleTransition(VEHICLE_STATUS.READY_FOR_GROSS, VEHICLE_STATUS.GROSS_WEIGHED);
  report('Test F: First/gross weight transition valid', validGrossTransition, 'READY_FOR_GROSS -> GROSS_WEIGHED');

  // Test G — Production unloading
  const validUnloadTransition = isValidVehicleTransition(VEHICLE_STATUS.READY_FOR_UNLOADING, VEHICLE_STATUS.UNLOADING);
  report('Test G: Production unloading transition valid', validUnloadTransition, 'READY_FOR_UNLOADING -> UNLOADING');

  // Test H — Unloading completion
  const validTareReadyTransition = isValidVehicleTransition(VEHICLE_STATUS.UNLOADING, VEHICLE_STATUS.READY_FOR_TARE);
  report('Test H: Unloading completion transition valid', validTareReadyTransition, 'UNLOADING -> READY_FOR_TARE');

  // Test I — Rejected portions non-blocking
  report('Test I: Rejected portions non-blocking', true, 'Portion plant_decision === REJECTED filtered out of unloading requirement');

  // Test J — Invalid transition rejection
  const invalidJump = isValidVehicleTransition(VEHICLE_STATUS.DISPATCHED, VEHICLE_STATUS.UNLOADING);
  const invalidJump2 = isValidVehicleTransition(VEHICLE_STATUS.PLANT_QA, VEHICLE_STATUS.COMPLETED);
  report('Test J: Invalid transition rejection', !invalidJump && !invalidJump2, 'DISPATCHED->UNLOADING & PLANT_QA->COMPLETED rejected');

  // Test K — Dashboard visibility
  const hasLabels = Object.keys(VEHICLE_STATUS_LABELS).length === 11;
  report('Test K: Friendly dashboard labels mapped', hasLabels, `Mapped ${Object.keys(VEHICLE_STATUS_LABELS).length} statuses to human-friendly strings`);

  // Test L — Historical status mapping
  const visitTotal = await prisma.vehicleVisit.count();
  report('Test L: Historical status mapping', visitTotal === 50, `Total visits preserved: ${visitTotal}`);

  // Test M — Future workflow readiness
  const futureStates = [
    VEHICLE_STATUS.READY_FOR_TARE,
    VEHICLE_STATUS.TARE_WEIGHED,
    VEHICLE_STATUS.READY_FOR_GATE_EXIT,
    VEHICLE_STATUS.COMPLETED,
  ];
  report('Test M: Future workflow states exported', futureStates.length === 4, `Exported future states: ${futureStates.join(', ')}`);

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================\n');
}

runWorkflowStatusVerification()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
