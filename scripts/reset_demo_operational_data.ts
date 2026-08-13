import { prisma } from '../src/backend/core/db';

export async function resetOperationalData() {
  console.log('==================================================');
  console.log('RUNNING OPERATIONAL DATA RESET (DEVELOPMENT ONLY)');
  console.log('==================================================\n');

  // Hard Gate Safety Checks
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL SAFETY ABORT: Cannot execute operational reset in PRODUCTION environment!');
    process.exit(1);
  }

  if ((process.env.ALLOW_DEMO_RESET || '').trim() !== 'true') {
    console.error('CRITICAL SAFETY ABORT: ALLOW_DEMO_RESET=true is required to execute operational reset!');
    process.exit(1);
  }

  console.log('Safety gates passed. Deleting operational transaction records in strict FK dependency order...\n');

  // Delete operational records in exact FK order
  const deletedCounts = {
    qaSessionEvents: (await prisma.qATestingSessionEvent.deleteMany({})).count,
    qaTestingSessions: (await prisma.qATestingSession.deleteMany({})).count,
    plantLabResults: (await prisma.plantLabResult.deleteMany({})).count,
    dispatchLabResults: (await prisma.dispatchLabResult.deleteMany({})).count,
    siloTransactions: (await prisma.siloInventoryTransaction.deleteMany({})).count,
    unloadingLogs: (await prisma.unloadingLog.deleteMany({})).count,
    weightTickets: (await prisma.weightTicket.deleteMany({})).count,
    gateLogs: (await prisma.gateLog.deleteMany({})).count,
    dispatchInfos: (await prisma.dispatchInfo.deleteMany({})).count,
    visitPortions: (await prisma.visitPortion.deleteMany({})).count,
    qaWarnings: (await prisma.qAWarning.deleteMany({})).count,
    vehicleVisits: (await prisma.vehicleVisit.deleteMany({})).count,
    auditLogs: (await prisma.auditLog.deleteMany({})).count,
  };

  console.log('==================================================');
  console.log('OPERATIONAL DATA RESET SUMMARY (DELETED COUNTS):');
  console.log('==================================================');
  Object.entries(deletedCounts).forEach(([entity, count]) => {
    console.log(`  - ${entity}: ${count}`);
  });
  console.log('==================================================\n');

  // Verify Master Data Preserved
  const masterCounts = {
    users: await prisma.user.count(),
    procurementSources: await prisma.procurementSource.count(),
    silos: await prisma.silo.count(),
    labTests: await prisma.labTest.count(),
    labTestRules: await prisma.labTestRule.count(),
  };

  console.log('==================================================');
  console.log('PRESERVED MASTER DATA COUNTS:');
  console.log('==================================================');
  Object.entries(masterCounts).forEach(([entity, count]) => {
    console.log(`  - ${entity}: ${count}`);
  });
  console.log('==================================================\n');

  return deletedCounts;
}

if (require.main === module) {
  resetOperationalData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error during operational data reset:', err);
      process.exit(1);
    });
}
