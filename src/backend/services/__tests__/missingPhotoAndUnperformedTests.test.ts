import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMotShopDecision } from '@/backend/services/mot/motShopDecision';
import { buildLabPortionDecision } from '@/backend/services/zmcc/labPortionDecision';
import { buildDispatchDecision } from '@/backend/services/dispatch/dispatchDecisionService';
import { computePortionLiveDecision } from '@/frontend/modules/dashboard/qa/useQADecisionPreview';
import { testValuesFrom, enrichExceptionCodes } from '@/backend/services/approvals/approvalInboxService';
import { exceptionReasonLabel, exceptionReasonText } from '@/lib/exceptionReasons';
import { evaluate3ZoneTest } from '@/lib/sop-evaluation';
import { evaluateLabResult } from '@/lib/lab-rules';

const cellBase = {
  displayOrder: 1,
  version: 1,
  effectiveFrom: '',
  source: 'DB' as const,
};

test('Stage 1 (MOT Shop): missing compulsory photo and unwritten compulsory tests both appear in exceptions and unwritten stays NOT_TESTED', () => {
  const policy = {
    point: 'MOT_SHOP' as const,
    version: 1,
    fetchedAt: '2026-11-14T00:00:00Z',
    tests: [
      {
        ...cellBase,
        point: 'MOT_SHOP' as const,
        labTestId: '1',
        testCode: 'LT-000002',
        testName: 'Organoleptic Smell',
        resultType: 'QUALITATIVE',
        isLr: false,
        isFat: false,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'NONE' as const,
        options: ['OK', 'NOT_OK'],
        rule: { min: null, max: null, allowed: ['OK'] },
      },
      {
        ...cellBase,
        point: 'MOT_SHOP' as const,
        labTestId: '2',
        testCode: 'LT-000010',
        testName: 'FAT',
        resultType: 'NUMERIC',
        isLr: false,
        isFat: true,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'REQUIRED' as const,
        rule: { min: 3.5, max: 6.5 },
      },
    ],
  };

  const res = buildMotShopDecision(policy, {
    lr: Number.NaN,
    fat: Number.NaN,
    tests: [{ labTestId: '1', textValue: 'OK' }],
    photos: [],
    personDecision: 'ACCEPT',
    remarks: 'Checked smell only',
    geofence: { status: 'INSIDE', distanceM: 10, radiusM: 100, accuracyM: 10, approximate: false },
    deciderCanApprove: false,
  });

  assert.equal(res.decision.route, 'SEND_TO_APPROVER');
  assert.ok(res.decision.exceptionReasons.includes('MISSING_FIELD'), 'expected MISSING_FIELD');
  assert.ok(res.decision.exceptionReasons.includes('PICTURE_MISSING'), 'expected PICTURE_MISSING even when unwritten');
  assert.ok(res.decision.exceptionReasons.includes('MISMATCH'), 'expected MISMATCH when operator accepts incomplete tests');
  assert.equal(res.details.tests.find((t) => t.labTestId === '1')?.outcome, 'PASS');
  assert.equal(res.details.tests.find((t) => t.labTestId === '2')?.outcome, 'NOT_TESTED');
});

