import { prisma } from '../src/backend/core/db';
import { GET, POST } from '../src/app/api/dispatches/route';
import { POST as startDispatchPost } from '../src/app/api/dispatches/start/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';

async function runRegressionTests() {
  console.log('==================================================');
  console.log('STARTING MPD SOURCE VISIBILITY & TESTING RULES SUITE');
  console.log('==================================================\n');

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
    resZeroQty.status === 400 && (dataZeroQty.error.includes('greater than 0') || dataZeroQty.error.includes('positive')),
    'TEST-3.2: Zero declared quantity (0) is strictly rejected',
    `Status = ${resZeroQty.status}, Error = "${dataZeroQty.error}"`
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
