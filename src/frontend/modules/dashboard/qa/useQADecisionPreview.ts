'use client';

import React from 'react';
import type { DecisionRuleTestRow, DecisionTestOutcome } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import type { DecisionResult, ExceptionReason, PersonDecision } from '@/types/stage1-decision';
import type { LabTestDef, TestInputState, VisitDetail, VisitDetailPortion } from './qaTypes';
import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';
import { pickRoleTest, isCalculatedTest, calculatedValueFor } from '@/lib/lab-test-roles';
import { evaluate3ZoneTest } from '@/lib/sop-evaluation';

interface Args {
  visitDetail: VisitDetail | null;
  currentPortion: VisitDetailPortion | null;
  enteredSeal: string;
  testInputs: Record<string, TestInputState>;
  activePhotos: Record<string, string>;
  requiredManualPlantTests: LabTestDef[];
  personDecision: PersonDecision | null;
  decisionRemarks: string;
  isSuperior: boolean;
}

/** Seal evaluation plus the live decision-rule rows / result for the active portion. */
export function useQADecisionPreview({
  visitDetail,
  currentPortion,
  enteredSeal,
  testInputs,
  activePhotos,
  requiredManualPlantTests,
  personDecision,
  decisionRemarks,
  isSuperior,
}: Args) {
  const displayableTests = React.useMemo(() => {
    return visitDetail?.active_plant_tests || [];
  }, [visitDetail?.active_plant_tests]);

  // The LR and Fat readings that feed the milk formulas, found by role (never by name, code, order or id).
  const lrTest = React.useMemo(() => pickRoleTest(displayableTests, 'LR') ?? undefined, [displayableTests]);
  const fatTest = React.useMemo(() => pickRoleTest(displayableTests, 'FAT') ?? undefined, [displayableTests]);

  const lrNum = lrTest && testInputs[lrTest.id]?.numericValue ? Number(testInputs[lrTest.id]?.numericValue) : null;
  const fatNum = fatTest && testInputs[fatTest.id]?.numericValue ? Number(testInputs[fatTest.id]?.numericValue) : null;

  const autoCalculations = React.useMemo(() => {
    return evaluateAllCalculatedTests({ LR: lrNum, FAT: fatNum });
  }, [lrNum, fatNum]);

  // Seal evaluation
  const dispatchSeal = currentPortion?.seal_number?.trim() || '';
  const currentEnteredSeal = (enteredSeal || currentPortion?.plant_seal_number_entered || '').trim();
  const hasDispatchSeal = Boolean(dispatchSeal);
  const isSealMatched = hasDispatchSeal && currentEnteredSeal.toUpperCase() === dispatchSeal.toUpperCase();
  const isSealMismatch = hasDispatchSeal && Boolean(currentEnteredSeal) && !isSealMatched;
  const isSealMissing = hasDispatchSeal && !currentEnteredSeal;

  // Decision rows calculation
  const decisionRows: DecisionRuleTestRow[] = React.useMemo(() => {
    if (!currentPortion) return [];
    const rows: DecisionRuleTestRow[] = [];

    // Seal row
    if (hasDispatchSeal) {
      let outcome: DecisionTestOutcome = 'NOT_TESTED';
      // Optional: the seal is shown for information and never fails or warns the decision.
      let note: string | null = 'Seal number is optional';
      if (isSealMatched) {
        outcome = 'PASS';
        note = 'Matches dispatch seal';
      } else if (isSealMismatch) {
        note = 'Different from dispatch seal (optional, does not block)';
      } else if (isSealMissing) {
        note = 'Seal number not entered (optional)';
      }
      rows.push({
        key: 'seal-verification',
        name: 'Tanker Seal Check',
        outcome,
        valueText: currentEnteredSeal ? `Entered: ${currentEnteredSeal}` : `Dispatch: ${dispatchSeal}`,
        note,
      });
    }

    // Test rows
    for (const test of displayableTests) {
      const state = testInputs[test.id];
      const isCalculated = isCalculatedTest(test as LabTestDef & { formulaId?: unknown });
      const photoRequired = Boolean(test.isPhotoRequired) && !isCalculated;
      const hasPhoto = Boolean(activePhotos[test.id]);

      // If it is an auto-calculated test (found by stored role first):
      if (isCalculated) {
        const calcVal = calculatedValueFor(test, autoCalculations);

        if (calcVal != null) {
          rows.push({
            key: test.id,
            name: test.testName,
            outcome: 'PASS',
            valueText: `${calcVal.toFixed(2)} ${test.unit || '%'}`.trim(),
            note: 'Auto-calculated Richmond formula',
          });
        } else {
          rows.push({
            key: test.id,
            name: test.testName,
            outcome: 'WARN',
            valueText: 'Pending LR & Fat',
            note: 'Calculates automatically once LR and Fat are entered',
          });
        }
        continue;
      }

      if (!state || (state.performanceStatus === 'PERFORMED' && !state.numericValue && !state.textValue)) {
        rows.push({
          key: test.id,
          name: test.testName,
          outcome: test.isRequired ? 'WARN' : 'NOT_TESTED',
          valueText: null,
          note: test.isRequired ? 'Mandatory test pending' : 'Optional (Applied)',
        });
        continue;
      }

      if (state.performanceStatus === 'NOT_PERFORMED') {
        rows.push({
          key: test.id,
          name: test.testName,
          outcome: test.isRequired ? 'FAIL' : 'NOT_TESTED',
          valueText: 'Omitted',
          note: state.notPerformedReason || (test.isRequired ? 'Compulsory test omitted' : 'Not performed'),
        });
        continue;
      }

      // Performed
      let outcome: DecisionTestOutcome = 'PASS';
      let note: string | null = null;
      let valueText: string | null = null;

      const evalRes = evaluate3ZoneTest(
        {
          min: test.rule?.min,
          max: test.rule?.max,
          warningTrigger: (test.rule as any)?.warningTrigger,
          decisionConsequence: (test.rule as any)?.decisionConsequence,
          acceptableOption: (test.rule as any)?.acceptableOption,
          category: (test.rule as any)?.ruleCategory,
          ruleCategory: (test.rule as any)?.ruleCategory,
          testMode: test.isRequired ? 'COMPULSORY' : 'OPTIONAL',
          resultType: test.resultType,
          resultOptions: test.resultOptions,
          unit: test.unit,
        },
        test.resultType === 'NUMERIC' ? state.numericValue : state.textValue
      );

      valueText = test.resultType === 'NUMERIC' ? `${state.numericValue} ${test.unit || ''}`.trim() : (state.textValue || '—');

      if (evalRes.verdict === 'FAIL') {
        outcome = 'FAIL';
        note = evalRes.message;
      } else if (evalRes.verdict === 'WARN') {
        outcome = 'WARN';
        note = evalRes.message;
      } else if (photoRequired && !hasPhoto) {
        outcome = 'WARN';
        note = 'Verification photo missing';
      } else {
        outcome = 'PASS';
        note = evalRes.message;
      }

      rows.push({
        key: test.id,
        name: test.testName,
        outcome,
        valueText,
        note,
      });
    }

    return rows;
  }, [currentPortion, hasDispatchSeal, isSealMatched, isSealMismatch, isSealMissing, currentEnteredSeal, dispatchSeal, displayableTests, testInputs, activePhotos, autoCalculations]);

  // Live decision calculation
  const liveDecision = React.useMemo<DecisionResult | null>(() => {
    if (!currentPortion) return null;
    const ruleFailures: string[] = [];
    const missingCompulsory: string[] = [];
    const missingPhotos: string[] = [];
    const extraReasons: ExceptionReason[] = [];

    // The seal is optional at Plant QA: it is not part of the system decision.

    // Check tests
    for (const test of requiredManualPlantTests) {
      const isCalculated = isCalculatedTest(test as LabTestDef & { formulaId?: unknown });

      if (isCalculated) {
        const calcVal = calculatedValueFor(test, autoCalculations);

        if (calcVal == null) {
          missingCompulsory.push(test.testCode);
        }
        continue;
      }

      const state = testInputs[test.id];
      if (!state) {
        missingCompulsory.push(test.testCode);
        continue;
      }
      if (state.performanceStatus === 'NOT_PERFORMED') {
        ruleFailures.push(test.testCode);
        missingCompulsory.push(test.testCode);
      } else if (state.performanceStatus === 'PERFORMED') {
        if (test.resultType === 'NUMERIC' && (!state.numericValue || isNaN(Number(state.numericValue)))) {
          missingCompulsory.push(test.testCode);
        } else if (test.resultType === 'NUMERIC' && test.rule) {
          const evalRes = evaluate3ZoneTest(
            {
              min: test.rule.min,
              max: test.rule.max,
              warningTrigger: (test.rule as any)?.warningTrigger,
              decisionConsequence: (test.rule as any)?.decisionConsequence,
              acceptableOption: (test.rule as any)?.acceptableOption,
              category: (test.rule as any)?.ruleCategory,
              ruleCategory: (test.rule as any)?.ruleCategory,
              testMode: test.isRequired ? 'COMPULSORY' : 'OPTIONAL',
              resultType: test.resultType,
              resultOptions: test.resultOptions,
              unit: test.unit,
            },
            state.numericValue
          );
          if (evalRes.isRuleFailure) {
            ruleFailures.push(test.testCode);
          }
        } else if (test.resultType !== 'NUMERIC' && !state.textValue) {
          missingCompulsory.push(test.testCode);
        }
        if (test.resultOptions) {
          const opt = test.resultOptions.find((o) => o.value === state.textValue);
          if (opt && opt.isPassing === false) {
            ruleFailures.push(test.testCode);
          }
        }
      }

      if (Boolean(test.isPhotoRequired) && !activePhotos[test.id]) {
        missingPhotos.push(test.testCode);
      }
    }

    if (missingPhotos.length > 0) {
      extraReasons.push('PICTURE_MISSING');
    }
    if (missingCompulsory.length > 0) {
      extraReasons.push('MISSING_FIELD');
    }

    return evaluateDecision(
      {
        ruleFailures,
        missingCompulsory,
        missingPhotos,
        extraReasons,
        personDecision: personDecision || 'ACCEPT',
        remarks: decisionRemarks,
        deciderCanApprove: isSuperior,
      }
    );
  }, [
    currentPortion,
    hasDispatchSeal,
    isSealMatched,
    requiredManualPlantTests,
    testInputs,
    activePhotos,
    personDecision,
    decisionRemarks,
    isSuperior,
    autoCalculations,
  ]);

  return {
    displayableTests,
    hasDispatchSeal,
    isSealMatched,
    currentEnteredSeal,
    decisionRows,
    liveDecision,
    autoCalculations,
  };
}