test('Stage 2 (ZMCC Lab): missing compulsory photo and unwritten compulsory tests both appear in exceptions and unwritten stays NOT_TESTED', () => {
  const policy = {
    point: 'ZMCC_LAB_HC' as const,
    version: 1,
    fetchedAt: '2026-11-14T00:00:00Z',
    tests: [
      {
        ...cellBase,
        point: 'ZMCC_LAB_HC' as const,
        labTestId: '1',
        testCode: 'LT-000002',
        testName: 'Organoleptic Smell',
        resultType: 'QUALITATIVE',
        unit: null,
        isLr: false,
        isFat: false,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'NONE' as const,
        options: ['OK', 'NOT_OK'],
        rule: { min: null, max: null, allowed: ['OK'] },
      },
      {
        ...cellBase,
        point: 'ZMCC_LAB_HC' as const,
        labTestId: '2',
        testCode: 'LT-000005',
        testName: 'Acidity',
        resultType: 'NUMERIC',
        unit: '%',
        isLr: false,
        isFat: false,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'REQUIRED' as const,
        options: null,
        rule: { min: 0.1, max: 0.16 },
      },
    ],
  };

  const res = buildLabPortionDecision(policy, {
    tests: [{ labTestId: '1', textValue: 'OK' }],
    photos: [],
    personDecision: 'ACCEPT',
    remarks: 'Checked smell only',
    deciderCanApprove: false,
  });

  assert.equal(res.decision.route, 'SEND_TO_APPROVER');
  assert.ok(res.decision.exceptionReasons.includes('MISSING_FIELD'), 'expected MISSING_FIELD');
  assert.ok(res.decision.exceptionReasons.includes('PICTURE_MISSING'), 'expected PICTURE_MISSING even when unwritten');
  assert.ok(res.decision.exceptionReasons.includes('MISMATCH'), 'expected MISMATCH');
  assert.equal(res.details.tests.find((t) => t.labTestId === '1')?.outcome, 'PASS');
  assert.equal(res.details.tests.find((t) => t.labTestId === '2')?.outcome, 'NOT_TESTED');
});

test('Stage 3 (Dispatch): missing compulsory photo and unwritten compulsory tests both appear in exceptions and missingPhotos', () => {
  const policy = {
    point: 'ZMCC_DISPATCH' as const,
    version: 1,
    fetchedAt: '2026-11-14T00:00:00Z',
    tests: [
      {
        ...cellBase,
        point: 'ZMCC_DISPATCH' as const,
        labTestId: '1',
        testCode: 'LT-000002',
        testName: 'Organoleptic Smell',
        resultType: 'QUALITATIVE',
        unit: null,
        isLr: false,
        isFat: false,
        isLabReport: false,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'NONE' as const,
        options: ['OK', 'NOT_OK'],
        rule: { min: null, max: null, allowed: ['OK'] },
      },
      {
        ...cellBase,
        point: 'ZMCC_DISPATCH' as const,
        labTestId: '2',
        testCode: 'LT-000006',
        testName: 'pH at 20 Celsius',
        resultType: 'NUMERIC',
        unit: 'pH',
        isLr: false,
        isFat: false,
        isLabReport: false,
        testMode: 'COMPULSORY' as const,
        ruleMode: 'APPLY' as const,
        photoMode: 'REQUIRED' as const,
        options: null,
        rule: { min: 6.5, max: 6.8 },
      },
    ],
  };

  const res = buildDispatchDecision(policy, {
    testMode: 'COMPOSITE',
    portions: [
      {
        portionNumber: 1,
        sealNumber: 'S1',
        quantityValue: 1000,
        quantityUnit: 'LITER',
        tests: [{ labTestId: '1', textValue: 'OK' }],
        photos: [],
      },
    ],
    labReportCaptureId: 'cap-report',
    personDecision: 'ACCEPT',
    remarks: 'Dispatch check',
    deciderCanApprove: false,
  });

  assert.equal(res.decision.route, 'SEND_TO_APPROVER');
  assert.ok(res.decision.exceptionReasons.includes('MISSING_FIELD'), 'expected MISSING_FIELD');
  assert.ok(res.decision.exceptionReasons.includes('PICTURE_MISSING'), 'expected PICTURE_MISSING even when unwritten');
  assert.ok(res.details.missingPhotos.includes('pH at 20 Celsius'), 'expected missingPhotos to name unwritten photo-required test');
  assert.equal(res.details.portions[0].tests.find((t) => t.labTestId === '1')?.outcome, 'PASS');
  assert.equal(res.details.portions[0].tests.find((t) => t.labTestId === '2')?.outcome, 'NOT_TESTED');
});

