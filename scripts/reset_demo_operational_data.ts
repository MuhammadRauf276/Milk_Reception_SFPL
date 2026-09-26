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
    correctionRequests: (await prisma.correctionRequest.deleteMany({})).count,
    // ZMCC Operational & Inventory Deletions (Reverse FK order)
    localSupplierRmrLegacyClassifications: (await prisma.localSupplierRmrLegacyClassification.deleteMany({})).count,
    localSupplierRmrIssuances: (await prisma.localSupplierRmrIssuance.deleteMany({})).count,
    zmccTankTransactions: (await prisma.zmccTankInventoryTransaction.deleteMany({})).count,
    zmccTankReceipts: (await prisma.zmccTankReceipt.deleteMany({})).count,
    zmccLabResults: (await prisma.zmccLabResult.deleteMany({})).count,
    zmccLabSessions: (await prisma.zmccLabSession.deleteMany({})).count,
    zmccLocalSupplierArrivals: (await prisma.zmccLocalSupplierArrival.deleteMany({})).count,
    zmccContractorArrivals: (await prisma.zmccContractorArrival.deleteMany({})).count,
    zmccMotArrivals: (await prisma.zmccMotArrival.deleteMany({})).count,
    motJourneySummaries: (await prisma.motJourneySummary.deleteMany({})).count,
    motCollectionSmsOutbox: (await prisma.motCollectionSmsOutbox.deleteMany({})).count,
    motShopCollections: (await prisma.motShopCollection.deleteMany({})).count,
    motJourneyLocations: (await prisma.motJourneyLocation.deleteMany({})).count,
    motJourneyStops: (await prisma.motJourneyStop.deleteMany({})).count,
    motJourneys: (await prisma.motJourney.deleteMany({})).count,

    // Plant Operational Deletions
    labTestAssignments: (await prisma.labTestAssignment.deleteMany({})).count,
    qaSessionEvents: (await prisma.qATestingSessionEvent.deleteMany({})).count,
    qaTestingSessions: (await prisma.qATestingSession.deleteMany({})).count,
    plantLabResults: (await prisma.plantLabResult.deleteMany({})).count,
    dispatchLabResults: (await prisma.dispatchLabResult.deleteMany({})).count,
    plantFinalDualReconciliations: (await prisma.plantFinalDualReconciliation.deleteMany({})).count,
    siloTransactions: (await prisma.siloInventoryTransaction.deleteMany({})).count,
    unloadingLogs: (await prisma.unloadingLog.deleteMany({})).count,
    weightTickets: (await prisma.weightTicket.deleteMany({})).count,
    gateLogs: (await prisma.gateLog.deleteMany({})).count,
    dispatchInfos: (await prisma.dispatchInfo.deleteMany({})).count,
    dispatchQuantityPolicySnapshots: (await prisma.dispatchQuantityPolicySnapshot.deleteMany({})).count,
    visitPortions: (await prisma.visitPortion.deleteMany({})).count,
    qaWarnings: (await prisma.qAWarning.deleteMany({})).count,
    vehicleVisits: (await prisma.vehicleVisit.deleteMany({})).count,
    monthlyReceptionCounters: (await prisma.monthlyReceptionCounter.deleteMany({})).count,
    auditLogs: (await prisma.auditLog.deleteMany({})).count,

    // Demo-Owned Master Data Deletions ONLY (Preserves all non-demo master data)
    zmccDemoLocalSuppliers: (await prisma.zmccLocalSupplier.deleteMany({
      where: {
        OR: [
          { erp_reference: { startsWith: 'DEMO-' } },
          { name: { startsWith: 'DEMO -' } },
        ],
      },
    })).count,
    motDemoVehicles: (await prisma.motVehicle.deleteMany({
      where: { vehicle_number: { startsWith: 'DEMO-' } },
    })).count,
    motDemoProfiles: (await prisma.motProfile.deleteMany({
      where: { mot_code: { startsWith: 'DEMO-' } },
    })).count,
    zmccDemoShops: (await prisma.zmccShop.deleteMany({
      where: { shop_code: { startsWith: 'DEMO-' } },
    })).count,
    zmccDemoAreas: (await prisma.zmccArea.deleteMany({
      where: { area_code: { startsWith: 'DEMO-' } },
    })).count,
    zmccDemoMilkSources: (await prisma.zmccMilkSource.deleteMany({
      where: { erp_code: { startsWith: 'DEMO-' } },
    })).count,
    zmccDemoRoutes: (await prisma.zmccRoute.deleteMany({
      where: { route_code: { startsWith: 'DEMO-' } },
    })).count,
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
    zmccTanks: await prisma.zmccTank.count(),
    labTests: await prisma.labTest.count(),
    labTestRules: await prisma.labTestRule.count(),
    paperReferencePolicies: await prisma.paperReferencePolicy.count(),
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
