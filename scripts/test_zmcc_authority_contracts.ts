import { MilkProcessLog } from '../src/backend/core/types';
import {
  deriveManagerLifecycle,
  buildVehicleVisitGroups,
} from '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers';

async function runAuthorityTests() {
  console.log('================================================================================');
  console.log('FOCUSED ZMCC & READ-MODEL AUTHORITY FALLBACK VERIFICATION SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // Case A: final_receipt_exists = true, authoritative_final_liters = null, computed_plant_liters = 9800
  // Required: Final Physical Received Liters is null / unavailable (NO fallback to computed_plant_liters)
  const mockLogA: MilkProcessLog = {
    id: 1001,
    vehicle_number: 'LES-1001',
    portion_number: 'P-01',
    zonal_contractor_name: 'ZMCC Test Zone',
    status: 'COMPLETED',
    final_receipt_exists: true,
    authoritative_final_liters: null,
    computed_plant_liters: 9800,
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15200,
    computed_net_milk_weight: 9800,
    created_at: '2026-08-27T10:00:00.000Z',
    updated_at: '2026-08-27T10:00:00.000Z',
    dispatch_date: '2026-08-27',
  };

  const lifecycleA = deriveManagerLifecycle([mockLogA]);
  const receiptStageA = lifecycleA.stages.find((s) => s.id === 'FINAL_RECEIPT');
  const groupsA = buildVehicleVisitGroups([mockLogA]);

  assert(
    receiptStageA?.metricText === null,
    'Case A.1: Final receipt stage metricText is null when authoritative_final_liters is null',
    `metricText=${receiptStageA?.metricText}`
  );
  assert(
    groupsA[0]?.physicalReceivedLiters === null,
    'Case A.2: VehicleVisitGroup.physicalReceivedLiters is strictly null without computed_plant_liters fallback',
    `physicalReceivedLiters=${groupsA[0]?.physicalReceivedLiters}`
  );

  // Case B: computed_plant_13ts_liters exists, but no authoritative final @13 exists
  // Required: plant13TsLiters is null / unavailable
  const mockLogB: MilkProcessLog = {
    ...mockLogA,
    id: 1002,
    vehicle_number: 'LES-1002',
    computed_plant_13ts_liters: 9500,
  };

  const groupsB = buildVehicleVisitGroups([mockLogB]);
  assert(
    groupsB[0]?.plant13TsLiters === null,
    'Case B: VehicleVisitGroup.plant13TsLiters is strictly null (no fake @13TS presented as authoritative)',
    `plant13TsLiters=${groupsB[0]?.plant13TsLiters}`
  );

  // Case C: Vehicle dispatch authority missing, primary portion has dispatch_liters_gross
  // Required: vehicleDispatchQuantityValue is null (NO portion fallback)
  const mockLogC: MilkProcessLog = {
    ...mockLogA,
    id: 1003,
    vehicle_number: 'LES-1003',
    vehicle_dispatch_quantity_value: null,
    vehicle_dispatch_quantity_unit: null,
    vehicle_dispatch_gross_liters: null,
    dispatch_liters_gross: 5000,
    dispatch_kg_gross: null,
  };

  const groupsC = buildVehicleVisitGroups([mockLogC]);
  assert(
    groupsC[0]?.vehicleDispatchQuantityValue === null &&
    groupsC[0]?.vehicleDispatchQuantityUnit === null &&
    groupsC[0]?.totalDispatchGrossLiters === null,
    'Case C: Vehicle dispatch quantity does NOT fall back to portion dispatch_liters_gross',
    `vehicleDispatchQuantityValue=${groupsC[0]?.vehicleDispatchQuantityValue}`
  );

  // Case D: Vehicle dispatch authority missing, primary portion has dispatch_kg_gross
  // Required: vehicleDispatchQuantityValue is null (NO portion fallback or KG conversion)
  const mockLogD: MilkProcessLog = {
    ...mockLogA,
    id: 1004,
    vehicle_number: 'LES-1004',
    vehicle_dispatch_quantity_value: null,
    vehicle_dispatch_quantity_unit: null,
    vehicle_dispatch_gross_liters: null,
    dispatch_liters_gross: null,
    dispatch_kg_gross: 5150,
  };

  const groupsD = buildVehicleVisitGroups([mockLogD]);
  assert(
    groupsD[0]?.vehicleDispatchQuantityValue === null &&
    groupsD[0]?.vehicleDispatchQuantityUnit === null &&
    groupsD[0]?.totalDispatchGrossLiters === null,
    'Case D: Vehicle dispatch quantity does NOT fall back to portion dispatch_kg_gross',
    `vehicleDispatchQuantityValue=${groupsD[0]?.vehicleDispatchQuantityValue}`
  );

  // Case E: dispatch_date missing, created_at present
  // Required: Business Date does NOT use created_at
  const mockLogE: MilkProcessLog = {
    ...mockLogA,
    id: 1005,
    vehicle_number: 'LES-1005',
    dispatch_date: null,
    created_at: '2026-08-27T03:00:00.000Z',
  };

  const groupsE = buildVehicleVisitGroups([mockLogE]);
  assert(
    groupsE[0]?.businessDate === '',
    'Case E: VehicleVisitGroup.businessDate does NOT fall back to created_at when dispatch_date is missing',
    `businessDate="${groupsE[0]?.businessDate}"`
  );

  // Case F: operational_date missing in read model input
  // Required: dispatch_date in read model output does NOT invent date from created_at
  // Static / structural check on operationalReadModelService
  const fs = require('fs');
  const path = require('path');
  const readModelSrc = fs.readFileSync(path.join(__dirname, '../src/backend/services/operationalReadModelService.ts'), 'utf8');
  assert(
    !readModelSrc.includes('visit.operational_date ? new Date(visit.operational_date) : new Date(visit.created_at)'),
    'Case F.1: operationalReadModelService does NOT fall back to created_at when operational_date is missing'
  );
  assert(
    readModelSrc.includes('const opDate = visit.operational_date ? new Date(visit.operational_date) : null;'),
    'Case F.2: operationalReadModelService strictly uses nullable opDate from visit.operational_date'
  );

  // Case G: Canonical Role-to-Home Routing Policy (ZMCC_MANAGER -> /mpd/zmcc-manager, MPD_Zone_Manager -> /workspace-unavailable)
  const { resolveRoleHome } = require('../src/lib/role-routing');
  const zmccManagerDest = resolveRoleHome('ZMCC_MANAGER');
  const legacyZoneManagerDest = resolveRoleHome('MPD_Zone_Manager');
  const upperZoneManagerDest = resolveRoleHome('MPD_ZONE_MANAGER');
  assert(
    zmccManagerDest === '/mpd/zmcc-manager' &&
    legacyZoneManagerDest === '/workspace-unavailable' &&
    upperZoneManagerDest === '/workspace-unavailable',
    'Case G: resolveRoleHome routes canonical ZMCC_MANAGER to /mpd/zmcc-manager and fails closed on retired MPD_Zone_Manager',
    `ZMCC_MANAGER=${zmccManagerDest}, MPD_Zone_Manager=${legacyZoneManagerDest}`
  );

  // Case H: Canonical ZMCC Manager Seed Configuration
  const seedSrc = fs.readFileSync(path.join(__dirname, '../prisma/seed.ts'), 'utf8');
  const hasCanonicalSeed =
    seedSrc.includes("username: 'zmcc.manager.north'") &&
    seedSrc.includes("role: 'ZMCC_MANAGER'") &&
    seedSrc.includes("scopeType: 'SOURCE'") &&
    seedSrc.includes("sourceCode: 'ZMCC-HASILPUR'");
  assert(
    hasCanonicalSeed,
    'Case H: prisma/seed.ts assigns zmcc.manager.north canonical role ZMCC_MANAGER, scopeType SOURCE, and sourceCode ZMCC-HASILPUR'
  );

  // Case I: Core Types Fixture and DEFAULT_USERS Canonical Structure
  const { FIXTURE_USER_PROFILES, DEFAULT_USERS } = require('../src/backend/core/types');
  const zmccFixture = FIXTURE_USER_PROFILES['zmcc.manager.north'];
  const hasCanonicalFixture =
    zmccFixture?.role === 'ZMCC_MANAGER' &&
    zmccFixture?.scope_type === 'SOURCE' &&
    zmccFixture?.zone === 'ZMCC Hasilpur';
  const hasCanonicalDefaultUsers =
    DEFAULT_USERS['ZMCC_MANAGER']?.username === 'zmcc.manager.north' &&
    DEFAULT_USERS['MPD_Zone_Manager'] === undefined;
  assert(
    hasCanonicalFixture && hasCanonicalDefaultUsers,
    'Case I: FIXTURE_USER_PROFILES and DEFAULT_USERS map zmcc.manager.north to canonical ZMCC_MANAGER without active legacy alias',
    `fixtureRole=${zmccFixture?.role}, defaultUsersZMCC=${DEFAULT_USERS['ZMCC_MANAGER']?.username}`
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthorityTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
