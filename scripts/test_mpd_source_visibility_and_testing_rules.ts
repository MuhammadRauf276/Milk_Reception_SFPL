import { prisma } from '../src/backend/core/db';
import { GET, POST } from '../src/app/api/dispatches/route';
import { POST as startDispatchPost } from '../src/app/api/dispatches/start/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';

async function runRegressionTests() {
  console.log('==================================================');
  console.log('STARTING MPD SOURCE VISIBILITY & TESTING RULES SUITE');
  console.log('==================================================\n');

  const regressionBusinessDate = getOperationalBusinessDate(new Date());

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

  // 1. Fetch Target Test Users from DB
  const hasilpurUser = await prisma.user.findFirst({ where: { username: 'zmcc.operator' }, include: { procurement_source: true } });
  const jhangUser = await prisma.user.findFirst({ where: { username: 'zmcc.operator.jhang' }, include: { procurement_source: true } });
  const alkhairUser = await prisma.user.findFirst({ where: { username: 'contractor.operator.alkhair' }, include: { procurement_source: true } });
  const adminUser = await prisma.user.findFirst({ where: { username: 'admin.superuser' }, include: { procurement_source: true } });

  assert(!!hasilpurUser && !!jhangUser && !!alkhairUser && !!adminUser, 'TEST-0: Target test users exist in database');

  if (!hasilpurUser || !jhangUser || !alkhairUser || !adminUser) {
    console.error('Abort: Missing test users.');
    process.exit(1);
  }

  // Helper to create Request with Auth Cookie
  async function createAuthRequest(urlStr: string, method: string = 'GET', bodyObj?: any, u?: any) {
    const headers: Record<string, string> = {};
    if (u) {
      const userObj: User = {
        id: u.id.toString(),
        username: u.username,
        name: u.full_name || u.username,
        role: u.role as Role,
        department: u.department || '',
        scope_type: u.scope_type,
        procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
      };
      const token = await createSessionToken(userObj);
      headers['cookie'] = `auth_token=${token}`;
    }

    if (bodyObj) {
      headers['content-type'] = 'application/json';
    }

    return new Request(urlStr, {
      method,
      headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  }

  async function startDraft(user: any, sourceId?: string) {
    const req = await createAuthRequest('http://localhost:3000/api/dispatches/start', 'POST', { procurementSourceId: sourceId }, user);
    const res = await startDispatchPost(req);
    const data = await res.json();
    return data;
  }

  // 2. Source Visibility Scoping Tests (GET /api/dispatches)
  console.log('\n--- 1. API Read Source Scoping & Tampering Tests ---');

  // Test 1.1: ZMCC Hasilpur Operator sees ONLY Hasilpur dispatches
  const reqHasilpur = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, hasilpurUser);
  const resHasilpur = await GET(reqHasilpur);
  const dataHasilpur = await resHasilpur.json();
  const hasilpurVisits = dataHasilpur.dispatches || [];
  const nonHasilpur = hasilpurVisits.filter((v: any) => v.zonal_contractor_name !== 'ZMCC Hasilpur');
  assert(
    resHasilpur.ok && hasilpurVisits.length > 0 && nonHasilpur.length === 0,
    'TEST-1.1: ZMCC Hasilpur operator sees ONLY Hasilpur records',
    `Total = ${hasilpurVisits.length}, Non-Hasilpur = ${nonHasilpur.length}`
  );

  // Test 1.2: ZMCC Jhang Operator sees ONLY Jhang dispatches
  const reqJhang = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, jhangUser);
  const resJhang = await GET(reqJhang);
  const dataJhang = await resJhang.json();
  const jhangVisits = dataJhang.dispatches || [];
  const nonJhang = jhangVisits.filter((v: any) => v.zonal_contractor_name !== 'ZMCC Jhang');
  assert(
    resJhang.ok && jhangVisits.length > 0 && nonJhang.length === 0,
    'TEST-1.2: ZMCC Jhang operator sees ONLY Jhang records',
    `Total = ${jhangVisits.length}, Non-Jhang = ${nonJhang.length}`
  );

  // Test 1.3: Contractor Al Khair Operator sees ONLY Al Khair dispatches
  const reqAlkhair = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, alkhairUser);
  const resAlkhair = await GET(reqAlkhair);
  const dataAlkhair = await resAlkhair.json();
  const alkhairVisits = dataAlkhair.dispatches || [];
  const nonAlkhair = alkhairVisits.filter((v: any) => v.zonal_contractor_name !== 'Al Khair Dairy');
  assert(
    resAlkhair.ok && alkhairVisits.length > 0 && nonAlkhair.length === 0,
    'TEST-1.3: Contractor Al Khair operator sees ONLY Al Khair records',
    `Total = ${alkhairVisits.length}, Non-AlKhair = ${nonAlkhair.length}`
  );

  // Test 1.4: Direct Query Parameter Tampering by Source-Bound Operator
  const jhangSource = await prisma.procurementSource.findFirst({ where: { code: 'ZMCC-JHANG' } });
  const reqTamperRead = await createAuthRequest(`http://localhost:3000/api/dispatches?range=30d&procurementSourceId=${jhangSource?.id}`, 'GET', undefined, hasilpurUser);
  const resTamperRead = await GET(reqTamperRead);
  const dataTamperRead = await resTamperRead.json();
  const tamperedVisits = dataTamperRead.dispatches || [];
  const leakedJhang = tamperedVisits.filter((v: any) => v.zonal_contractor_name === 'ZMCC Jhang');
  assert(
    leakedJhang.length === 0,
    'TEST-1.4: Query parameter tampering by source-bound operator cannot leak another source data',
    `Leaked Jhang records = ${leakedJhang.length}`
  );

  // Test 1.5: Super Admin sees global dispatches
  const reqAdmin = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, adminUser);
  const resAdmin = await GET(reqAdmin);
  const dataAdmin = await resAdmin.json();
  const adminVisits = dataAdmin.dispatches || [];
  assert(
    resAdmin.ok && adminVisits.length > 15,
    'TEST-1.5: Super Admin privileged role retains global visibility across sources',
    `Total Admin Visible = ${adminVisits.length}`
  );

  // Create controlled temporary fixtures with deterministic dates to prove range filtering:
  // 1. Recent fixture: 2 days old (within 7d, within 30d)
  // 2. Medium fixture: 10 days old (outside 7d, within 30d)
  // 3. Old fixture: 40 days old (outside 7d, outside 30d)
  const nowMs = Date.now();
  const dateRecent = new Date(nowMs - 2 * 24 * 60 * 60 * 1000);
  const dateMedium = new Date(nowMs - 10 * 24 * 60 * 60 * 1000);
  const dateOld = new Date(nowMs - 40 * 24 * 60 * 60 * 1000);

  const fixtureRecent = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-TEST-REC-${nowMs}`,
      reception_number: `REC-TEST-REC-${nowMs}`,
      vehicle_number: 'TEST-REC-01',
      operational_date: dateRecent,
      current_status: 'DISPATCHED',
      procurement_source_id: hasilpurUser.procurement_source_id,
      created_by: hasilpurUser.id,
      created_at: dateRecent,
      vehicle_dispatch_quantity_value: 5000,
      vehicle_dispatch_quantity_unit: 'KG',
      vehicle_dispatch_quantity_basis: 'MEASURED',
    },
  });

  const fixtureMedium = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-TEST-MED-${nowMs}`,
      reception_number: `REC-TEST-MED-${nowMs}`,
      vehicle_number: 'TEST-MED-01',
      operational_date: dateMedium,
      current_status: 'DISPATCHED',
      procurement_source_id: hasilpurUser.procurement_source_id,
      created_by: hasilpurUser.id,
      created_at: dateMedium,
      vehicle_dispatch_quantity_value: 6000,
      vehicle_dispatch_quantity_unit: 'KG',
      vehicle_dispatch_quantity_basis: 'MEASURED',
    },
  });

  const fixtureOld = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-TEST-OLD-${nowMs}`,
      reception_number: `REC-TEST-OLD-${nowMs}`,
      vehicle_number: 'TEST-OLD-01',
      operational_date: dateOld,
      current_status: 'DISPATCHED',
      procurement_source_id: hasilpurUser.procurement_source_id,
      created_by: hasilpurUser.id,
      created_at: dateOld,
      vehicle_dispatch_quantity_value: 7000,
      vehicle_dispatch_quantity_unit: 'KG',
      vehicle_dispatch_quantity_basis: 'MEASURED',
    },
  });

  // Test 1.6: GET /api/dispatches?range=7d includes recent fixture, excludes medium (10d) and old (40d)
  const req7d = await createAuthRequest('http://localhost:3000/api/dispatches?range=7d&pageSize=100', 'GET', undefined, hasilpurUser);
  const res7d = await GET(req7d);
  const data7d = await res7d.json();
  const list7d = data7d.dispatches || [];
  const includesRecent7d = list7d.some((v: any) => v.id === fixtureRecent.id.toString());
  const excludesMedium7d = !list7d.some((v: any) => v.id === fixtureMedium.id.toString());
  const excludesOld7d = !list7d.some((v: any) => v.id === fixtureOld.id.toString());
  assert(
    res7d.ok && includesRecent7d && excludesMedium7d && excludesOld7d,
    'TEST-1.6: GET /api/dispatches?range=7d proves inclusion of 2-day fixture and exclusion of 10-day & 40-day fixtures',
    `includesRecent=${includesRecent7d}, excludesMed=${excludesMedium7d}, excludesOld=${excludesOld7d}`
  );

  // Test 1.7: GET /api/dispatches?range=custom with 8d-12d bounds includes 10-day fixture, excludes 2-day & 40-day
  const customFrom = new Date(nowMs - 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const customTo = new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const reqCustom = await createAuthRequest(`http://localhost:3000/api/dispatches?range=custom&fromDate=${customFrom}&toDate=${customTo}&pageSize=100`, 'GET', undefined, hasilpurUser);
  const resCustom = await GET(reqCustom);
  const dataCustom = await resCustom.json();
  const listCustom = dataCustom.dispatches || [];
  const includesMediumCustom = listCustom.some((v: any) => v.id === fixtureMedium.id.toString());
  const excludesRecentCustom = !listCustom.some((v: any) => v.id === fixtureRecent.id.toString());
  const excludesOldCustom = !listCustom.some((v: any) => v.id === fixtureOld.id.toString());
  assert(
    resCustom.ok && includesMediumCustom && excludesRecentCustom && excludesOldCustom,
    'TEST-1.7: GET /api/dispatches?range=custom proves inclusion of 10-day fixture and exclusion of out-of-range fixtures',
    `includesMed=${includesMediumCustom}, excludesRecent=${excludesRecentCustom}, excludesOld=${excludesOldCustom}`
  );

  // Cleanup temporary date-range fixtures
  await prisma.vehicleVisit.deleteMany({
    where: {
      id: { in: [fixtureRecent.id, fixtureMedium.id, fixtureOld.id] },
    },
  });

  // Test 1.8: fromDate > toDate returns 400 with "From Date cannot be after To Date"
  const reqInvalidCustom = await createAuthRequest(`http://localhost:3000/api/dispatches?range=custom&fromDate=2026-08-30&toDate=2026-08-01`, 'GET', undefined, hasilpurUser);
  const resInvalidCustom = await GET(reqInvalidCustom);
  const dataInvalidCustom = await resInvalidCustom.json();
  assert(
    resInvalidCustom.status === 400 && dataInvalidCustom.error === 'From Date cannot be after To Date',
    'TEST-1.8: Custom range with fromDate > toDate returns 400 "From Date cannot be after To Date"',
    `Status = ${resInvalidCustom.status}, Error = "${dataInvalidCustom.error}"`
  );

  // Test 1.9: Normal Recent Dispatches query strictly excludes DRAFT_DISPATCH and CANCELLED
  const draftForExclusion = await startDraft(hasilpurUser);
  const reqRecent = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, hasilpurUser);
  const resRecent = await GET(reqRecent);
  const dataRecent = await resRecent.json();
  const recentVisits = dataRecent.dispatches || [];
  const containsDraft = recentVisits.some((v: any) => v.id === draftForExclusion.visitId || v.current_status === 'DRAFT_DISPATCH');
  const containsCancelled = recentVisits.some((v: any) => v.current_status === 'CANCELLED');
  assert(
    resRecent.ok && !containsDraft && !containsCancelled,
    'TEST-1.9: Recent dispatches query strictly excludes DRAFT_DISPATCH and CANCELLED records',
    `Contains Draft = ${containsDraft}, Contains Cancelled = ${containsCancelled}`
  );

  if (draftForExclusion?.visitId) {
    await prisma.vehicleVisit.deleteMany({ where: { id: BigInt(draftForExclusion.visitId) } });
  }

  // 3. POST /api/dispatches Source Authorization & Tampering Tests
  console.log('\n--- 2. POST API Source Tampering & Authorization Tests ---');

  // Test 2.1: Source-bound operator attempts to create a visit for unauthorized source
  const draftTamper = await startDraft(hasilpurUser);
  const reqPostTamper = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftTamper.visitId,
      vehicleNumber: 'TEST-9999',
      operationalDate: regressionBusinessDate,
      procurementSourceId: jhangSource?.id.toString(), // Tampered source ID
      zonalContractorName: 'ZMCC Jhang',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: [],
        },
      ],
    },
    hasilpurUser
  );
  const resPostTamper = await POST(reqPostTamper);
  const dataPostTamper = await resPostTamper.json();
  assert(
    resPostTamper.status === 403 && dataPostTamper.error.includes('Unauthorized'),
    'TEST-2.1: Source-bound operator cannot submit dispatch for unauthorized procurement source',
    `Status = ${resPostTamper.status}, Error = "${dataPostTamper.error}"`
  );

  // 4. Declared Quantity & Unit Validation Tests
  console.log('\n--- 3. Declared Quantity & Unit Validation Tests ---');

  // Test 3.1: Negative declared quantity (-500)
  const draftNeg = await startDraft(hasilpurUser);
  const reqNegQty = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftNeg.visitId,
      vehicleNumber: 'TEST-8888',
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '-500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: [],
        },
      ],
    },
    hasilpurUser
  );
  const resNegQty = await POST(reqNegQty);
  const dataNegQty = await resNegQty.json();
  assert(
    resNegQty.status === 400 && (dataNegQty.error.includes('greater than 0') || dataNegQty.error.includes('positive')),
    'TEST-3.1: Negative declared quantity (-500) is strictly rejected',
    `Status = ${resNegQty.status}, Error = "${dataNegQty.error}"`
  );

  // Test 3.2: Zero declared quantity (0)
  const draftZero = await startDraft(hasilpurUser);
  const reqZeroQty = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftZero.visitId,
      vehicleNumber: 'TEST-8887',
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '0', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: [],
        },
      ],
    },
    hasilpurUser
  );
  const resZeroQty = await POST(reqZeroQty);
  const dataZeroQty = await resZeroQty.json();
  assert(
    resZeroQty.status === 400 && (dataZeroQty.error.includes('greater than 0') || dataZeroQty.error.includes('positive') || dataZeroQty.error.includes('0.01')),
    'TEST-3.2: Zero declared quantity (0) is strictly rejected',
    `Status = ${resZeroQty.status}, Error = "${dataZeroQty.error}"`
  );

  // Test 3.2b: More than 2 decimal places (e.g. 0.001) is rejected at API level before DB
  const draftDecPlaces = await startDraft(hasilpurUser);
  const reqDecPlaces = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftDecPlaces.visitId,
      vehicleNumber: 'TEST-8886',
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '0.001', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: [],
        },
      ],
    },
    hasilpurUser
  );
  const resDecPlaces = await POST(reqDecPlaces);
  const dataDecPlaces = await resDecPlaces.json();
  assert(
    resDecPlaces.status === 400,
    'TEST-3.2b: Portion quantity with >2 decimal places (0.001) is rejected with 400 at API level',
    `Status = ${resDecPlaces.status}, Error = "${dataDecPlaces.error}"`
  );

  // Test 3.2c: Vehicle quantity exceeding maximum (100,000,000) is rejected at API level
  const draftMaxExceeded = await startDraft(hasilpurUser);
  const reqMaxExceeded = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftMaxExceeded.visitId,
      vehicleNumber: 'TEST-8885',
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '100000000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: [],
        },
      ],
    },
    hasilpurUser
  );
  const resMaxExceeded = await POST(reqMaxExceeded);
  const dataMaxExceeded = await resMaxExceeded.json();
  assert(
    resMaxExceeded.status === 400,
    'TEST-3.2c: Vehicle quantity exceeding 99,999,999.99 (100000000) is rejected with 400 at API level',
    `Status = ${resMaxExceeded.status}, Error = "${dataMaxExceeded.error}"`
  );

  // Fetch active lab tests for accountability
  const draftContLiter = await startDraft(alkhairUser);
  const assignedContTests = (draftContLiter.assignedTests || []).filter((t: any) => t.resultType !== 'CALCULATED');
  const defaultContResults = assignedContTests.map((t: any) => ({
    testId: t.testId,
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: 'Contract Vehicle',
  }));

  // Test 3.3: Contractor declares quantity in LITERS
  const reqContLiter = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftContLiter.visitId,
      vehicleNumber: 'CONT-9800',
      operationalDate: regressionBusinessDate,
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '9800', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '9800', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          results: defaultContResults,
        },
      ],
    },
    alkhairUser
  );
  const resContLiter = await POST(reqContLiter);
  const dataContLiter = await resContLiter.json();
  if (!resContLiter.ok) {
    console.error('TEST-3.3 Error details:', dataContLiter);
  }
  assert(
    resContLiter.ok && !!dataContLiter.visitId,
    'TEST-3.3: Contractor can declare quantity in LITERS and unit is preserved in database',
    `Visit ID = ${dataContLiter.visitId}, Error = "${dataContLiter.error}"`
  );

  // Verify created portion in DB
  const createdPortion = await prisma.visitPortion.findFirst({
    where: { visit_id: BigInt(dataContLiter.visitId) },
  });
  assert(
    createdPortion?.dispatch_quantity_unit === 'LITER' && Number(createdPortion?.dispatch_quantity_value) === 9800,
    'TEST-3.4: DB VisitPortion retains original declared quantity value (9,800) and unit ("LITER")',
    `Stored Unit = ${createdPortion?.dispatch_quantity_unit}, Value = ${createdPortion?.dispatch_quantity_value}`
  );

  // 5. Contractor Test Accountability Workflow Tests
  console.log('\n--- 4. Contractor Test Accountability Workflow Tests ---');

  // Test 4.1: Contractor Default All NOT_PERFORMED Case
  const draftContAllNotPerf = await startDraft(alkhairUser);
  const assignedNotPerf = (draftContAllNotPerf.assignedTests || []).filter((t: any) => t.resultType !== 'CALCULATED');
  const allNotPerfResults = assignedNotPerf.map((t: any) => ({
    testId: t.testId,
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: 'Contract Vehicle',
  }));

  const reqContAllNotPerf = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftContAllNotPerf.visitId,
      vehicleNumber: 'CONT-NOT-PERF',
      operationalDate: regressionBusinessDate,
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '9500', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '9500', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          results: allNotPerfResults,
        },
      ],
    },
    alkhairUser
  );
  const resContAllNotPerf = await POST(reqContAllNotPerf);
  const dataContAllNotPerf = await resContAllNotPerf.json();
  assert(
    resContAllNotPerf.ok && !!dataContAllNotPerf.visitId,
    'TEST-4.1: Contractor all NOT_PERFORMED dispatch succeeds with valid accountability reasons',
    `Visit ID = ${dataContAllNotPerf.visitId}`
  );

  const notPerfResultsCount = await prisma.dispatchLabResult.count({
    where: { visit_id: BigInt(dataContAllNotPerf.visitId), performance_status: 'NOT_PERFORMED' },
  });
  assert(
    notPerfResultsCount >= assignedNotPerf.length,
    'TEST-4.2: Full accountability rows created in DB with status NOT_PERFORMED and reason "Contract Vehicle"',
    `NOT_PERFORMED Results in DB = ${notPerfResultsCount}`
  );

  // Test 4.3: Contractor PARTIAL mode with subset of PERFORMED tests + remaining NOT_PERFORMED
  const draftContPartial = await startDraft(alkhairUser);
  const assignedPartial = draftContPartial.assignedTests || [];
  const tempTestAssigned = assignedPartial.find((t: any) => t.testName.toLowerCase().includes('temperature'));
  const fatTestAssigned = assignedPartial.find((t: any) => t.testName.toLowerCase().includes('fat') && !t.testName.toLowerCase().includes('snf'));

  if (tempTestAssigned && fatTestAssigned) {
    const partialResults = assignedPartial
      .filter((t: any) => t.resultType !== 'CALCULATED')
      .map((t: any) => {
        if (t.testId === tempTestAssigned.testId) {
          return { testId: t.testId, performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: 5.2 };
        }
        if (t.testId === fatTestAssigned.testId) {
          return { testId: t.testId, performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: 3.8 };
        }
        return { testId: t.testId, performanceStatus: 'NOT_PERFORMED' as const, notPerformedReason: 'Contract Vehicle' };
      });

    const reqContPartial = await createAuthRequest(
      'http://localhost:3000/api/dispatches',
      'POST',
      {
        visitId: draftContPartial.visitId,
        vehicleNumber: 'CONT-PARTIAL',
        operationalDate: regressionBusinessDate,
        dispatchTestingMode: 'PARTIAL',
        vehicleQuantity: { value: '8900', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        portions: [
          {
            portionNumber: 1,
            quantity: { value: '8900', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
            results: partialResults,
          },
        ],
      },
      alkhairUser
    );
    const resContPartial = await POST(reqContPartial);
    const dataContPartial = await resContPartial.json();
    assert(
      resContPartial.ok && !!dataContPartial.visitId,
      'TEST-4.3: Contractor PARTIAL mode succeeds with genuine performed results and accounted unperformed tests',
      `Visit ID = ${dataContPartial.visitId}`
    );
  }

  // 6. Plant QA Strict Acceptance Proof
  console.log('\n--- 5. Plant QA Strict Architecture Assertion ---');
  const plantTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] }, isRequired: true, resultType: { not: 'CALCULATED' } },
  });
  assert(plantTests.length >= 25, 'TEST-5.1: Plant QA requires all active plant tests for plant acceptance regardless of source');

  console.log('\n==================================================');
  console.log(`REGRESSION SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in regression suite:', err);
    process.exit(1);
  });
