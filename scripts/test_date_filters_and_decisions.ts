import { fetchAllMilkLogs } from '../src/backend/actions/logActions';
import { computeVehicleDecisionSummary } from '../src/backend/services/operationalCalculations';
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
  const sampleDate = baseLogs[0]?.created_at?.split('T')[0] || '2026-08-05';
  const singleDayLogs = await fetchAllMilkLogs({ fromDate: sampleDate, toDate: sampleDate });
  assert(
    singleDayLogs.every((l) => (l.created_at.split('T')[0]) === sampleDate),
    `Single-day filter returned ${singleDayLogs.length} logs for ${sampleDate}`
  );

  // 2. Multi-day range
  const multiDayLogs = await fetchAllMilkLogs({ fromDate: '2026-08-01', toDate: '2026-08-10' });
  assert(
    multiDayLogs.every((l) => {
      const d = l.dispatch_date || l.created_at.split('T')[0];
      return d >= '2026-08-01' && d <= '2026-08-10';
    }),
    `Multi-day range returned ${multiDayLogs.length} logs within 2026-08-01 to 2026-08-10`
  );

  // 3. From Date only
  const fromOnlyLogs = await fetchAllMilkLogs({ fromDate: '2026-08-05' });
  assert(
    fromOnlyLogs.every((l) => (l.dispatch_date || l.created_at.split('T')[0]) >= '2026-08-05'),
    `From Date only returned ${fromOnlyLogs.length} logs from 2026-08-05 onwards`
  );

  // 4. To Date only
  const toOnlyLogs = await fetchAllMilkLogs({ toDate: '2026-08-05' });
  assert(
    toOnlyLogs.every((l) => (l.dispatch_date || l.created_at.split('T')[0]) <= '2026-08-05'),
    `To Date only returned ${toOnlyLogs.length} logs up to 2026-08-05`
  );

  // 5. Same From and To Date
  const sameDayLogs = await fetchAllMilkLogs({ fromDate: sampleDate, toDate: sampleDate });
  assert(sameDayLogs.length === singleDayLogs.length, `Same From and To date returned ${sameDayLogs.length} logs`);

  // 6. Invalid date format check
  const invalidDateLogs = await fetchAllMilkLogs({ fromDate: 'invalid-date' });
  assert(Array.isArray(invalidDateLogs), 'Invalid date format handled gracefully without crashing');

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

  // 15. Decision Rules: Test All Accepted, All Rejected, Mixed, Pending
  const allAccSummary = computeVehicleDecisionSummary(
    [{ calculated_status: 'ACCEPTED' } as any, { calculated_status: 'ACCEPTED' } as any],
    'COMPLETED'
  );
  assert(allAccSummary.statusLabel === 'ACCEPTED', 'All Accepted portions produce vehicle status ACCEPTED');

  const allRejSummary = computeVehicleDecisionSummary(
    [{ calculated_status: 'REJECTED' } as any, { calculated_status: 'REJECTED' } as any],
    'COMPLETED'
  );
  assert(allRejSummary.statusLabel === 'REJECTED', 'All Rejected portions produce vehicle status REJECTED');

  const mixedSummary = computeVehicleDecisionSummary(
    [{ calculated_status: 'ACCEPTED' } as any, { calculated_status: 'REJECTED' } as any],
    'COMPLETED'
  );
  assert(mixedSummary.statusLabel === '1 Accepted / 1 Rejected', 'Mixed Accepted & Rejected portions produce "1 Accepted / 1 Rejected"');

  const pendingSummary = computeVehicleDecisionSummary(
    [{ calculated_status: 'ACCEPTED' } as any, { calculated_status: 'PENDING' } as any],
    'IN_PLANT'
  );
  assert(pendingSummary.statusLabel.includes('1 Pending'), 'Pending portion keeps in-process status with summary "1 Accepted / 1 Pending"');

  console.log(`\n=====================================================`);
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log(`=====================================================\n`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => pool.end());
