import { validateOperationalTimestamp } from '../src/backend/services/chronology-validator';

async function runChronologyTests() {
  console.log('==================================================');
  console.log('RUNNING OPERATIONAL TIMESTAMP CHRONOLOGY TESTS (TIME-A..Q)');
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

  const now = new Date();
  const dispatchTs = new Date(now.getTime() - 3600 * 1000); // 1 hr ago
  const entryTs = new Date(now.getTime() - 2700 * 1000);   // 45m ago
  const qaStartTs = new Date(now.getTime() - 2400 * 1000);  // 40m ago
  const qaHoldTs = new Date(now.getTime() - 2100 * 1000);   // 35m ago
  const qaResumeTs = new Date(now.getTime() - 1800 * 1000); // 30m ago
  const qaCompleteTs = new Date(now.getTime() - 1500 * 1000); // 25m ago
  const grossTs = new Date(now.getTime() - 1200 * 1000);    // 20m ago
  const unloadStartTs = new Date(now.getTime() - 900 * 1000); // 15m ago
  const unloadCompTs = new Date(now.getTime() - 600 * 1000);  // 10m ago
  const tareTs = new Date(now.getTime() - 300 * 1000);       // 5m ago
  const futureTs = new Date(now.getTime() + 10 * 1000);       // 10s in future

  // TIME-A: Future Dispatch rejected
  const timeA = validateOperationalTimestamp(futureTs.toISOString(), null, 'Dispatch', 'Baseline');
  assert(!timeA.isValid, 'TIME-A', 'Future Dispatch timestamp rejected');

  // TIME-B: Gate Entry before Dispatch rejected
  const beforeDispatch = new Date(dispatchTs.getTime() - 1000);
  const timeB = validateOperationalTimestamp(beforeDispatch.toISOString(), dispatchTs, 'Gate Entry', 'Dispatch');
  assert(!timeB.isValid, 'TIME-B', 'Gate Entry before Dispatch rejected');

  // TIME-C: Future Gate Entry rejected
  const timeC = validateOperationalTimestamp(futureTs.toISOString(), dispatchTs, 'Gate Entry', 'Dispatch');
  assert(!timeC.isValid, 'TIME-C', 'Future Gate Entry rejected');

  // TIME-D: QA Start before Gate Entry rejected
  const beforeEntry = new Date(entryTs.getTime() - 1); // 1ms before
  const timeD = validateOperationalTimestamp(beforeEntry.toISOString(), entryTs, 'QA Start', 'Gate Entry');
  assert(!timeD.isValid, 'TIME-D', 'QA Start 1ms before Gate Entry rejected');

  // TIME-E: QA Hold before QA Start rejected
  const beforeQAStart = new Date(qaStartTs.getTime() - 1);
  const timeE = validateOperationalTimestamp(beforeQAStart.toISOString(), qaStartTs, 'QA Hold', 'QA Start');
  assert(!timeE.isValid, 'TIME-E', 'QA Hold 1ms before QA Start rejected');

  // TIME-F: QA Resume before Hold rejected
  const beforeHold = new Date(qaHoldTs.getTime() - 1);
  const timeF = validateOperationalTimestamp(beforeHold.toISOString(), qaHoldTs, 'QA Resume', 'QA Hold');
  assert(!timeF.isValid, 'TIME-F', 'QA Resume 1ms before Hold rejected');

  // TIME-G: QA Complete before latest QA event rejected
  const beforeResume = new Date(qaResumeTs.getTime() - 1);
  const timeG = validateOperationalTimestamp(beforeResume.toISOString(), qaResumeTs, 'QA Complete', 'QA Resume');
  assert(!timeG.isValid, 'TIME-G', 'QA Complete 1ms before latest QA event rejected');

  // TIME-H: Gross before QA completion rejected
  const beforeQAComp = new Date(qaCompleteTs.getTime() - 1);
  const timeH = validateOperationalTimestamp(beforeQAComp.toISOString(), qaCompleteTs, 'Gross Weight', 'QA Completion');
  assert(!timeH.isValid, 'TIME-H', 'Gross weight 1ms before QA completion rejected');

  // TIME-I: Gross future timestamp rejected
  const timeI = validateOperationalTimestamp(futureTs.toISOString(), qaCompleteTs, 'Gross Weight', 'QA Completion');
  assert(!timeI.isValid, 'TIME-I', 'Future Gross weight timestamp rejected');

  // TIME-J: Unloading Start before Gross rejected
  const beforeGross = new Date(grossTs.getTime() - 1);
  const timeJ = validateOperationalTimestamp(beforeGross.toISOString(), grossTs, 'Unloading Start', 'Gross Weight');
  assert(!timeJ.isValid, 'TIME-J', 'Unloading Start 1ms before Gross weight rejected');

  // TIME-K: Unloading Complete before Start rejected
  const beforeUnloadStart = new Date(unloadStartTs.getTime() - 1);
  const timeK = validateOperationalTimestamp(beforeUnloadStart.toISOString(), unloadStartTs, 'Unloading Complete', 'Unloading Start');
  assert(!timeK.isValid, 'TIME-K', 'Unloading Complete 1ms before Unloading Start rejected');

  // TIME-L: Tare before Unloading Complete rejected
  const beforeUnloadComp = new Date(unloadCompTs.getTime() - 1);
  const timeL = validateOperationalTimestamp(beforeUnloadComp.toISOString(), unloadCompTs, 'Tare Weight', 'Unloading Complete');
  assert(!timeL.isValid, 'TIME-L', 'Tare weight 1ms before Unloading Complete rejected');

  // TIME-M: Gate Exit before Tare rejected for accepted flow
  const beforeTare = new Date(tareTs.getTime() - 1);
  const timeM = validateOperationalTimestamp(beforeTare.toISOString(), tareTs, 'Gate Exit', 'Tare Weight');
  assert(!timeM.isValid, 'TIME-M', 'Gate Exit 1ms before Tare weight rejected');

  // TIME-N: All-rejected Gate Exit before Gate Entry/QA rejection rejected
  const beforeRejectQA = new Date(qaCompleteTs.getTime() - 1);
  const timeN = validateOperationalTimestamp(beforeRejectQA.toISOString(), qaCompleteTs, 'Gate Exit', 'QA Rejection');
  assert(!timeN.isValid, 'TIME-N', 'All-rejected Gate Exit 1ms before QA Rejection rejected');

  // TIME-O: Future Gate Exit rejected
  const timeO = validateOperationalTimestamp(futureTs.toISOString(), tareTs, 'Gate Exit', 'Tare Weight');
  assert(!timeO.isValid, 'TIME-O', 'Future Gate Exit timestamp rejected');

  // TIME-P: Equal predecessor timestamp allowed (>= rule)
  const equalTime = validateOperationalTimestamp(dispatchTs.toISOString(), dispatchTs, 'Gate Entry', 'Dispatch');
  assert(equalTime.isValid, 'TIME-P', 'Timestamp exactly equal to predecessor is valid (<= / >= exact boundary)');

  // TIME-Q: Exact boundary test for serverNow (Server Now equal = PASS, +1ms = FAIL)
  const serverNowExact = new Date();
  const timeExactPass = validateOperationalTimestamp(serverNowExact.toISOString(), null, 'Current Action', 'Baseline');
  assert(timeExactPass.isValid, 'TIME-Q1', 'Timestamp equal to serverNow is valid');

  const serverNowFuture = new Date(serverNowExact.getTime() + 100);
  const timeExactFail = validateOperationalTimestamp(serverNowFuture.toISOString(), null, 'Current Action', 'Baseline');
  assert(!timeExactFail.isValid, 'TIME-Q2', 'Timestamp 100ms in future of serverNow is rejected');

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runChronologyTests().catch(console.error);