test('Stage 4 (Plant QA live preview): flags missing photo and unwritten compulsory tests together', () => {
  const displayableTests = [
    {
      id: '1',
      testCode: 'LT-000002',
      testName: 'Organoleptic Smell',
      resultType: 'QUALITATIVE',
      unit: null,
      testScope: 'MANUAL',
      isRequired: true,
      isPhotoRequired: false,
      displayOrder: 1,
      resultOptions: [
        { value: 'OK', label: 'OK', isPassing: true },
        { value: 'NOT_OK', label: 'Not OK', isPassing: false },
      ],
    },
    {
      id: '2',
      testCode: 'LT-000008',
      testName: 'MBRT',
      resultType: 'NUMERIC',
      unit: 'min',
      testScope: 'MANUAL',
      isRequired: true,
      isPhotoRequired: true,
      displayOrder: 2,
      rule: { min: 180, max: 600 },
    },
  ];

  const preview = computePortionLiveDecision({
    displayableTests,
    requiredManualPlantTests: displayableTests,
    testInputs: {
      '1': { performanceStatus: 'PERFORMED', numericValue: '', textValue: 'OK', notPerformedReason: '' },
    },
    activePhotos: {},
    personDecision: 'ACCEPT',
    decisionRemarks: 'Visual check only',
    isSuperior: false,
  });

  assert.equal(preview.decision.route, 'SEND_TO_APPROVER');
  assert.equal(preview.systemAccepts, false);
  assert.ok(preview.decision.exceptionReasons.includes('MISSING_FIELD'), 'expected MISSING_FIELD');
  assert.ok(preview.decision.exceptionReasons.includes('PICTURE_MISSING'), 'expected PICTURE_MISSING');
  assert.ok(preview.reasons.includes('A compulsory test was not done.'));
  assert.ok(preview.reasons.includes('Test photo is required for MBRT.'));
});

test('Approval Inbox: testValuesFrom never marks unwritten tests PASS and enrichExceptionCodes surfaces missing photos/fields', () => {
  const stored = [
    {
      labTestId: '1',
      testCode: 'LT-000002',
      testName: 'Organoleptic Smell',
      textValue: 'OK',
      outcome: 'PASS',
      testMode: 'COMPULSORY',
      ruleMode: 'APPLY',
      photoMode: 'NONE',
      photoCaptureId: null,
    },
    {
      labTestId: '2',
      testCode: 'LT-000003',
      testName: 'Organoleptic Taste',
      value: null,
      textValue: null,
      outcome: undefined, // simulate historical snapshot missing outcome
      testMode: 'COMPULSORY',
      ruleMode: 'NONE',
      photoMode: 'REQUIRED',
      photoCaptureId: null,
    },
  ];

  const mapped = testValuesFrom(stored);
  assert.equal(mapped[0].value, 'OK');
  assert.equal(mapped[0].outcome, 'PASS');
  assert.equal(mapped[0].pass, true);

  assert.equal(mapped[1].value, null);
  assert.equal(mapped[1].outcome, 'NOT_TESTED');
  assert.equal(mapped[1].pass, null);

  const enriched = enrichExceptionCodes(['MISMATCH'], stored);
  assert.ok(enriched.includes('PICTURE_MISSING'), 'expected PICTURE_MISSING for historical missing required photo');
  assert.ok(enriched.includes('MISSING_FIELD'), 'expected MISSING_FIELD for unwritten compulsory test');

  assert.equal(exceptionReasonLabel('PICTURE_MISSING:LT-000008'), 'Picture missing');
  assert.equal(
    exceptionReasonText('PICTURE_MISSING:LT-000008', (c) => (c === 'LT-000008' ? 'MBRT' : c)),
    'Required picture is missing for MBRT.'
  );
});

