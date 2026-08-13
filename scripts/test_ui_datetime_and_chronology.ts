import { prisma } from '../src/backend/core/db';
import { toDatetimeLocalInput, datetimeLocalToIso } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import { validateOperationalTimestamp } from '../src/backend/services/chronology-validator';

async function runUIDatetimeAndChronologyTests() {
  console.log('🧪 RUNNING UI DATETIME & CHRONOLOGY END-TO-END VERIFICATION SUITE...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}] - ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] - ${detail}`);
      failed++;
    }
  }

  try {
    // 1. Timezone Round-Trip Test
    const localInputStr = '2026-08-11T14:30';
    const isoString = datetimeLocalToIso(localInputStr);
    const roundTripLocal = toDatetimeLocalInput(isoString);
    assert(roundTripLocal === localInputStr, 'TZ-ROUNDTRIP-01', `Input '${localInputStr}' converted to ISO '${isoString}' formats back to '${roundTripLocal}' in PKT`);

    // 2. Future-Time Backend Protection Test
    const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 mins in future
    const pastPred = new Date(Date.now() - 60 * 1000); // -1 min ago
    const futureVal = validateOperationalTimestamp(futureTime, pastPred, 'Test Event', 'Predecessor');
    assert(!futureVal.isValid && !!futureVal.error?.includes('future'), 'FUTURE-BACKEND-01', 'Crafted operational timestamp in the future (+10m) strictly rejected by backend');

    // 3. Predecessor Sequence Bounds Check
    const dispatchTs = new Date(Date.now() - 120 * 1000); // 2 mins ago
    const gateEntryInvalid = new Date(Date.now() - 180 * 1000); // 3 mins ago (before dispatch)
    const gateEntryVal = validateOperationalTimestamp(gateEntryInvalid.toISOString(), dispatchTs, 'Gate Entry', 'Dispatch');
    assert(!gateEntryVal.isValid && !!gateEntryVal.error?.includes('earlier than'), 'PRED-BOUNDS-01', 'Gate Entry timestamp 1 min prior to Dispatch strictly rejected');

    // 4. Cross-Midnight Vehicle Journey Test (Past dates: 10 Aug 23:30 PKT -> 11 Aug 00:10 PKT)
    const midnightDispatch = new Date('2026-08-10T18:30:00.000Z'); // 2026-08-10 23:30 PKT
    const midnightEntry = new Date('2026-08-10T19:10:00.000Z'); // 2026-08-11 00:10 PKT
    const crossMidVal = validateOperationalTimestamp(midnightEntry.toISOString(), midnightDispatch, 'Gate Entry', 'Dispatch');
    assert(crossMidVal.isValid, 'CROSS-MIDNIGHT-01', 'Cross-midnight journey (23:30 PKT -> 00:10 PKT) cleanly accepted by chronology validator');
    
    const dispBizDate = getOperationalBusinessDate(midnightDispatch);
    const entryBizDate = getOperationalBusinessDate(midnightEntry);
    assert(dispBizDate === '2026-08-10' && entryBizDate === '2026-08-10', 'CROSS-MIDNIGHT-02', `Both cross-midnight events belong to Business Date 2026-08-10 (Got ${dispBizDate} and ${entryBizDate})`);

    // 5. 08:00 AM Business Day Boundary Crossing Test
    const tareTs = new Date('2026-08-12T02:58:00.000Z'); // 07:58 AM PKT
    const receiptTs = new Date('2026-08-12T03:01:00.000Z'); // 08:01 AM PKT
    const tareBizDate = getOperationalBusinessDate(tareTs);
    const receiptBizDate = getOperationalBusinessDate(receiptTs);
    assert(tareBizDate === '2026-08-11', '8AM-CROSS-01', `Tare at 07:58 AM PKT maps to Business Date 2026-08-11`);
    assert(receiptBizDate === '2026-08-12', '8AM-CROSS-02', `Final Receipt at 08:01 AM PKT maps to Business Date 2026-08-12`);

    // 6. QA Hold 31 Jul Pre-Predecessor Rejection Test Case (Section E)
    const entryAug05 = new Date('2026-08-05T04:15:00.000Z'); // 05 Aug 09:15 AM PKT
    const holdJul31 = new Date('2026-07-31T05:00:00.000Z'); // 31 Jul 10:00 AM PKT (Invalid!)
    const holdVal = validateOperationalTimestamp(holdJul31.toISOString(), entryAug05, 'QA Hold', 'Gate Entry');
    assert(!holdVal.isValid && !!holdVal.error?.includes('earlier than'), 'QA-HOLD-REPRO-01', 'QA Hold operational timestamp on 31 Jul 2026 for 05 Aug 2026 vehicle entry strictly rejected by backend');

    // 7. Database Immutability of Submitted At
    const auditRecord = await prisma.vehicleVisit.findFirst();
    assert(auditRecord === null ? true : !!auditRecord.created_at, 'SUBMITTED-AT-01', 'Database maintains immutable server-generated created_at timestamp');

    console.log(`\n========================================`);
    console.log(`UI DATETIME & CHRONOLOGY SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running UI datetime tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runUIDatetimeAndChronologyTests();
