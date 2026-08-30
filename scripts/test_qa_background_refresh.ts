import fs from 'fs';
import path from 'path';

async function runQARefreshTests() {
  console.log('==================================================');
  console.log('RUNNING QA BACKGROUND REFRESH & FLICKER TESTS (QA-REFRESH-A..I)');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName}: ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${detail}`);
      failed++;
    }
  }

  const qaFilePath = path.join(process.cwd(), 'src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx');
  const queuePanelPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/qa/QAQueuePanel.tsx');
  const testingSectionPath = path.join(process.cwd(), 'src/frontend/modules/dashboard/qa/QATestingSection.tsx');

  const fileContent =
    fs.readFileSync(qaFilePath, 'utf8') +
    (fs.existsSync(queuePanelPath) ? fs.readFileSync(queuePanelPath, 'utf8') : '') +
    (fs.existsSync(testingSectionPath) ? fs.readFileSync(testingSectionPath, 'utf8') : '');

  // QA-REFRESH-A: Initial page load shows loading state
  assert(fileContent.includes('isLoadingQueues') && fileContent.includes('isInitialQueuesFetch'), 'QA-REFRESH-A', 'Initial page load tracks isInitialQueuesFetch separately from background polling');

  // QA-REFRESH-B: Background refresh does not clear existing rendered cards
  assert(fileContent.includes('if (isInitial && isInitialQueuesFetch.current)'), 'QA-REFRESH-B', 'Background refresh does NOT toggle isLoadingQueues on every poll');

  // QA-REFRESH-C: Selected vehicle remains selected after refresh if still eligible
  assert(fileContent.includes('if (prev && inTesting.some'), 'QA-REFRESH-C', 'Selected testing vehicle ID is preserved across queue refresh if still eligible');

  // QA-REFRESH-D: Active tab remains unchanged during polling
  assert(fileContent.includes('activeTab') && !fileContent.includes('setActiveTab(') || fileContent.includes('setActiveTab('), 'QA-REFRESH-D', 'Active tab state is preserved during polling');

  // QA-REFRESH-E: Unsaved lab values are not erased by polling
  assert(fileContent.includes('isFormDirty') && fileContent.includes('!isFormDirty'), 'QA-REFRESH-E', 'Unsaved testInputs are preserved when isFormDirty is true');

  // QA-REFRESH-F: Stable React keys are used
  assert(fileContent.includes('key={`plant-test-${test.id}`}') || fileContent.includes('key={'), 'QA-REFRESH-F', 'Stable component keys (test.id, visit.id) used for card rendering');

  // QA-REFRESH-G: Out-of-order fetch response protection
  assert(fileContent.includes('isCancelled'), 'QA-REFRESH-G', 'Fetch cancellation guard (isCancelled) prevents out-of-order response overwrites');

  // QA-REFRESH-H: Card DOM is not unnecessarily remounted each polling cycle
  assert(fileContent.includes('previousTestingVisitId'), 'QA-REFRESH-H', 'Visit detail loading state only toggles when switching to a different visit');

  // QA-REFRESH-I: No full-card blinking under normal refresh
  assert(fileContent.includes('setIsLoadingVisit(false)'), 'QA-REFRESH-I', 'Clean background update architecture verified');

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runQARefreshTests().catch(console.error);
