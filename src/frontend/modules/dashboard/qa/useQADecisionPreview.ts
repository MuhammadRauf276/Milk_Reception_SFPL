'use client';

import React from 'react';
import type { DecisionRuleTestRow, DecisionTestOutcome } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import type { DecisionResult, ExceptionReason, PersonDecision } from '@/types/stage1-decision';
import type { LabTestDef, TestInputState, VisitDetail, VisitDetailPortion } from './qaTypes';

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
    return (visitDetail?.active_plant_tests || []).filter((t) => t.resultType !== 'CALCULATED');
  }, [visitDetail?.active_plant_tests]);

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
      const isLR = codeUpper.includes('LR') || nameUpper.includes('LR') || nameUpper.includes('LACTOMETER');
      const isFAT = codeUpper.includes('FAT') || nameUpper.includes('FAT') || nameUpper.includes('GERBER');
      const photoRequired = isLR || isFAT || Boolean(test.isPhotoRequired);
      const hasPhoto = Boolean(activePhotos[test.id]);

      if (!state || (state.performanceStatus === 'PERFORMED' && !state.numericValue && !state.textValue)) {
        rows.push({
          key: test.id,
          name: test.testName,
          outcome: test.isRequired ? 'WARN' : 'NOT_TESTED',
          valueText: null,
          note: test.isRequired ? 'Mandatory test pending' : null,
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

      if (test.resultType === 'NUMERIC') {
        valueText = `${state.numericValue} ${test.unit || ''}`.trim();
        if (photoRequired && !hasPhoto) {
          outcome = 'WARN';
          note = 'Verification photo missing';
        }
      } else if (test.resultOptions && test.resultOptions.length > 0) {
        valueText = state.textValue || '—';
        const opt = test.resultOptions.find((o) => o.value === state.textValue);
        if (opt && opt.isPassing === false) {
          outcome = 'FAIL';
          note = 'Out of acceptable specification';
        }
      } else {
        valueText = state.textValue || '—';
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
  }, [currentPortion, hasDispatchSeal, isSealMatched, isSealMismatch, isSealMissing, currentEnteredSeal, dispatchSeal, displayableTests, testInputs, activePhotos]);

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
        } else if (test.resultType !== 'NUMERIC' && !state.textValue) {
          missingCompulsory.push(test.testCode);
        }
        if (test.resultOptions) {
          const opt = test.resultOptions.find((o) => o.value === state.textValue);
          if (opt && opt.isPassing === false) {
            ruleFailures.push(test.testCode);
          }
        }
        const codeUpper = (test.testCode || '').toUpperCase();
        const isLR = codeUpper.includes('LR');
        const isFAT = codeUpper.includes('FAT');
        if ((isLR || isFAT || test.isPhotoRequired) && !activePhotos[test.id]) {
          missingPhotos.push(test.testCode);
        }
      }
    }

    const effectiveDecision: PersonDecision = personDecision || 'ACCEPT';
    return evaluateDecision({
      ruleFailures,
      missingCompulsory,
      missingPhotos,
      extraReasons,
      personDecision: effectiveDecision,
      remarks: decisionRemarks || '',
      deciderCanApprove: Boolean(isSuperior),
    });
  }, [currentPortion, hasDispatchSeal, isSealMatched, requiredManualPlantTests, testInputs, activePhotos, personDecision, decisionRemarks, isSuperior]);

  return {
    displayableTests,
    hasDispatchSeal,
    isSealMatched,
    currentEnteredSeal,
    decisionRows,
    liveDecision,
  };
}