test('evaluate3ZoneTest & evaluateLabResult: unwritten/NOT_TESTED values never pass and non-compulsory is NEUTRAL', () => {
  const emptyNumeric = evaluate3ZoneTest(
    {
      resultType: 'NUMERIC',
      min: 26,
      max: 32,
    },
    ''
  );
  assert.equal(emptyNumeric.verdict, 'NOT_TESTED');
  assert.equal(emptyNumeric.isPass, false);

  for (const blankVal of ['NOT_TESTED', 'NOT_PERFORMED', '—', '']) {
    const res = evaluate3ZoneTest(
      {
        resultType: 'QUALITATIVE',
        acceptableOption: 'OK',
      },
      blankVal
    );
    assert.equal(res.verdict, 'NOT_TESTED');
    assert.equal(res.isPass, false);

    const labRes = evaluateLabResult('LT-000002', null, blankVal, 'QUALITATIVE', null, null, true);
    assert.equal(labRes.isPassed, false);
  }

  const nonCompulsory = evaluateLabResult(
    'LT-000008',
    200,
    null,
    'NUMERIC',
    null,
    { min: 180, max: 600 },
    false
  );
  assert.equal(nonCompulsory.status, 'NEUTRAL');
  assert.equal(nonCompulsory.isPassed, null);

  const noRule = evaluateLabResult('LT-CUSTOM', 10, null, 'NUMERIC', null, null, true);
  assert.equal(noRule.status, 'NO_ACTIVE_RULE');
  assert.equal(noRule.isPassed, null);
});

test('Calculated SNF/TS fail out-of-range rules in both Stage 1 (MOT) and Stage 3 (Dispatch)', () => {
  const sharedTests = [
    { ...cellBase, labTestId: '1', testCode: 'LT-000001', testName: 'LR', resultType: 'NUMERIC', unit: 'LR', isLr: true, isFat: false, testMode: 'COMPULSORY' as const, ruleMode: 'APPLY' as const, photoMode: 'NONE' as const, options: null, rule: { min: 20, max: 35 } },
    { ...cellBase, labTestId: '2', testCode: 'LT-000010', testName: 'FAT', resultType: 'NUMERIC', unit: '%', isLr: false, isFat: true, testMode: 'COMPULSORY' as const, ruleMode: 'APPLY' as const, photoMode: 'NONE' as const, options: null, rule: { min: 2, max: 7 } },
    { ...cellBase, labTestId: '3', testCode: 'LT-000011', testName: 'SNF', resultType: 'CALCULATED', unit: '%', isLr: false, isFat: false, testMode: 'COMPULSORY' as const, ruleMode: 'APPLY' as const, photoMode: 'NONE' as const, options: null, rule: { min: 8.5, max: 10.5 } },
  ];

  // LR=24, FAT=3.0 -> SNF = 24/4 + 0.21*3 + 0.36 = 6.99 (< 8.5 => FAIL)
  const motRes = buildMotShopDecision(
    { point: 'MOT_SHOP', version: 1, fetchedAt: '2026-11-14T00:00:00Z', tests: sharedTests.map((t) => ({ ...t, point: 'MOT_SHOP' as const })) },
    { lr: 24, fat: 3.0, tests: [], photos: [], personDecision: 'ACCEPT', remarks: 'Test calc', geofence: { status: 'INSIDE', distanceM: 1, radiusM: 100, accuracyM: 5, approximate: false }, deciderCanApprove: false }
  );
  assert.equal(motRes.details.tests.find((t) => t.labTestId === '3')?.outcome, 'FAIL');
  assert.equal(motRes.decision.route, 'SEND_TO_APPROVER');

  const dispatchRes = buildDispatchDecision(
    { point: 'ZMCC_DISPATCH', version: 1, fetchedAt: '2026-11-14T00:00:00Z', tests: sharedTests.map((t) => ({ ...t, point: 'ZMCC_DISPATCH' as const, isLabReport: false })) },
    {
      testMode: 'COMPOSITE',
      portions: [{ portionNumber: 1, sealNumber: 'S1', quantityValue: 500, quantityUnit: 'LITER', tests: [{ labTestId: '1', value: 24 }, { labTestId: '2', value: 3.0 }], photos: [] }],
      labReportCaptureId: 'cap-1',
      personDecision: 'ACCEPT',
      remarks: 'Test calc',
      deciderCanApprove: false,
    }
  );
  assert.equal(dispatchRes.details.portions[0].tests.find((t) => t.labTestId === '3')?.outcome, 'FAIL');
  assert.equal(dispatchRes.decision.route, 'SEND_TO_APPROVER');
});
