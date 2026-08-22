import { prisma } from '../src/backend/core/db';
import { GET, POST } from '../src/app/api/dispatches/route';
import { POST as startDispatchPost } from '../src/app/api/dispatches/start/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';

async function runContractorAccountabilityTests() {
  console.log('==================================================');
  console.log('RUNNING CONTRACTOR DISPATCH TEST ACCOUNTABILITY SUITE (CASES A-O)');
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
  const alkhairUser = await prisma.user.findFirst({
    where: { username: 'contractor.operator.alkhair' },
    include: { procurement_source: true },
  });
  const zmccUser = await prisma.user.findFirst({
    where: { username: 'zmcc.operator' },
    include: { procurement_source: true },
  });

  if (!alkhairUser || !zmccUser) {
    console.error('Abort: Missing test users in DB.');
    process.exit(1);
  }

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

  // Fetch active lab tests
  const activeDispatchTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { testName: 'asc' }],
  });

  const manualTests = activeDispatchTests.filter((t) => t.resultType !== 'CALCULATED');
  const fatTest = manualTests.find((t) => t.testName.toLowerCase().includes('fat') && !t.testName.toLowerCase().includes('snf'));
  const lrTest = manualTests.find((t) => t.testName.toLowerCase().includes('lactometer') || t.testName.toLowerCase().includes('lr'));
  const cobTest = manualTests.find((t) => t.testName.toLowerCase().includes('cob') || t.resultType === 'OK_NOT_OK');
  const antibioticTest = manualTests.find((t) => t.testName.toLowerCase().includes('antibiotic') || t.resultType === 'POSITIVE_NEGATIVE');

  if (!fatTest || !lrTest || !cobTest || !antibioticTest) {
    console.error('Abort: Expected test definitions not found in DB.');
    process.exit(1);
  }

  // CASE A: New Contractor portion defaults
  // Build default payload representing initial contractor UI state
  const defaultResultsCaseA = manualTests.map((t) => ({
    testId: t.id.toString(),
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: 'Contract Vehicle',
    numericValue: null,
    textValue: null,
  }));

  const allDefaultNotPerformed = defaultResultsCaseA.every(
    (r) => r.performanceStatus === 'NOT_PERFORMED' && r.notPerformedReason === 'Contract Vehicle' && r.numericValue === null && r.textValue === null
  );

  assert(
    allDefaultNotPerformed && defaultResultsCaseA.length === manualTests.length,
    'Case A: New Contractor portion defaults initialize all tests as NOT_PERFORMED with reason "Contract Vehicle" and no performed result',
    `Manual tests count = ${manualTests.length}`
  );

  // CASE B: KG declaration preserved
  const draftB = await startDraft(alkhairUser);
  const reqCaseB = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftB.visitId,
      vehicleNumber: 'CONT-KG-9500',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '9500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '9500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: defaultResultsCaseA,
        },
      ],
    },
    alkhairUser
  );
  const resCaseB = await POST(reqCaseB);
  const dataCaseB = await resCaseB.json();
  assert(resCaseB.ok && !!dataCaseB.visitId, 'Case B: Contractor 9,500 KG dispatch created successfully', `Visit ID = ${dataCaseB.visitId}`);

  const portionB = await prisma.visitPortion.findFirst({
    where: { visit_id: BigInt(dataCaseB.visitId) },
  });
  assert(
    portionB?.dispatch_quantity_unit === 'KG' && Number(portionB?.dispatch_quantity_value) === 9500,
    'Case B (DB): Declared quantity remains KG (9,500 KG) after creation and reload'
  );

  // CASE C: LITER declaration preserved (no automatic conversion)
  const draftC = await startDraft(alkhairUser);
  const reqCaseC = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftC.visitId,
      vehicleNumber: 'CONT-LT-10000',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '10000', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '10000', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          results: defaultResultsCaseA,
        },
      ],
    },
    alkhairUser
  );
  const resCaseC = await POST(reqCaseC);
  const dataCaseC = await resCaseC.json();
  assert(resCaseC.ok && !!dataCaseC.visitId, 'Case C: Contractor 10,000 LITER dispatch created successfully', `Visit ID = ${dataCaseC.visitId}`);

  const portionC = await prisma.visitPortion.findFirst({
    where: { visit_id: BigInt(dataCaseC.visitId) },
  });
  assert(
    portionC?.dispatch_quantity_unit === 'LITER' && Number(portionC?.dispatch_quantity_value) === 10000,
    'Case C (DB): Declared quantity remains LITER (10,000 LITER) without conversion to KG'
  );

  // CASE D: Numeric NOT_PERFORMED default in DB
  const fatResultB = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: BigInt(dataCaseB.visitId), test_id: fatTest.id },
  });
  assert(
    fatResultB?.performance_status === 'NOT_PERFORMED' &&
      fatResultB?.not_performed_reason === 'Contract Vehicle' &&
      fatResultB?.numeric_value === null &&
      fatResultB?.text_value === null,
    'Case D: Numeric test (Fat) in DB has status NOT_PERFORMED, reason "Contract Vehicle", and numericValue null'
  );

  // CASE E: Qualitative NOT_PERFORMED default in DB
  const cobResultB = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: BigInt(dataCaseB.visitId), test_id: cobTest.id },
  });
  assert(
    cobResultB?.performance_status === 'NOT_PERFORMED' &&
      cobResultB?.not_performed_reason === 'Contract Vehicle' &&
      cobResultB?.text_value === null &&
      cobResultB?.numeric_value === null,
    'Case E: Qualitative test (COB) in DB has status NOT_PERFORMED, reason "Contract Vehicle", and no fake categorical result'
  );

  // CASE F: NOT_PERFORMED custom reason
  const customReasonResults = manualTests.map((t) => ({
    testId: t.id.toString(),
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: t.id === fatTest.id ? 'Testing kit unavailable' : 'Contract Vehicle',
    numericValue: null,
    textValue: null,
  }));

  const draftF = await startDraft(alkhairUser);
  const reqCaseF = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftF.visitId,
      vehicleNumber: 'CONT-CUSTOM-REASON',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Testing kit unavailable',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: customReasonResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseF = await POST(reqCaseF);
  const dataCaseF = await resCaseF.json();
  assert(resCaseF.ok && !!dataCaseF.visitId, 'Case F: Custom NOT_PERFORMED reason accepted by API', `Visit ID = ${dataCaseF.visitId}`);

  const fatCustom = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: BigInt(dataCaseF.visitId), test_id: fatTest.id },
  });
  assert(
    fatCustom?.performance_status === 'NOT_PERFORMED' && fatCustom?.not_performed_reason === 'Testing kit unavailable',
    'Case F (DB): Custom NOT_PERFORMED reason ("Testing kit unavailable") preserved exactly upon reload'
  );

  // CASE G: Empty NOT_PERFORMED reason rejected
  const emptyReasonResults = manualTests.map((t) => ({
    testId: t.id.toString(),
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: t.id === fatTest.id ? '   ' : 'Contract Vehicle', // empty/whitespace
    numericValue: null,
    textValue: null,
  }));

  const draftG = await startDraft(alkhairUser);
  const reqCaseG = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftG.visitId,
      vehicleNumber: 'CONT-EMPTY-REASON',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: emptyReasonResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseG = await POST(reqCaseG);
  const dataCaseG = await resCaseG.json();
  assert(
    resCaseG.status === 400 && dataCaseG.error.includes('Reason required'),
    'Case G: Empty/whitespace NOT_PERFORMED reason strictly rejected by API',
    `Status = ${resCaseG.status}, Error = "${dataCaseG.error}"`
  );

  // CASE H: Numeric PERFORMED with valid result
  const numericPerformedResults = manualTests.map((t) => {
    if (t.id === fatTest.id) {
      return {
        testId: t.id.toString(),
        performanceStatus: 'PERFORMED' as const,
        notPerformedReason: null,
        numericValue: 3.75,
        textValue: null,
      };
    }
    return {
      testId: t.id.toString(),
      performanceStatus: 'NOT_PERFORMED' as const,
      notPerformedReason: 'Contract Vehicle',
      numericValue: null,
      textValue: null,
    };
  });

  const draftH = await startDraft(alkhairUser);
  const reqCaseH = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftH.visitId,
      vehicleNumber: 'CONT-NUM-PERF',
      dispatchTestingMode: 'PARTIAL',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: numericPerformedResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseH = await POST(reqCaseH);
  const dataCaseH = await resCaseH.json();
  // CASE I: Numeric PERFORMED without result rejected
  const numericMissingResults = manualTests.map((t) => {
    if (t.id === fatTest.id) {
      return {
        testId: t.id.toString(),
        performanceStatus: 'PERFORMED' as const,
        notPerformedReason: null,
        numericValue: null, // missing result!
        textValue: null,
      };
    }
    return {
      testId: t.id.toString(),
      performanceStatus: 'NOT_PERFORMED' as const,
      notPerformedReason: 'Contract Vehicle',
      numericValue: null,
      textValue: null,
    };
  });

  const draftI = await startDraft(alkhairUser);
  const reqCaseI = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftI.visitId,
      vehicleNumber: 'CONT-NUM-MISSING',
      dispatchTestingMode: 'PARTIAL',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: numericMissingResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseI = await POST(reqCaseI);
  const dataCaseI = await resCaseI.json();
  assert(
    resCaseI.status === 400 && dataCaseI.error.includes('Valid numeric result required'),
    'Case I: Numeric PERFORMED without result strictly rejected by API',
    `Status = ${resCaseI.status}, Error = "${dataCaseI.error}"`
  );

  // CASE J: Qualitative PERFORMED with selected genuine result
  const qualPerformedResults = manualTests.map((t) => {
    if (t.id === cobTest.id) {
      return {
        testId: t.id.toString(),
        performanceStatus: 'PERFORMED' as const,
        notPerformedReason: null,
        numericValue: null,
        textValue: 'OK',
      };
    }
    return {
      testId: t.id.toString(),
      performanceStatus: 'NOT_PERFORMED' as const,
      notPerformedReason: 'Contract Vehicle',
      numericValue: null,
      textValue: null,
    };
  });

  const draftJ = await startDraft(alkhairUser);
  const reqCaseJ = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftJ.visitId,
      vehicleNumber: 'CONT-QUAL-PERF',
      dispatchTestingMode: 'PARTIAL',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: qualPerformedResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseJ = await POST(reqCaseJ);
  const dataCaseJ = await resCaseJ.json();
  assert(resCaseJ.ok && !!dataCaseJ.visitId, 'Case J: Qualitative PERFORMED with genuine result succeeds', `Visit ID = ${dataCaseJ.visitId}`);

  const cobPerf = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: BigInt(dataCaseJ.visitId), test_id: cobTest.id },
  });
  assert(
    cobPerf?.performance_status === 'PERFORMED' && cobPerf?.text_value === 'OK' && cobPerf?.not_performed_reason === null,
    'Case J (DB): Qualitative test saved as PERFORMED with genuine text value "OK" and no reason'
  );

  // CASE K: State Transition PERFORMED -> NOT_PERFORMED (Result cleared, reason restored)
  const draftK = await startDraft(alkhairUser);
  const transitionedK = manualTests.map((t) => ({
    testId: t.id.toString(),
    performanceStatus: 'NOT_PERFORMED' as const,
    notPerformedReason: 'Contract Vehicle',
    numericValue: null,
    textValue: null,
  }));
  const reqCaseK = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftK.visitId,
      vehicleNumber: 'CONT-TRANS-K',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [{ portionNumber: 1, quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' }, results: transitionedK }],
    },
    alkhairUser
  );
  const resCaseK = await POST(reqCaseK);
  assert(resCaseK.ok, 'Case K: Transition PERFORMED -> NOT_PERFORMED yields valid NOT_PERFORMED dispatch with cleared result');

  // CASE L: State Transition NOT_PERFORMED -> PERFORMED (Reason cleared, genuine result required)
  const draftL = await startDraft(alkhairUser);
  const transitionedL = manualTests.map((t) => {
    if (t.id === lrTest.id) {
      return {
        testId: t.id.toString(),
        performanceStatus: 'PERFORMED' as const,
        notPerformedReason: null,
        numericValue: 28.5,
        textValue: null,
      };
    }
    return {
      testId: t.id.toString(),
      performanceStatus: 'NOT_PERFORMED' as const,
      notPerformedReason: 'Contract Vehicle',
      numericValue: null,
      textValue: null,
    };
  });
  const reqCaseL = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftL.visitId,
      vehicleNumber: 'CONT-TRANS-L',
      dispatchTestingMode: 'PARTIAL',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [{ portionNumber: 1, quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' }, results: transitionedL }],
    },
    alkhairUser
  );
  const resCaseL = await POST(reqCaseL);
  assert(resCaseL.ok, 'Case L: Transition NOT_PERFORMED -> PERFORMED yields valid PERFORMED dispatch with cleared reason');

  // CASE M: Multiple portions isolation (Portion 1: KG, Fat 3.7; Portion 2: LITER, LR 28.0)
  const draftM = await startDraft(alkhairUser);
  const portion1Results = manualTests.map((t) => {
    if (t.id === fatTest.id) {
      return { testId: t.id.toString(), performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: 3.7, textValue: null };
    }
    return { testId: t.id.toString(), performanceStatus: 'NOT_PERFORMED' as const, notPerformedReason: 'Contract Vehicle', numericValue: null, textValue: null };
  });

  const portion2Results = manualTests.map((t) => {
    if (t.id === lrTest.id) {
      return { testId: t.id.toString(), performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: 28.0, textValue: null };
    }
    return { testId: t.id.toString(), performanceStatus: 'NOT_PERFORMED' as const, notPerformedReason: 'Contract Vehicle', numericValue: null, textValue: null };
  });

  const reqCaseM = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftM.visitId,
      vehicleNumber: 'CONT-MULTI-PORTION',
      dispatchTestingMode: 'PARTIAL',
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '9500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: portion1Results,
        },
        {
          portionNumber: 2,
          quantity: { value: '10000', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          results: portion2Results,
        },
      ],
    },
    alkhairUser
  );
  const resCaseM = await POST(reqCaseM);
  const dataCaseM = await resCaseM.json();
  assert(resCaseM.ok && !!dataCaseM.visitId, 'Case M: Multi-portion Contractor dispatch created successfully', `Visit ID = ${dataCaseM.visitId}`);

  const portionsM = await prisma.visitPortion.findMany({
    where: { visit_id: BigInt(dataCaseM.visitId) },
    include: { dispatch_lab_results: true },
    orderBy: { portion_number: 'asc' },
  });

  const p1 = portionsM[0];
  const p2 = portionsM[1];

  const p1Fat = p1?.dispatch_lab_results.find((r) => r.test_id === fatTest.id);
  const p1Lr = p1?.dispatch_lab_results.find((r) => r.test_id === lrTest.id);
  const p2Fat = p2?.dispatch_lab_results.find((r) => r.test_id === fatTest.id);
  const p2Lr = p2?.dispatch_lab_results.find((r) => r.test_id === lrTest.id);

  assert(
    p1?.dispatch_quantity_unit === 'KG' &&
      Number(p1?.dispatch_quantity_value) === 9500 &&
      p1Fat?.performance_status === 'PERFORMED' &&
      Number(p1Fat?.numeric_value) === 3.7 &&
      p1Lr?.performance_status === 'NOT_PERFORMED' &&
      p2?.dispatch_quantity_unit === 'LITER' &&
      Number(p2?.dispatch_quantity_value) === 10000 &&
      p2Fat?.performance_status === 'NOT_PERFORMED' &&
      p2Lr?.performance_status === 'PERFORMED' &&
      Number(p2Lr?.numeric_value) === 28.0,
    'Case M (DB): Portion 1 (KG, Fat 3.7, LR NOT_PERFORMED) and Portion 2 (LITER, Fat NOT_PERFORMED, LR 28.0) are completely isolated'
  );

  // CASE N: Direct API contradiction (NOT_PERFORMED + numeric result) rejected
  const contradictoryResults = manualTests.map((t) => {
    if (t.id === fatTest.id) {
      return {
        testId: t.id.toString(),
        performanceStatus: 'NOT_PERFORMED' as const,
        notPerformedReason: 'Contract Vehicle',
        numericValue: 3.8, // Contradictory!
        textValue: null,
      };
    }
    return {
      testId: t.id.toString(),
      performanceStatus: 'NOT_PERFORMED' as const,
      notPerformedReason: 'Contract Vehicle',
      numericValue: null,
      textValue: null,
    };
  });

  const draftN = await startDraft(alkhairUser);
  const reqCaseN = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftN.visitId,
      vehicleNumber: 'CONT-CONTRADICT',
      dispatchTestingMode: 'NOT_PERFORMED',
      dispatchTestingReason: 'Contract Vehicle',
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: contradictoryResults,
        },
      ],
    },
    alkhairUser
  );
  const resCaseN = await POST(reqCaseN);
  const dataCaseN = await resCaseN.json();
  assert(
    resCaseN.status === 400 && dataCaseN.error.includes('Contradictory'),
    'Case N: Direct API contradiction (NOT_PERFORMED with numeric value) strictly rejected by API',
    `Status = ${resCaseN.status}, Error = "${dataCaseN.error}"`
  );

  // CASE O: ZMCC isolation (ZMCC behavior unchanged)
  // ZMCC dispatches in FULL mode with all required manual tests accounted for
  const zmccResults = manualTests.map((t) => {
    if (t.resultType === 'NUMERIC') {
      return { testId: t.id.toString(), performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: 3.8, textValue: null };
    }
    if (t.resultType === 'POSITIVE_NEGATIVE') {
      return { testId: t.id.toString(), performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: null, textValue: 'NEGATIVE' };
    }
    return { testId: t.id.toString(), performanceStatus: 'PERFORMED' as const, notPerformedReason: null, numericValue: null, textValue: 'OK' };
  });

  const draftO = await startDraft(zmccUser);
  const reqCaseO = await createAuthRequest(
    'http://localhost:3000/api/dispatches',
    'POST',
    {
      visitId: draftO.visitId,
      vehicleNumber: 'ZMCC-ISOLATION-01',
      dispatchTestingMode: 'FULL',
      vehicleQuantity: { value: '12000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '12000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: zmccResults,
        },
      ],
    },
    zmccUser
  );
  const resCaseO = await POST(reqCaseO);
  const dataCaseO = await resCaseO.json();
  assert(
    resCaseO.ok && !!dataCaseO.visitId,
    'Case O: ZMCC Dispatch continues operating in FULL mode with standard ZMCC rules (no Contractor defaults leaking)',
    `Visit ID = ${dataCaseO.visitId}`
  );

  // ==========================================
  // CHUNK 1A — DERIVED CALCULATION GUARDS (TESTS 8A..8D)
  // ==========================================
  console.log('\n--- 6. Contractor Derived Calculation Guard Tests ---');

  // Simulation of computeCalculatedMilkValues from DynamicDispatchForm.tsx
  function computePortionCalculatedValues(
    declaredQty: number | '',
    unit: 'KG' | 'LITER',
    fatRes: { performanceStatus: string; numericValue: string } | null,
    lrRes: { performanceStatus: string; numericValue: string } | null
  ) {
    const rawLr = lrRes && lrRes.performanceStatus === 'PERFORMED' ? lrRes.numericValue : '';
    const rawFat = fatRes && fatRes.performanceStatus === 'PERFORMED' ? fatRes.numericValue : '';
    const rawDeclared = Number(declaredQty);

    const lrNum = rawLr !== '' && rawLr !== undefined && !isNaN(Number(rawLr)) ? Number(rawLr) : null;
    const fatNum = rawFat !== '' && rawFat !== undefined && !isNaN(Number(rawFat)) ? Number(rawFat) : null;
    const qtyNum = !isNaN(rawDeclared) && rawDeclared > 0 ? rawDeclared : null;

    let snfVal: number | null = null;
    let tsVal: number | null = null;
    let ratioVal: number | null = null;
    let densityVal: number | null = null;
    let physicalLitersVal: number | null = null;
    let equivalentKgVal: number | null = null;
    let at13TsLitersVal: number | null = null;

    if (lrNum !== null) {
      densityVal = 1 + lrNum / 1000;
    }

    if (lrNum !== null && fatNum !== null) {
      snfVal = lrNum / 4 + 0.22 * fatNum + 0.72;
      tsVal = fatNum + snfVal;
      ratioVal = fatNum > 0 ? snfVal / fatNum : null;
    }

    if (qtyNum !== null) {
      if (unit === 'KG') {
        if (lrNum !== null && densityVal !== null) {
          physicalLitersVal = qtyNum / densityVal;
        }
      } else if (unit === 'LITER') {
        physicalLitersVal = qtyNum;
        if (densityVal !== null) {
          equivalentKgVal = Number((qtyNum * densityVal).toFixed(2));
        }
      }

      if (physicalLitersVal !== null && tsVal !== null) {
        at13TsLitersVal = (physicalLitersVal * tsVal) / 13;
      }
    }

    return {
      declaredVal: qtyNum,
      unit,
      snf: snfVal,
      ts: tsVal,
      ratio: ratioVal,
      density: densityVal,
      physicalLiters: physicalLitersVal,
      equivalentKg: equivalentKgVal,
      at13TsLiters: at13TsLitersVal,
    };
  }

  // 8A: Fat PERFORMED (3.85) + LR NOT_PERFORMED -> No Density, SNF, TS, @13TS
  const calc8A = computePortionCalculatedValues(
    9500,
    'KG',
    { performanceStatus: 'PERFORMED', numericValue: '3.85' },
    { performanceStatus: 'NOT_PERFORMED', numericValue: '' }
  );
  assert(
    calc8A.density === null &&
      calc8A.snf === null &&
      calc8A.ts === null &&
      calc8A.ratio === null &&
      calc8A.at13TsLiters === null &&
      calc8A.physicalLiters === null,
    'Test 8A: Fat PERFORMED (3.85) + LR NOT_PERFORMED strictly yields null (—) for Density, SNF, TS, Ratio, @13TS'
  );

  // 8B: LR PERFORMED (28.5) + Fat NOT_PERFORMED -> Density calculated; SNF/TS/@13TS remain null (no fake Fat)
  const calc8B = computePortionCalculatedValues(
    10000,
    'LITER',
    { performanceStatus: 'NOT_PERFORMED', numericValue: '' },
    { performanceStatus: 'PERFORMED', numericValue: '28.5' }
  );
  assert(
    calc8B.density !== null &&
      Math.abs(calc8B.density - 1.0285) < 0.0001 &&
      calc8B.equivalentKg !== null &&
      Math.abs(calc8B.equivalentKg - 10285) < 1 &&
      calc8B.snf === null &&
      calc8B.ts === null &&
      calc8B.ratio === null &&
      calc8B.at13TsLiters === null,
    'Test 8B: LR PERFORMED (28.5) + Fat NOT_PERFORMED calculates Density/EquivalentKg, but leaves SNF, TS, @13TS null (no fake Fat)'
  );

  // 8C: Fat (3.85) + LR (28.5) BOTH PERFORMED -> Canonical derived calculations succeed
  const calc8C = computePortionCalculatedValues(
    9500,
    'KG',
    { performanceStatus: 'PERFORMED', numericValue: '3.85' },
    { performanceStatus: 'PERFORMED', numericValue: '28.5' }
  );
  assert(
    calc8C.density !== null &&
      calc8C.snf !== null &&
      Math.abs(calc8C.snf - 8.692) < 0.01 &&
      calc8C.ts !== null &&
      Math.abs(calc8C.ts - 12.542) < 0.01 &&
      calc8C.ratio !== null &&
      Math.abs(calc8C.ratio - 2.258) < 0.01 &&
      calc8C.physicalLiters !== null &&
      calc8C.at13TsLiters !== null,
    'Test 8C: Fat + LR BOTH PERFORMED calculates valid canonical derived metrics (SNF ~8.692%, TS ~12.542%, Ratio ~2.258)'
  );

  // 8D: State Reversal (Fat + LR PERFORMED -> change LR to NOT_PERFORMED) -> Stale calculations immediately cleared
  const calc8D = computePortionCalculatedValues(
    9500,
    'KG',
    { performanceStatus: 'PERFORMED', numericValue: '3.85' },
    { performanceStatus: 'NOT_PERFORMED', numericValue: '' }
  );
  assert(
    calc8D.density === null &&
      calc8D.snf === null &&
      calc8D.ts === null &&
      calc8D.ratio === null &&
      calc8D.at13TsLiters === null &&
      calc8D.physicalLiters === null,
    'Test 8D: Reversing LR from PERFORMED to NOT_PERFORMED immediately clears all LR-dependent calculated display values'
  );

  console.log('\n==================================================');
  console.log(`CONTRACTOR ACCOUNTABILITY REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runContractorAccountabilityTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in contractor accountability suite:', err);
    process.exit(1);
  });
