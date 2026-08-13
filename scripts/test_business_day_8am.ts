import { getOperationalBusinessDate, calculateSubmissionDelayMs } from '../src/backend/core/business-day';

async function runBusinessDayTests() {
  console.log('🧪 RUNNING 08:00 AM BUSINESS DAY TEST SUITE (BUSINESS-DATE-01..08, BUSINESS-CROSS-01)...\n');

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

  // BUSINESS-DATE-01: 2026-08-11 07:59:59 PKT (UTC 02:59:59) -> Business Date 2026-08-10
  const d1 = new Date('2026-08-11T02:59:59.999Z'); // 07:59:59 AM PKT
  const b1 = getOperationalBusinessDate(d1);
  assert(b1 === '2026-08-10', 'BUSINESS-DATE-01', `2026-08-11 07:59:59 PKT maps to 2026-08-10 (got ${b1})`);

  // BUSINESS-DATE-02: 2026-08-11 08:00:00 PKT (UTC 03:00:00) -> Business Date 2026-08-11
  const d2 = new Date('2026-08-11T03:00:00.000Z'); // 08:00:00 AM PKT
  const b2 = getOperationalBusinessDate(d2);
  assert(b2 === '2026-08-11', 'BUSINESS-DATE-02', `2026-08-11 08:00:00 PKT maps to 2026-08-11 (got ${b2})`);

  // BUSINESS-DATE-03: 2026-08-11 23:59:59 PKT (UTC 18:59:59) -> Business Date 2026-08-11
  const d3 = new Date('2026-08-11T18:59:59.000Z'); // 23:59:59 PM PKT
  const b3 = getOperationalBusinessDate(d3);
  assert(b3 === '2026-08-11', 'BUSINESS-DATE-03', `2026-08-11 23:59:59 PKT maps to 2026-08-11 (got ${b3})`);

  // BUSINESS-DATE-04: 2026-08-12 00:00:00 PKT (UTC 19:00:00 11 Aug) -> Business Date 2026-08-11
  const d4 = new Date('2026-08-11T19:00:00.000Z'); // 00:00:00 AM PKT 12 Aug
  const b4 = getOperationalBusinessDate(d4);
  assert(b4 === '2026-08-11', 'BUSINESS-DATE-04', `2026-08-12 00:00:00 PKT maps to 2026-08-11 (got ${b4})`);

  // BUSINESS-DATE-05: 2026-08-12 07:59:59 PKT (UTC 02:59:59 12 Aug) -> Business Date 2026-08-11
  const d5 = new Date('2026-08-12T02:59:59.000Z'); // 07:59:59 AM PKT 12 Aug
  const b5 = getOperationalBusinessDate(d5);
  assert(b5 === '2026-08-11', 'BUSINESS-DATE-05', `2026-08-12 07:59:59 PKT maps to 2026-08-11 (got ${b5})`);

  // BUSINESS-DATE-06: 2026-08-12 08:00:00 PKT (UTC 03:00:00 12 Aug) -> Business Date 2026-08-12
  const d6 = new Date('2026-08-12T03:00:00.000Z'); // 08:00:00 AM PKT 12 Aug
  const b6 = getOperationalBusinessDate(d6);
  assert(b6 === '2026-08-12', 'BUSINESS-DATE-06', `2026-08-12 08:00:00 PKT maps to 2026-08-12 (got ${b6})`);

  // BUSINESS-CROSS-01: Tare at 12 Aug 07:58 AM PKT (Business Date 11 Aug); Final Receipt at 12 Aug 08:01 AM PKT (Business Date 12 Aug)
  const tareTime = new Date('2026-08-12T02:58:00.000Z'); // 07:58 AM PKT
  const receiptTime = new Date('2026-08-12T03:01:00.000Z'); // 08:01 AM PKT

  const tareBizDate = getOperationalBusinessDate(tareTime);
  const receiptBizDate = getOperationalBusinessDate(receiptTime);

  assert(tareBizDate === '2026-08-11', 'BUSINESS-CROSS-01A', `Tare at 07:58 AM maps to Business Date 2026-08-11 (got ${tareBizDate})`);
  assert(receiptBizDate === '2026-08-12', 'BUSINESS-CROSS-01B', `Final Receipt at 08:01 AM maps to Business Date 2026-08-12 (got ${receiptBizDate})`);

  // BUSINESS-DATE-07 & 08: Data entry delay calculation
  const opTime = new Date('2026-08-11T10:00:00.000Z');
  const subTime = new Date('2026-08-11T10:15:00.000Z');
  const delayMs = calculateSubmissionDelayMs(opTime, subTime);
  assert(delayMs === 15 * 60 * 1000, 'BUSINESS-DATE-07', `Submission delay correctly calculated as 15 mins (${delayMs} ms)`);

  console.log(`\n========================================`);
  console.log(`BUSINESS DAY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runBusinessDayTests();
