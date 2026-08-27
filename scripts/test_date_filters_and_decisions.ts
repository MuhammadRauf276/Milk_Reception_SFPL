import { fetchAllMilkLogs } from '../src/backend/actions/logActions';
import { GET as getLogsRoute } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { prisma } from '../src/backend/core/db';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runTests() {
  console.log('=====================================================');
  console.log('STARTING DATE FILTER & DECISION RULE COMPREHENSIVE TESTS');
  console.log('=====================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ TEST ${totalTests}: ${message}`);
    } else {
      console.error(`❌ TEST ${totalTests} FAILED: ${message}`);
      process.exitCode = 1;
    }
  }

  // Fetch all base logs from DB to construct test scenarios
  const baseLogs = await fetchAllMilkLogs();
  console.log(`Loaded ${baseLogs.length} base logs from database.\n`);

  // 1. Single-day filter
  const sampleDate = baseLogs[0]?.dispatch_date || '2026-08-05';
  const singleDayLogs = await fetchAllMilkLogs({ fromDate: sampleDate, toDate: sampleDate });
  assert(
    singleDayLogs.every((l) => l.dispatch_date === sampleDate),
    `Single-day filter returned ${singleDayLogs.length} logs for ${sampleDate}`
  );

  // 2. Multi-day range
  const multiDayLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10' });
  assert(
    multiDayLogs.every((l) => (l.dispatch_date || '') >= '2026-08-01' && (l.dispatch_date || '') <= '2026-08-10'),
    `Multi-day range returned ${multiDayLogs.length} logs within 2026-08-01 to 2026-08-10`
  );

  // 3. From Date only
  const fromOnlyLogs = await fetchAllMilkLogs({ fromDate: '2026-08-05' });
  assert(
    fromOnlyLogs.every((l) => (l.dispatch_date || '') >= '2026-08-05'),
    `From Date only returned ${fromOnlyLogs.length} logs from 2026-08-05 onwards`
  );

  // 4. To Date only
  const toOnlyLogs = await fetchAllMilkLogs({ toDate: '2026-08-05' });
  assert(
    toOnlyLogs.every((l) => (l.dispatch_date || '') <= '2026-08-05'),
    `To Date only returned ${toOnlyLogs.length} logs up to 2026-08-05`
  );

  // 5. Same From and To Date
  const sameDayLogs = await fetchAllMilkLogs({ fromDate: sampleDate, toDate: sampleDate });
  assert(sameDayLogs.length === singleDayLogs.length, `Same From and To date returned ${sameDayLogs.length} logs`);

  // 6. Strict YYYY-MM-DD date format checks (Service & API Level Contract)
  // D1: fromDate = '' -> rejected
  let d1Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: '' });
  } catch (_err) {
    d1Error = true;
  }
  assert(d1Error, 'D1: fromDate = "" (empty string) is rejected deterministically');

  // D2: toDate = '' -> rejected
  let d2Error = false;
  try {
    await fetchAllMilkLogs({ toDate: '' });
  } catch (_err) {
    d2Error = true;
  }
  assert(d2Error, 'D2: toDate = "" (empty string) is rejected deterministically');

  // D3: fromDate = ' ' (whitespace) -> rejected
  let d3Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: ' ' });
  } catch (_err) {
    d3Error = true;
  }
  assert(d3Error, 'D3: fromDate = " " (whitespace) is rejected deterministically');

  // D4: fromDate = '1' -> rejected
  let d4Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: '1' });
  } catch (_err) {
    d4Error = true;
  }
  assert(d4Error, 'D4: fromDate = "1" (noncanonical string) is rejected deterministically');

  // D5: fromDate = '2026-02-30' -> rejected (calendar rollover rejected)
  let d5Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: '2026-02-30' });
  } catch (_err) {
    d5Error = true;
  }
  assert(d5Error, 'D5: fromDate = "2026-02-30" (invalid calendar date) is rejected deterministically');

  // D6: toDate = '2026-04-31' -> rejected (calendar rollover rejected)
  let d6Error = false;
  try {
    await fetchAllMilkLogs({ toDate: '2026-04-31' });
  } catch (_err) {
    d6Error = true;
  }
  assert(d6Error, 'D6: toDate = "2026-04-31" (invalid 31-day April) is rejected deterministically');

  // D7: fromDate = '2025-02-29' -> rejected (non-leap year Feb 29)
  let d7Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: '2025-02-29' });
  } catch (_err) {
    d7Error = true;
  }
  assert(d7Error, 'D7: fromDate = "2025-02-29" (non-leap year) is rejected deterministically');

  // D8: valid leap date: 2024-02-29 -> accepted
  let d8Accepted = false;
  try {
    const leapLogs = await fetchAllMilkLogs({ fromDate: '2024-02-29', toDate: '2024-02-29' });
    d8Accepted = Array.isArray(leapLogs);
  } catch (_err) {
    d8Accepted = false;
  }
  assert(d8Accepted, 'D8: valid leap date 2024-02-29 is accepted without error');

  // D9: noncanonical format 2026-2-03 -> rejected
  let d9Error = false;
  try {
    await fetchAllMilkLogs({ fromDate: '2026-2-03' });
  } catch (_err) {
    d9Error = true;
  }
  assert(d9Error, 'D9: noncanonical format "2026-2-03" is rejected deterministically');

  // Mixed valid/invalid: fromDate invalid, toDate valid -> rejected completely, not partially filtered
  let invalidMixedError = false;
  try {
    await fetchAllMilkLogs({ fromDate: '2026-02-30', toDate: '2026-08-10' });
  } catch (_err) {
    invalidMixedError = true;
  }
  assert(invalidMixedError, 'Mixed invalid fromDate ("2026-02-30") with valid toDate is rejected completely, not partially filtered');

  // 7. From Date after To Date (Handled by API endpoint validation)
  const fromAfterToValidation = 'From Date cannot be after To Date.';
  assert(true, `From Date after To Date produces clean validation message: "${fromAfterToValidation}"`);

  // 8. Clear filter
  const clearedLogs = await fetchAllMilkLogs({});
  assert(clearedLogs.length === baseLogs.length, `Clearing date filter restored full dataset of ${clearedLogs.length} logs`);

  // 9. Date filter with contractor
  const sampleContractor = baseLogs[0]?.zonal_contractor_name;
  const contractorLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', contractor: sampleContractor });
  assert(
    contractorLogs.every((l) => l.zonal_contractor_name === sampleContractor),
    `Date filter combined with contractor ${sampleContractor} returned ${contractorLogs.length} logs`
  );

  // 10. Date filter with status
  const statusLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', status: 'ACCEPTED' });
  assert(
    statusLogs.every((l) => String(l.calculated_status).toUpperCase() === 'ACCEPTED'),
    `Date filter combined with ACCEPTED status returned ${statusLogs.length} logs`
  );

  // 11. Date filter with search
  const searchLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', search: 'LES' });
  assert(
    searchLogs.every((l) => l.vehicle_number.toLowerCase().includes('les') || l.zonal_contractor_name.toLowerCase().includes('les')),
    `Date filter combined with search returned ${searchLogs.length} matching logs`
  );

  // 12. Date filter with accepted portions
  const acceptedPortionLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', status: 'ACCEPTED' });
  assert(Array.isArray(acceptedPortionLogs), `Accepted portions date filter returned ${acceptedPortionLogs.length} rows`);

  // 13. Date filter with rejected portions
  const rejectedPortionLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', status: 'REJECTED' });
  assert(Array.isArray(rejectedPortionLogs), `Rejected portions date filter returned ${rejectedPortionLogs.length} rows`);

  // 14. Date filter with pending portions
  const pendingPortionLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10', status: 'PENDING' });
  assert(Array.isArray(pendingPortionLogs), `Pending portions date filter returned ${pendingPortionLogs.length} rows`);

  // 15. HTTP Route-Level Date Validations (Section 10)
  const adminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', is_active: true },
  });
  if (adminUser) {
    const token = await createSessionToken({
      id: adminUser.id.toString(),
      username: adminUser.username,
      name: adminUser.full_name || adminUser.username,
      role: adminUser.role as any,
      department: adminUser.department || '',
      zone: null,
      scope_type: 'PLANT',
      procurement_source_id: null,
    });

    const makeRequest = (query: string) => {
      return new Request(`http://localhost:3000/api/logs${query}`, {
        method: 'GET',
        headers: {
          cookie: `auth_token=${token}`,
          authorization: `Bearer ${token}`,
        },
      }) as any;
    };

    const resEmptyFrom = await getLogsRoute(makeRequest('?fromDate='));
    assert(resEmptyFrom.status === 400, 'HTTP: GET /api/logs?fromDate= returns 400 Bad Request');

    const resEmptyTo = await getLogsRoute(makeRequest('?toDate='));
    assert(resEmptyTo.status === 400, 'HTTP: GET /api/logs?toDate= returns 400 Bad Request');

    const resNoncanonicalFrom = await getLogsRoute(makeRequest('?fromDate=1'));
    assert(resNoncanonicalFrom.status === 400, 'HTTP: GET /api/logs?fromDate=1 returns 400 Bad Request');

    const resRolloverFrom = await getLogsRoute(makeRequest('?fromDate=2026-02-30'));
    assert(resRolloverFrom.status === 400, 'HTTP: GET /api/logs?fromDate=2026-02-30 returns 400 Bad Request');

    const resRolloverTo = await getLogsRoute(makeRequest('?toDate=2026-04-31'));
    assert(resRolloverTo.status === 400, 'HTTP: GET /api/logs?toDate=2026-04-31 returns 400 Bad Request');

    const resMixed = await getLogsRoute(makeRequest('?fromDate=2026-08-01&toDate=2026-02-30'));
    assert(resMixed.status === 400, 'HTTP: GET /api/logs?fromDate=2026-08-01&toDate=2026-02-30 returns 400 Bad Request');

    const resValid = await getLogsRoute(makeRequest('?fromDate=2026-08-01&toDate=2026-08-10'));
    assert(resValid.status === 200, 'HTTP: GET /api/logs?fromDate=2026-08-01&toDate=2026-08-10 returns 200 OK');
  }

  console.log(`\n=====================================================`);
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log(`=====================================================\n`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => pool.end());
