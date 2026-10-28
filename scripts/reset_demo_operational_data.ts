import 'dotenv/config';
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
    // Portions carry the new weighing / net-entry columns; delete them before their sessions
    zmccLabPortions: (await prisma.zmccLabPortion.deleteMany({})).count,
    zmccLabSessions: (await prisma.zmccLabSession.deleteMany({})).count,
    zmccLocalSupplierArrivals: (await prisma.zmccLocalSupplierArrival.deleteMany({})).count,
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

    // Seed-Owned Master Data Deletions ONLY (Preserves all non-seed master data)
    // HC suppliers have no ERP reference any more: seed rows are recognised by their DEMO name prefix
    zmccSeedLocalSuppliers: (await prisma.zmccLocalSupplier.deleteMany({
      where: {
        OR: [
          { name: { startsWith: 'DEMO -' } },
          { name: { in: ['Bashir Milk Collection Center', 'Chaudhry Dairy & Cattle Farm', 'Rehman Dairy Supplies'] } },
        ],
      },
    })).count,
    // Scenario seed (scripts/seed_scenarios_demo.ts) may create a Jhang demo tank; receipts/portions are already gone
    zmccSeedTanks: (await prisma.zmccTank.deleteMany({
      where: { tank_code: { startsWith: 'DEMO-SCN-' } },
    })).count,
    motSeedVehicles: (await prisma.motVehicle.deleteMany({
      where: {
        OR: [
          { vehicle_number: { startsWith: 'DEMO-' } },
          { vehicle_number: { in: ['BWP-5522', 'BWP-5523', 'BWP-5524', 'BWP-5525'] } },
        ],
      },
    })).count,
    motSeedProfiles: (await prisma.motProfile.deleteMany({
      where: {
        OR: [
          { mot_code: { startsWith: 'DEMO-' } },
          { mot_code: 'MOT-HAS-001' },
        ],
      },
    })).count,
    zmccSeedShops: (await prisma.zmccShop.deleteMany({
      where: {
        OR: [
          { shop_code: { startsWith: 'DEMO-' } },
          { shop_code: 'SHP-000001' },
          { area: { OR: [{ area_code: { startsWith: 'DEMO-' } }, { area_code: 'AR-HAS-01' }] } },
        ],
      },
    })).count,
    zmccSeedAreas: (await prisma.zmccArea.deleteMany({
      where: {
        OR: [
          { area_code: { startsWith: 'DEMO-' } },
          { area_code: 'AR-HAS-01' },
        ],
      },
    })).count,
    // Demo milk sources (their ZMCC assignments in milk_source_zmcc_visibility go with them)
    zmccSeedMilkSources: (await prisma.zmccMilkSource.deleteMany({
      where: {
        OR: [
          { erp_code: { startsWith: 'DEMO-' } },
          { erp_code: { startsWith: 'MS-HAS-' } },
        ],
      },
    })).count,
    zmccSeedRoutes: (await prisma.zmccRoute.deleteMany({
      where: {
        OR: [
          { route_code: { startsWith: 'DEMO-' } },
          { route_code: 'RT-HAS-001' },
        ],
      },
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
    milkSources: await prisma.zmccMilkSource.count(),
    motVehicles: await prisma.motVehicle.count(),
    weighingPolicyRows: await prisma.zmccWeighingPolicy.count(),
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
