import fs from 'fs';
import path from 'path';
import { MilkProcessLog } from '../src/backend/core/types';

async function run4EATests() {
  console.log('================================================================================');
  console.log('STAGE 4E-A: ARCHITECTURE BOUNDARY & ZMCC DETACHMENT TEST SUITE');
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

  // Helper to read all files in zmcc workspace directory
  const zmccDir = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc');
  const zmccWorkspaceFile = path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx');
  const zmccPageFile = path.join(__dirname, '../src/app/mpd/zmcc-manager/page.tsx');

  const zmccFiles = [
    zmccWorkspaceFile,
    zmccPageFile,
    ...fs.readdirSync(zmccDir).map((f) => path.join(zmccDir, f)),
  ];

  const zmccContents = zmccFiles.map((f) => ({
    file: f,
    content: fs.readFileSync(f, 'utf8'),
  }));

  // A1: Current ZMCC does not import LogDetailModal
  const hasLogDetailModal = zmccContents.some((c) =>
    c.content.includes('LogDetailModal')
  );
  assert(!hasLogDetailModal, 'A1: Current ZMCC does not import LogDetailModal');

  // A2: Current ZMCC does not import ZonalHistoryTable
  const hasZonalHistoryTable = zmccContents.some((c) =>
    c.content.includes('ZonalHistoryTable')
  );
  assert(!hasZonalHistoryTable, 'A2: Current ZMCC does not import ZonalHistoryTable');

  // A3: Current ZMCC does not import KanbanBoard
  const hasKanbanBoard = zmccContents.some((c) =>
    c.content.includes('KanbanBoard')
  );
  assert(!hasKanbanBoard, 'A3: Current ZMCC does not import KanbanBoard');

  // A4: Current ZMCC does not import legacy CrossVerification
  const hasLegacyCrossVerification = zmccContents.some(
    (c) =>
      c.content.includes("from '@modules/dashboard/CrossVerification'") ||
      c.content.includes("from '../CrossVerification'")
  );
  assert(!hasLegacyCrossVerification, 'A4: Current ZMCC does not import legacy CrossVerification');

  // A5: Current ZMCC does not import AdaptiveVehicleCard
  const hasAdaptiveVehicleCard = zmccContents.some((c) =>
    c.content.includes('AdaptiveVehicleCard')
  );
  assert(!hasAdaptiveVehicleCard, 'A5: Current ZMCC does not import AdaptiveVehicleCard');

  // A6: Current ZMCC does not import operationalCalculations
  const hasOperationalCalculations = zmccContents.some((c) =>
    c.content.includes('operationalCalculations')
  );
  assert(!hasOperationalCalculations, 'A6: Current ZMCC does not import operationalCalculations');

  // A7: ZMCCManagerVisitDetailModal exists
  const modalPath = path.join(zmccDir, 'ZMCCManagerVisitDetailModal.tsx');
  assert(fs.existsSync(modalPath), 'A7: ZMCCManagerVisitDetailModal exists');

  // A8: Workspace uses ZMCCManagerVisitDetailModal
  const workspaceSrc = fs.readFileSync(zmccWorkspaceFile, 'utf8');
  assert(
    workspaceSrc.includes('ZMCCManagerVisitDetailModal') &&
    workspaceSrc.includes('<ZMCCManagerVisitDetailModal'),
    'A8: Workspace uses ZMCCManagerVisitDetailModal'
  );

  const modalSrc = fs.readFileSync(modalPath, 'utf8');

  // A9: vehicle Gross uses authoritative vehicle-level value
  assert(
    modalSrc.includes('log.vehicle_dispatch_gross_liters != null'),
    'A9: vehicle Gross uses authoritative vehicle-level value (vehicle_dispatch_gross_liters)'
  );

  // A10: vehicle Gross null + portion gross exists -> unavailable
  assert(
    !modalSrc.includes('log.dispatch_liters_gross') ||
    !modalSrc.includes('sum'),
    'A10: Vehicle Gross does not fall back to portion gross sums'
  );

  // A11: Physical Received uses authoritative_final_liters
  assert(
    modalSrc.includes('log.authoritative_final_liters != null') &&
    modalSrc.includes('log.authoritative_final_liters.toLocaleString()'),
    'A11: Physical Received uses authoritative_final_liters'
  );

  // A12: authoritative_final_liters null + computed_plant_liters exists -> unavailable
  assert(
    !modalSrc.includes('log.computed_plant_liters'),
    'A12: Physical Received does not use computed_plant_liters'
  );

  // A13: computed_plant_13ts_liters not used as final authority
  assert(
    !modalSrc.includes('log.computed_plant_13ts_liters'),
    'A13: computed_plant_13ts_liters is not used as final authority'
  );

  // A14: Final @13 displays unavailable
  assert(
    modalSrc.includes('Final Liters @ 13% TS') &&
    modalSrc.includes('—'),
    'A14: Final @13 displays unavailable ("—")'
  );

  // A15: portion QA remains portion-wise
  assert(
    modalSrc.includes('log.calculated_status') &&
    modalSrc.includes('log.portion_number'),
    'A15: Portion QA displays portion-wise calculated_status'
  );

  // A16: detail modal contains no mutation controls
  const hasMutationControls =
    modalSrc.includes('handleAccept') ||
    modalSrc.includes('handleReject') ||
    modalSrc.includes('handleFinalize') ||
    modalSrc.includes('handleCorrect') ||
    modalSrc.includes('handleDelete') ||
    modalSrc.includes('handleEdit') ||
    modalSrc.includes('onApprove') ||
    modalSrc.includes('onAcknowledge') ||
    modalSrc.includes('handleSave') ||
    modalSrc.includes('handleSubmit');
  assert(!hasMutationControls, 'A16: Detail modal contains no mutation controls');

  // A17: CANONICAL-CODE-MAP contains current/legacy boundary rule
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  assert(fs.existsSync(mapPath), 'A17.1: CANONICAL-CODE-MAP.md exists');
  const mapSrc = fs.readFileSync(mapPath, 'utf8');
  assert(
    mapSrc.includes('Being located under `src/app` does **NOT** mean code is current') &&
    mapSrc.includes('NEW OR CURRENT CODE MUST NOT IMPORT THEM'),
    'A17.2: CANONICAL-CODE-MAP contains explicit current/legacy boundary rules'
  );

  // A18: CANONICAL-CODE-MAP contains route ownership map
  assert(
    mapSrc.includes('Route Ownership Map') &&
    mapSrc.includes('/mpd/zmcc-manager') &&
    mapSrc.includes('/department/production') &&
    mapSrc.includes('/super-admin/users'),
    'A18: CANONICAL-CODE-MAP contains route ownership map'
  );

  // A19: legacy routes are explicitly marked LEGACY
  assert(
    mapSrc.includes('/management/dashboard') &&
    mapSrc.includes('LEGACY ACTIVE') &&
    mapSrc.includes('/cross-verification') &&
    mapSrc.includes('/fleet-tracking'),
    'A19: Legacy routes are explicitly marked LEGACY ACTIVE'
  );

  // A20: future roles are explicitly marked NOT READY
  assert(
    mapSrc.includes('CONTRACTOR_MANAGER') &&
    mapSrc.includes('EXECUTIVE_MANAGEMENT') &&
    mapSrc.includes('Future Roles (Not Yet Ready)'),
    'A20: Future roles are explicitly marked NOT YET READY'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EATests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
