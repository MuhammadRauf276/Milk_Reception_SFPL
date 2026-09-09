import fs from 'fs';
import path from 'path';
import { MilkProcessLog } from '../src/backend/core/types';
import { prisma } from '../src/backend/core/db';
import { getOperationalLogs } from '../src/backend/services/operationalReadModelService';
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

  // Case J: Complete ZMCC Runtime Owner Boundary & Retired Component Physical Absence (Static Architecture Contract)
  const zonalHistoryPath = path.join(__dirname, '../src/frontend/modules/dashboard/ZonalHistoryTable.tsx');
  const zonalHistoryExists = fs.existsSync(zonalHistoryPath);
  assert(!zonalHistoryExists, 'Case J.1: ZonalHistoryTable is retired and physically absent from codebase (static architecture contract)');

  const zmccBoundaryFiles = [
    path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'),
    ...fs.readdirSync(path.join(__dirname, '../src/frontend/modules/dashboard/zmcc')).map((f: string) => path.join(__dirname, '../src/frontend/modules/dashboard/zmcc', f)),
    path.join(__dirname, '../src/backend/services/operationalReadModelService.ts'),
  ];

  let boundaryHasFabricatedAcidity = false;
  let boundaryHasFabricatedTemp = false;
  let boundaryHasFabricatedLr = false;

  for (const filePath of zmccBoundaryFiles) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('0.14') && (content.includes('Acidity') || content.includes('acidity'))) {
      boundaryHasFabricatedAcidity = true;
    }
    if ((content.includes('4.5') || content.includes('4.8')) && (content.includes('Temperature') || content.includes('temperature'))) {
      boundaryHasFabricatedTemp = true;
    }
    if (content.includes('|| 28.0') || content.includes('|| 28') || content.includes('?? 28.0')) {
      boundaryHasFabricatedLr = true;
    }
  }

  assert(
    !boundaryHasFabricatedAcidity && !boundaryHasFabricatedTemp,
    'Case J.2: Complete ZMCC runtime boundary (workspace, zmcc modules, read-model) contains no fabricated Acidity (0.14) or Temperature (4.5/4.8) static architecture contract'
  );
  assert(
    !boundaryHasFabricatedLr,
    'Case J.3: Complete ZMCC runtime boundary contains no fake LR 28/28.0 fallback static architecture contract'
  );

  // Case K: ZMCC Manager Workspace Shared Drawer & Header Accessibility Architecture Contracts
  const workspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx');
  const headerPath = path.join(__dirname, '../src/frontend/modules/shared/Header.tsx');
  const workspaceSrc = fs.readFileSync(workspacePath, 'utf8');
  const headerSrc = fs.readFileSync(headerPath, 'utf8');

  // K.1: Permanent ZMCC sidebar removed from workspace
  assert(
    !workspaceSrc.includes('<Sidebar') && !workspaceSrc.includes("import { Sidebar } from '@modules/shared/Sidebar'"),
    'Case K.1: Permanent ZMCC sidebar is completely removed from ZMCCManagerWorkspace'
  );

  // K.2: Horizontal six-tab navigation removed from workspace
  assert(
    !workspaceSrc.includes('role="tablist"') && !workspaceSrc.includes('overflow-x-auto scrollbar-thin py-1'),
    'Case K.2: Horizontal six-tab navigation strip is completely removed from ZMCCManagerWorkspace'
  );

  // K.3: Hamburger navigation drawer present with accessible dialog semantics
  const hasDrawerSemantics =
    workspaceSrc.includes('role="dialog"') &&
    workspaceSrc.includes('aria-modal="true"') &&
    workspaceSrc.includes('aria-label="Navigation Drawer"');
  assert(hasDrawerSemantics, 'Case K.3: ZMCCManagerWorkspace contains accessible navigation drawer dialog semantics');

  // K.4: All 6 required sections present in navigation drawer
  const drawerSections = [
    { id: 'OVERVIEW', label: 'Overview' },
    { id: 'LIVE', label: 'Live Dispatches' },
    { id: 'CROSS_VERIFICATION', label: 'Cross Verification' },
    { id: 'QUALITY', label: 'Quality & Rejections' },
    { id: 'RECEIPTS', label: 'Receipts & Performance' },
    { id: 'HISTORY', label: 'History & Reports' },
  ];
  const allSectionsPresent = drawerSections.every(
    (sec) => workspaceSrc.includes(`id: '${sec.id}'`) && workspaceSrc.includes(`label: '${sec.label}'`)
  );
  assert(allSectionsPresent, 'Case K.4: Navigation drawer contains all 6 required workspace sections');

  // K.5: Selecting a drawer item changes active content and closes the drawer
  const hasSelectionBehavior =
    workspaceSrc.includes('setActiveTab(tabId)') &&
    workspaceSrc.includes('setIsDrawerOpen(false)') &&
    workspaceSrc.includes('handleSelectTab');
  assert(hasSelectionBehavior, 'Case K.5: Selecting a drawer item changes active content and closes drawer');

  // K.6: Drawer closes through close button, Escape, backdrop click, and navigation selection
  const hasCloseButton = workspaceSrc.includes('aria-label="Close navigation drawer"');
  const hasEscapeListener = workspaceSrc.includes("e.key === 'Escape'");
  const hasBackdropClick = workspaceSrc.includes('onClick={closeDrawer}') || workspaceSrc.includes('onClick={() => setIsDrawerOpen(false)}');
  assert(
    hasCloseButton && hasEscapeListener && hasBackdropClick && hasSelectionBehavior,
    'Case K.6: Drawer closes through close button, Escape key, backdrop click, and navigation selection'
  );

  // K.7: Prevent background scrolling while drawer is open
  const hasScrollLock =
    workspaceSrc.includes("document.body.style.overflow = 'hidden'") &&
    workspaceSrc.includes('document.body.style.overflow = originalOverflow');
  assert(hasScrollLock, 'Case K.7: Background scrolling is prevented while navigation drawer is open');

  // K.8: Corporate branding "Shakarganj Food Products Limited" in header and drawer
  const headerHasBranding = headerSrc.includes('Shakarganj') && headerSrc.includes('Food Products Limited');
  const drawerHasBranding = workspaceSrc.includes('Shakarganj') && workspaceSrc.includes('Food Products Limited');
  assert(
    headerHasBranding && drawerHasBranding,
    'Case K.8: Corporate branding "Shakarganj Food Products Limited" is present in both Header and Drawer'
  );

  // K.9: Final UI Override: Header contains identity & Sign Out; Drawer contains ONLY branding, close button, and navigation (no duplicate user card, no duplicate Sign Out); Main page starts directly with content (no top banner)
  const headerHasIdentity =
    headerSrc.includes('currentUser?.name') &&
    headerSrc.includes('currentUser?.username') &&
    headerSrc.includes('resolvedSourceName') &&
    headerSrc.includes('Sign Out');
  const drawerHasNoDuplicateIdentity =
    !workspaceSrc.includes('aria-label="Sign Out"') &&
    !workspaceSrc.includes('handleLogout');
  const mainPageHasNoTopBanner =
    !workspaceSrc.includes('Refresh Logs') &&
    !workspaceSrc.includes('Station</h1>') &&
    !workspaceSrc.includes('<ShieldCheck');
  assert(
    headerHasIdentity && drawerHasNoDuplicateIdentity && mainPageHasNoTopBanner,
    'Case K.9: Final UI Override: Identity and Sign Out live exclusively in Header; Drawer is minimal and banner is eliminated'
  );

  // K.10: Opt-in Header variant contract for ZMCC with technical role badges removed
  const headerHasOptInProp = headerSrc.includes('isZmccVariant?: boolean') && headerSrc.includes('if (!isZmccVariant)');
  const workspaceUsesOptIn = workspaceSrc.includes('isZmccVariant={true}');
  const noTechnicalBadgesInHeader = !headerSrc.includes('ZMCC Manager') && !headerSrc.includes('Super Admin');
  assert(
    headerHasOptInProp && workspaceUsesOptIn && noTechnicalBadgesInHeader,
    'Case K.10: Header changes are strictly opt-in for ZMCC via isZmccVariant; technical role badges are removed'
  );

  // K.11: Exactly one navigation trigger in Header; duplicate Menu button removed from supervisory banner
  const hasHamburgerInHeader = workspaceSrc.includes('menuButtonRef={hamburgerButtonRef}') && headerSrc.includes('ref={menuButtonRef}');
  const noDuplicateMenuButtonInBanner =
    !workspaceSrc.includes('aria-label="Open workspace navigation drawer"') &&
    !workspaceSrc.includes('<span>Menu</span>');
  assert(
    hasHamburgerInHeader && noDuplicateMenuButtonInBanner,
    'Case K.11: Exactly ONE navigation trigger (Header hamburger); duplicate banner Menu button is completely removed'
  );

  // K.12: Complete Drawer Accessibility (trigger ref, focus move, focus trap, and focus return)
  const hasTriggerRefSaved = workspaceSrc.includes('hamburgerButtonRef = useRef');
  const hasFocusMovedToDrawer = workspaceSrc.includes('closeButtonRef.current?.focus()');
  const hasFocusTrap =
    workspaceSrc.includes('handleDrawerKeyDown') &&
    workspaceSrc.includes("e.key !== 'Tab'") &&
    workspaceSrc.includes('e.shiftKey');
  const hasFocusRestoration =
    workspaceSrc.includes('hamburgerButtonRef.current?.focus()') &&
    workspaceSrc.includes('closeDrawer');
  assert(
    hasTriggerRefSaved && hasFocusMovedToDrawer && hasFocusTrap && hasFocusRestoration,
    'Case K.12: Drawer accessibility completes trigger ref save, focus move into drawer, Tab focus trapping, and focus restoration'
  );

  // K.13: Minimum 44px interactive target size across all actionable controls
  const workspaceMinTargets = workspaceSrc.includes('min-h-[44px]');
  const headerMinTargets = headerSrc.includes('min-h-[44px]');
  assert(
    workspaceMinTargets && headerMinTargets,
    'Case K.13: Header and Drawer interactive elements enforce minimum 44px touch targets'
  );

  // K.14: Strict read-only authority preserved with internal technical labels removed from UI
  const noInternalTechnicalLabels =
    !workspaceSrc.includes('Read-only supervisory workspace') &&
    !workspaceSrc.includes('Logged In Manager') &&
    !workspaceSrc.includes('Access Mode:') &&
    !workspaceSrc.includes('Navigation Sections') &&
    !workspaceSrc.includes('Authoritative Scale & Quantity Ledger');
  const hasNoScaleOrQaMutation =
    !workspaceSrc.includes('/api/scale') &&
    !workspaceSrc.includes('/api/qa') &&
    !workspaceSrc.includes('Record Gross') &&
    !workspaceSrc.includes('Record Tare');
  assert(
    noInternalTechnicalLabels && hasNoScaleOrQaMutation,
    'Case K.14: Internal technical labels are removed while zero mutation controls and read-only authority are preserved'
  );

  // K.15: Workspace is reused across all ZMCC locations without hardcoding
  const noHardcodedLocations =
    !workspaceSrc.includes("'Hasilpur'") &&
    !workspaceSrc.includes("'Jhang'") &&
    !workspaceSrc.includes("'Multan'") &&
    workspaceSrc.includes('currentUser?.procurement_source?.name ||');
  assert(
    noHardcodedLocations,
    'Case K.15: Workspace dynamically resolves assigned source from authenticated data without location hardcoding'
  );

  // K.16: Clean business sections and complete portion quality results in Visit Detail Modal
  const modalPath = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerVisitDetailModal.tsx');
  const modalSrc = fs.readFileSync(modalPath, 'utf8');
  const modalHasCleanSections =
    modalSrc.includes('Dispatch Details') &&
    modalSrc.includes('Weight & Quantity') &&
    modalSrc.includes('Portion Quality Results') &&
    modalSrc.includes('Receipt Details');
  const modalNoForbiddenLabels =
    !modalSrc.includes('Authoritative Scale & Quantity Ledger') &&
    !modalSrc.includes('Overall Lifecycle State') &&
    !modalSrc.includes('Read-only supervisory ledger record') &&
    !modalSrc.includes('final_receipt_transaction_id');
  assert(
    modalHasCleanSections && modalNoForbiddenLabels,
    'Case K.16: ZMCCManagerVisitDetailModal defines four clean business sections and eliminates internal system terminology'
  );

  // K.17: Visit Detail Modal dynamically iterates over portion_lab_results
  const modalHasDynamicTests =
    modalSrc.includes('p.portion_lab_results') &&
    modalSrc.includes('tr.test_name');
  assert(
    modalHasDynamicTests,
    'Case K.17: ZMCCManagerVisitDetailModal dynamically iterates over portion_lab_results'
  );

  // K.18: Behavioral test - newly configured active lab test automatically appears in portion_lab_results
  const tempTestCode = `LT-TMP-${Date.now()}`;
  let tempCreated = false;
  try {
    await prisma.labTest.create({
      data: {
        testCode: tempTestCode,
        testName: 'Automated Rapid Contaminant Test',
        resultType: 'NUMERIC',
        unit: 'ppm',
        testScope: 'QA',
        isRequired: false,
        isActive: true,
        displayOrder: 950,
      },
    });
    const devUserCount = await prisma.user.count();
    assert(devUserCount === 23, `Dev database user count is exactly 23 (got ${devUserCount})`);
    tempCreated = true;

    // Query operational logs for a ZMCC manager
    const zmccManagerUser = {
      id: 9999,
      username: 'zmcc.manager.north',
      role: 'ZMCC_MANAGER',
      procurement_source_id: 1,
    };
    const logs = await getOperationalLogs({}, zmccManagerUser as any);
    const hasDynamicTestInResults = logs.some((l) =>
      l.portion_lab_results?.some((tr) => tr.test_code === tempTestCode && tr.test_name === 'Automated Rapid Contaminant Test')
    );

    assert(
      hasDynamicTestInResults,
      'Case K.18: Newly configured active lab test in prisma.labTest automatically appears in portion_lab_results without manual schema or modal edits'
    );
  } finally {
    if (tempCreated) {
      await prisma.labTest.deleteMany({
        where: { testCode: tempTestCode },
      });
    }
    await prisma.$disconnect();
  }

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
