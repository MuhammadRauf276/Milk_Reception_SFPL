'use client';

import React from 'react';
import type { DecisionRuleTestRow, DecisionTestOutcome } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import type { DecisionResult, ExceptionReason, PersonDecision } from '@/types/stage1-decision';
import type { LabTestDef, TestInputState, VisitDetail, VisitDetailPortion } from './qaTypes';
import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';
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
    return [...(visitDetail?.active_plant_tests || [])].sort((a, b) => {
      const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 999;
      const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.testCode || '').localeCompare(b.testCode || '');
    });
  }, [visitDetail?.active_plant_tests]);

  // Authoritative detection of raw observations: LR and Fat
  const lrTest = React.useMemo(() => {
    return displayableTests.find((t) => {
      const c = (t.testCode || '').toUpperCase();
      const n = (t.testName || '').toUpperCase();
      if (n.includes('RATIO') || n.includes('SNF') || n.includes('SODIUM') || n.includes('CLOT')) return false;
      return c === 'LR' || c === 'LT_LR' || c === 'LT-000008' || c === 'LT-000027' || n.startsWith('LR') || n.includes('LACTOMETER') || (n.includes('LR') && !n.includes('RATIO'));
    });
  }, [displayableTests]);

  const fatTest = React.useMemo(() => {
    return displayableTests.find((t) => {
      const c = (t.testCode || '').toUpperCase();
      const n = (t.testName || '').toUpperCase();
      if (n.includes('RATIO') || c.includes('RATIO') || n.includes('SNF') || c.includes('SNF')) return false;
      return c === 'FAT' || c === 'LT_FAT' || c === 'LT-000026' || n === 'FAT' || n.startsWith('FAT') || n.includes('GERBER') || n.includes('FAT %');
    });
  }, [displayableTests]);

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
      let note: string | null = 'Seal verification required';
      if (isSealMatched) {
        outcome = 'PASS';
        note = 'Matches dispatch seal';
      } else if (isSealMismatch) {
        outcome = 'FAIL';
        note = 'Mismatch with dispatch seal';
      } else if (isSealMissing) {
        outcome = 'WARN';
        note = 'Seal number pending entry';
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
      const codeUpper = (test.testCode || '').toUpperCase();
      const nameUpper = (test.testName || '').toUpperCase();
      const isLR = (codeUpper === 'LR' || codeUpper === 'LT_LR' || codeUpper === 'LT-000008' || codeUpper === 'LT-000027' || nameUpper.startsWith('LR') || nameUpper.includes('LACTOMETER')) && !nameUpper.includes('RATIO') && !nameUpper.includes('SNF');
      const isFAT = (codeUpper === 'FAT' || codeUpper === 'LT_FAT' || codeUpper === 'LT-000026' || nameUpper === 'FAT' || nameUpper.startsWith('FAT') || nameUpper.includes('GERBER')) && !nameUpper.includes('RATIO') && !nameUpper.includes('SNF');
      
      const isCategorical = test.resultType === 'POSITIVE_NEGATIVE' || test.resultType === 'OK_NOT_OK' || test.resultType === 'BOOLEAN';
      const isCalculated = !isCategorical && (
        test.resultType === 'CALCULATED' ||
        Boolean((test as any).formulaId) ||
        codeUpper === 'SYS-SNF' ||
        codeUpper === 'SYS-TS' ||
        codeUpper === 'SNF' ||
        codeUpper === 'TS' ||
        codeUpper === 'RATIO' ||
        nameUpper === 'SNF' ||
        nameUpper.includes('SOLIDS-NOT-FAT') ||
        nameUpper.includes('SNF TO FAT RATIO') ||
        nameUpper.includes('RATIO SNF/FAT') ||
        nameUpper === 'TOTAL SOLIDS'
      );
      const photoRequired = (isLR || isFAT || Boolean(test.isPhotoRequired)) && !isCalculated;
      const hasPhoto = Boolean(activePhotos[test.id]);

      // If it is an auto-calculated test:
      if (isCalculated) {
        let calcVal: number | null = null;
        if (nameUpper.includes('RATIO') || codeUpper.includes('RATIO') || codeUpper === 'LT-000009') {
          calcVal = autoCalculations.RATIO_SNF_FAT ?? autoCalculations['LT-000009'];
        } else if (nameUpper.includes('SOLIDS') || nameUpper === 'TS' || codeUpper === 'SYS-TS' || codeUpper === 'LT-TOTAL-SOLIDS') {
          calcVal = autoCalculations.TOTAL_SOLIDS;
        } else if ((nameUpper.includes('SNF') && !nameUpper.includes('RATIO')) || codeUpper === 'SYS-SNF' || codeUpper === 'SNF') {
          calcVal = autoCalculations.SNF_CANONICAL;
        }

        if (calcVal != null) {
          const noteText = nameUpper.includes('RATIO') || codeUpper.includes('RATIO') || codeUpper === 'LT-000009'
            ? 'Auto-calculated: SNF / Fat'
            : nameUpper.includes('SOLIDS') || nameUpper === 'TS' || codeUpper === 'SYS-TS'
            ? 'Auto-calculated: Fat + SNF'
            : 'Auto-calculated Richmond formula';

          rows.push({
            key: test.id,
            name: test.testName,
            outcome: 'PASS',
            valueText: `${calcVal.toFixed(2)} ${test.unit || '%'}`.trim(),
            note: noteText,
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

    // Check seal
    if (hasDispatchSeal && !isSealMatched) {
      ruleFailures.push('SEAL');
      extraReasons.push('MISMATCH');
    }

    // Check tests
    for (const test of requiredManualPlantTests) {
      const codeUpper = (test.testCode || '').toUpperCase();
      const nameUpper = (test.testName || '').toUpperCase();
      const isCategorical = test.resultType === 'POSITIVE_NEGATIVE' || test.resultType === 'OK_NOT_OK' || test.resultType === 'BOOLEAN';
      const isCalculated = !isCategorical && (
        test.resultType === 'CALCULATED' ||
        Boolean((test as any).formulaId) ||
        codeUpper === 'SYS-SNF' ||
        codeUpper === 'SYS-TS' ||
        codeUpper === 'SNF' ||
        codeUpper === 'TS' ||
        codeUpper === 'RATIO' ||
        nameUpper === 'SNF' ||
        nameUpper.includes('SOLIDS-NOT-FAT') ||
        nameUpper.includes('SNF TO FAT RATIO') ||
        nameUpper.includes('RATIO SNF/FAT') ||
        nameUpper === 'TOTAL SOLIDS'
      );

      if (isCalculated) {
        let calcVal: number | null = null;
        if (nameUpper.includes('RATIO') || codeUpper.includes('RATIO') || codeUpper === 'LT-000009') {
          calcVal = autoCalculations.RATIO_SNF_FAT ?? autoCalculations['LT-000009'];
        } else if (nameUpper.includes('SOLIDS') || nameUpper === 'TS' || codeUpper === 'SYS-TS' || codeUpper === 'LT-TOTAL-SOLIDS') {
          calcVal = autoCalculations.TOTAL_SOLIDS;
        } else if ((nameUpper.includes('SNF') && !nameUpper.includes('RATIO')) || codeUpper === 'SYS-SNF' || codeUpper === 'SNF') {
          calcVal = autoCalculations.SNF_CANONICAL;
        }

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

      const isLRTest = (codeUpper === 'LR' || codeUpper === 'LT_LR' || codeUpper === 'LT-000008' || codeUpper === 'LT-000027' || nameUpper.startsWith('LR') || nameUpper.includes('LACTOMETER')) && !nameUpper.includes('RATIO') && !nameUpper.includes('SNF');
      const isFATTest = (codeUpper === 'FAT' || codeUpper === 'LT_FAT' || codeUpper === 'LT-000026' || nameUpper === 'FAT' || nameUpper.startsWith('FAT') || nameUpper.includes('GERBER')) && !nameUpper.includes('RATIO') && !nameUpper.includes('SNF');
      if ((isLRTest || isFATTest || Boolean(test.isPhotoRequired)) && !activePhotos[test.id]) {
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
