'use client';

import React from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  PlusCircle,
  X,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import { formatOperationalTime } from '@/lib/datetime-utils';
import { LiveCameraCapture } from '@/components/camera/LiveCameraCapture';
import {
  DecisionRulePanel,
  type DecisionRuleTestRow,
  type DecisionTestOutcome,
} from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import type { DecisionResult, ExceptionReason, PersonDecision } from '@/types/stage1-decision';
import type { OnHoldVisit, WaitingVisit } from './QAQueuePanel';

export type TestPerformanceStatus = 'PERFORMED' | 'NOT_PERFORMED';

export interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  isPhotoRequired?: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
}

export interface SavedPlantResult {
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  performanceStatus: string;
  notPerformedReason: string | null;
  numericValue: number | null;
  textValue: string | null;
  isPassed: boolean | null;
}

export interface VisitDetailPortion {
  id: string;
  visit_id: string;
  portion_number: number;
  current_status: string;
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
  plant_decision: string;
  plant_rejection_reason: string | null;
  dispatch_results: unknown[];
  plant_results: SavedPlantResult[];
  seal_number?: string | null;
  plant_seal_number_entered?: string | null;
  seal_match?: boolean | null;
  exception_reasons?: string[] | null;
}

export interface VisitDetail {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  entry_timestamp: string | null;
  current_status: string;
  test_mode?: string | null;
  visit_decision_summary: string;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_fat?: number | null;
  vehicle_dispatch_lr?: number | null;
  vehicle_dispatch_snf?: number | null;
  portions: VisitDetailPortion[];
  active_plant_tests: LabTestDef[];
}

export interface TestInputState {
  performanceStatus: TestPerformanceStatus;
  notPerformedReason: string;
  numericValue: string;
  textValue: string;
}

export interface QATestingSectionProps {
  activeTab: 'WAITING' | 'IN_TESTING' | 'ON_HOLD';
  searchQuery: string;
  selectedWaitingVisit: WaitingVisit | null;
  selectedHeldVisit: OnHoldVisit | null;
  visitDetail: VisitDetail | null;
  activePortionIndex: number;
  onSelectPortion: (index: number) => void;
  isLoadingVisit: boolean;
  testInputs: Record<string, TestInputState>;
  onTestPerformanceStatusChange: (testId: string, status: TestPerformanceStatus) => void;
  onTestNumericChange: (testId: string, value: string) => void;
  onTestTextChange: (testId: string, value: string) => void;
  onTestReasonChange: (testId: string, value: string) => void;
  onOpenActionModal: (action: 'START' | 'RESUME' | 'ACCEPT' | 'REJECT', visitId?: string) => void;
  requiredManualPlantTests: LabTestDef[];
  performedCount: number;
  notPerformedCount: number;
  unresolvedCount: number;
  canAccept: boolean;
  isSubmitting: boolean;
  formatDispatchQty: (portion: VisitDetailPortion | null) => string;
  onAddPortion?: () => void;
  isAddingPortion?: boolean;
  onRemovePortion?: (portionId: string, portionNumber: number) => void;
  isRemovingPortion?: boolean;

  // Phase 4d additions:
  enteredSeal?: string;
  onSealChange?: (val: string) => void;
  photoStates?: Record<string, string>;
  onPhotoChange?: (testId: string, url: string | null) => void;
  personDecision?: PersonDecision | null;
  onPersonDecisionChange?: (d: PersonDecision) => void;
  decisionRemarks?: string;
  onDecisionRemarksChange?: (val: string) => void;
  isSuperior?: boolean;
}

export const QATestingSection: React.FC<QATestingSectionProps> = ({
  activeTab,
  searchQuery,
  selectedWaitingVisit,
  selectedHeldVisit,
  visitDetail,
  activePortionIndex,
  onSelectPortion,
  isLoadingVisit,
  testInputs,
  onTestPerformanceStatusChange,
  onTestNumericChange,
  onTestTextChange,
  onTestReasonChange,
  onOpenActionModal,
  requiredManualPlantTests,
  performedCount,
  notPerformedCount,
  unresolvedCount,
  canAccept,
  isSubmitting,
  onAddPortion,
  isAddingPortion = false,
  onRemovePortion,
  enteredSeal = '',
  onSealChange,
  photoStates = {},
  onPhotoChange,
  personDecision = null,
  onPersonDecisionChange,
  decisionRemarks = '',
  onDecisionRemarksChange,
  isSuperior = false,
}) => {
  const [localPhotoStates, setLocalPhotoStates] = React.useState<Record<string, string>>({});
  const activePhotos = onPhotoChange ? photoStates : localPhotoStates;

  const handleCapturePhoto = (testId: string, url: string) => {
    if (onPhotoChange) {
      onPhotoChange(testId, url);
    } else {
      setLocalPhotoStates((prev) => ({ ...prev, [testId]: url }));
    }
  };

  const handleClearPhoto = (testId: string) => {
    if (onPhotoChange) {
      onPhotoChange(testId, null);
    } else {
      setLocalPhotoStates((prev) => {
        const next = { ...prev };
        delete next[testId];
        return next;
      });
    }
  };

  const displayableTests = React.useMemo(() => {
    return (visitDetail?.active_plant_tests || []).filter((t) => t.resultType !== 'CALCULATED');
  }, [visitDetail?.active_plant_tests]);

  const currentPortion = visitDetail?.portions[activePortionIndex] || null;

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

  if (activeTab === 'WAITING') {
    if (!selectedWaitingVisit) {
      return (
        <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          {searchQuery ? 'No matching vehicles found.' : 'No vehicles are waiting for QA testing.'}
        </div>
      );
    }

    return (
      <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-5 text-foreground">
        <div className="pb-3 border-b border-border-strong">
          <h3 className="text-base font-semibold text-foreground">Vehicle Waiting for QA</h3>
          <p className="text-xs text-slate-700 font-semibold mt-0.5">
            Vehicle: <strong className="tabular-nums text-foreground">{selectedWaitingVisit.vehicle_number}</strong> | Token:{' '}
            <strong className="tabular-nums text-primary">{selectedWaitingVisit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
          <div>
            <span className="text-slate-500 font-sans block text-[10px]">Portions</span>
            <span>{selectedWaitingVisit.portion_count} Composite Portions</span>
          </div>
          <div>
            <span className="text-slate-500 font-sans block text-[10px]">Gate Entry Time</span>
            <span>{formatOperationalTime(selectedWaitingVisit.entry_timestamp)}</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onOpenActionModal('START', selectedWaitingVisit.id)}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-md transition flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Start QA Testing Session</span>
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'ON_HOLD') {
    if (!selectedHeldVisit) {
      return (
        <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          Select a held vehicle to view hold details.
        </div>
      );
    }

    return (
      <div className="p-6 rounded-xl bg-amber-50 border border-amber-300 shadow-md space-y-5 text-foreground">
        <div className="pb-3 border-b border-amber-200">
          <h3 className="text-base font-semibold text-amber-950">QA Testing On Hold</h3>
          <p className="text-xs text-amber-800 font-semibold mt-0.5">
            Vehicle: <strong className="tabular-nums text-amber-950">{selectedHeldVisit.vehicle_number}</strong> | Token:{' '}
            <strong className="tabular-nums text-amber-900">{selectedHeldVisit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-amber-200 space-y-2">
          <label className="text-xs font-semibold text-amber-950 block">
            Reason for Hold
          </label>
          <p className="text-xs font-semibold text-amber-900">{selectedHeldVisit.hold_reason}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-amber-100/60 border border-amber-200 text-xs tabular-nums font-semibold">
          <div>
            <span className="text-amber-800 font-sans block text-[10px]">Chemist</span>
            <span className="text-amber-950">{selectedHeldVisit.chemist_name}</span>
          </div>
          <div>
            <span className="text-amber-800 font-sans block text-[10px]">Held Since</span>
            <span className="text-amber-950">{formatOperationalTime(selectedHeldVisit.held_since)}</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onOpenActionModal('RESUME', selectedHeldVisit.id)}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold text-xs shadow-md transition flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Resume Testing Session</span>
          </button>
        </div>
      </div>
    );
  }

  // Active IN_TESTING workspace
  if (isLoadingVisit) {
    return (
      <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
        Loading vehicle testing session…
      </div>
    );
  }

  if (!visitDetail) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
        Select an active testing session from the left queue to begin observations.
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-6 text-foreground">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border-strong">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="tabular-nums font-semibold text-lg text-foreground">{visitDetail.vehicle_number}</span>
            <span className="px-2 py-0.5 rounded-lg text-xs tabular-nums font-semibold bg-primary text-white">
              {visitDetail.token_number || 'NO-TOKEN'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-sky-50 text-sky-800 border border-sky-200">
              IN_TESTING
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${
                visitDetail.test_mode === 'COMPOSITE'
                  ? 'bg-purple-100 text-purple-900 border-purple-300'
                  : 'bg-indigo-100 text-indigo-900 border-indigo-300'
              }`}
            >
              {visitDetail.test_mode === 'COMPOSITE' ? 'Composite Mode' : 'Portion-Wise Mode'}
            </span>
          </div>
          <p className="text-xs text-slate-700 font-semibold mt-1">
            Gate Entry: <span className="tabular-nums">{formatOperationalTime(visitDetail.entry_timestamp)}</span> | Visit #{visitDetail.visit_number}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs tabular-nums font-semibold bg-muted px-3 py-1.5 rounded-xl border border-border-strong text-foreground">
            Decision: {visitDetail.visit_decision_summary}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            QA Test Portions ({visitDetail.portions.length} Total)
          </label>
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto max-w-full pb-1">
          {visitDetail.portions.map((p, idx) => {
            const isSelected = activePortionIndex === idx;
            const isAccepted = p.plant_decision === 'ACCEPTED';
            const isRejected = p.plant_decision === 'REJECTED';
            const canRemove = visitDetail.portions.length > 1 && !isAccepted && !isRejected;

            return (
              <div
                key={`portion-tab-${p.id}`}
                className="inline-flex items-center shrink-0"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPortion(idx)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 border min-h-[40px] cursor-pointer select-none ${
                    isSelected
                      ? 'bg-primary/5 text-foreground border-primary ring-1 ring-primary shadow-xs'
                      : isAccepted
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      : isRejected
                      ? 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100'
                      : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                  }`}
                >
                  <span>Portion {p.portion_number}</span>
                  {isAccepted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  {isRejected && <XCircle className="w-3.5 h-3.5 text-rose-500" />}
                  {canRemove && onRemovePortion && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={`Remove Portion ${p.portion_number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemovePortion(p.id, p.portion_number);
                      }}
                      className="ml-1 p-0.5 rounded hover:bg-rose-100 text-slate-400 hover:text-rose-700 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {onAddPortion && (
            <button
              type="button"
              id="qa-add-portion-tab"
              disabled={isAddingPortion || isSubmitting}
              onClick={onAddPortion}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-dashed border-primary/50 text-primary hover:bg-primary/5 hover:border-primary transition flex items-center space-x-1.5 shrink-0 min-h-[40px] cursor-pointer disabled:opacity-50"
              title="Add another test portion"
            >
              {isAddingPortion ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlusCircle className="w-3.5 h-3.5" />
              )}
              <span>+ Add Portion</span>
            </button>
          )}
        </div>
      </div>

      {currentPortion ? (
        <div className="space-y-4">
          {visitDetail.test_mode === 'COMPOSITE' && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-950 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-purple-600 shrink-0" />
              <span>
                <strong>Composite Testing Mode:</strong> 1 portion represents the entire tanker load. A rejection here rejects the entire vehicle.
              </span>
            </div>
          )}

          {/* Portion Seal Verification Card */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">Portion Seal Verification</span>
              </div>
              {hasDispatchSeal ? (
                isSealMatched ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Seal Match
                  </span>
                ) : currentEnteredSeal ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Seal Mismatch
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                    Verification Required
                  </span>
                )
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                  No Dispatch Seal
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block uppercase">
                  Dispatch Recorded Seal
                </label>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono font-semibold text-foreground">
                  {currentPortion.seal_number || 'None (No seal recorded)'}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block uppercase">
                  Received Seal Number (Chemist Check) *
                </label>
                <input
                  type="text"
                  value={enteredSeal}
                  onChange={(e) => onSealChange?.(e.target.value)}
                  placeholder="Enter physical seal number…"
                  className="w-full h-[38px] px-3 font-mono font-semibold text-xs rounded-lg border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {currentPortion.plant_decision === 'REJECTED' && currentPortion.plant_rejection_reason && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold space-y-1">
              <span className="uppercase text-[10px] tracking-wider block text-rose-900">
                Portion Rejection Reason
              </span>
              <p>{currentPortion.plant_rejection_reason}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-border-strong">
              <h4 className="text-xs font-semibold text-foreground">
                Plant Lab Observations ({displayableTests.length} Active Tests)
              </h4>
            </div>

            <div className="max-h-[440px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 p-2 bg-slate-50/70 rounded-xl border border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                {displayableTests.map((test) => {
                  const state = testInputs[test.id] || {
                    performanceStatus: 'PERFORMED',
                    notPerformedReason: '',
                    numericValue: '',
                    textValue: '',
                  };
                  const isPerformed = state.performanceStatus === 'PERFORMED';
                  const codeUpper = (test.testCode || '').toUpperCase();
                  const nameUpper = (test.testName || '').toUpperCase();
                  const isLR = codeUpper.includes('LR') || nameUpper.includes('LR') || nameUpper.includes('LACTOMETER');
                  const isFAT = codeUpper.includes('FAT') || nameUpper.includes('FAT') || nameUpper.includes('GERBER');
                  const isPhotoEligible = isLR || isFAT || Boolean(test.isPhotoRequired);

                  return (
                    <div
                      key={`plant-test-card-${test.id}`}
                      className={`p-2.5 rounded-lg border space-y-1.5 min-w-0 transition ${
                        isPerformed
                          ? 'bg-muted border-border-strong'
                          : 'bg-slate-100/80 border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-foreground block truncate" title={test.testName}>
                            {test.testName} {test.isRequired && <span className="text-rose-600 font-semibold">*</span>}
                          </span>
                          <span className="text-[10px] tabular-nums text-slate-500 block truncate">{test.testCode}</span>
                        </div>
                        {test.unit && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] tabular-nums font-semibold bg-white text-slate-700 border border-border-strong shrink-0">
                            {test.unit}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1 w-full p-0.5 bg-slate-200/80 rounded-md">
                        <button
                          type="button"
                          onClick={() => onTestPerformanceStatusChange(test.id, 'PERFORMED')}
                          className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                            isPerformed
                              ? 'bg-primary text-white shadow-xs'
                              : 'text-slate-700 hover:bg-slate-300/80'
                          }`}
                        >
                          PERFORMED
                        </button>
                        <button
                          type="button"
                          onClick={() => onTestPerformanceStatusChange(test.id, 'NOT_PERFORMED')}
                          className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                            !isPerformed
                              ? 'bg-rose-700 text-white shadow-xs'
                              : 'text-slate-700 hover:bg-slate-300/80'
                          }`}
                        >
                          NOT PERFORMED
                        </button>
                      </div>

                      {isPerformed ? (
                        test.resultType === 'NUMERIC' ? (
                          <div className="min-w-0">
                            <input
                              type="number"
                              step="0.01"
                              value={state.numericValue}
                              onChange={(e) => onTestNumericChange(test.id, e.target.value)}
                              placeholder={`Enter numeric result (${test.unit || 'value'})`}
                              className="w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                            />
                          </div>
                        ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                          <QualitativeResultRadioGroup
                            name={`qa-plant-test-${currentPortion.id}-${test.id}`}
                            value={state.textValue || null}
                            options={test.resultOptions}
                            compact={true}
                            onChange={(val) => onTestTextChange(test.id, val)}
                            ariaLabel={`${test.testName} observation`}
                          />
                        ) : (
                          <div className="min-w-0">
                            <input
                              type="text"
                              value={state.textValue}
                              onChange={(e) => onTestTextChange(test.id, e.target.value)}
                              placeholder="Enter observation result"
                              className="w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                            />
                          </div>
                        )
                      ) : (
                        <div className="min-w-0">
                          <input
                            type="text"
                            value={state.notPerformedReason}
                            onChange={(e) => onTestReasonChange(test.id, e.target.value)}
                            placeholder="Enter reason test was not performed"
                            className="w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border border-rose-300 bg-rose-50/50 text-rose-900 focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                          />
                        </div>
                      )}

                      {isPerformed && isPhotoEligible && (
                        <div className="pt-1.5 border-t border-border-strong">
                          <LiveCameraCapture
                            testType={isFAT ? 'FAT' : 'LR'}
                            stageName="Plant QA Reception"
                            tokenNo={visitDetail.token_number}
                            vehicleNo={visitDetail.vehicle_number}
                            currentPhotoUrl={activePhotos[test.id] || null}
                            onPhotoCaptured={(url) => handleCapturePhoto(test.id, url)}
                            onPhotoCleared={() => handleClearPhoto(test.id)}
                            isRequired={test.isRequired}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-subtle border border-border space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Mandatory Test Accountability:</span>
              <span className="tabular-nums">
                {performedCount}/{requiredManualPlantTests.length} Performed · {notPerformedCount} Marked Omitted · {unresolvedCount} Unresolved
              </span>
            </div>
            {!canAccept && (
              <p className="text-[11px] font-semibold text-amber-800">
                All required manual tests must be either marked PERFORMED with valid observation or explicitly marked NOT PERFORMED before accepting portion.
              </p>
            )}
          </div>

          {/* Decision Rule Panel */}
          <DecisionRulePanel
            tests={decisionRows}
            decision={liveDecision}
            personDecision={personDecision}
            onPersonDecisionChange={(d) => onPersonDecisionChange?.(d)}
            remarks={decisionRemarks}
            onRemarksChange={(r) => onDecisionRemarksChange?.(r)}
            approverLabel="AVP-QA (QA Head)"
            routeLabels={{
              PROCEED: 'Accept Portion',
              REJECT: 'Reject Portion',
              SEND_TO_APPROVER: 'Send Exception to AVP-QA (QA Head)',
              DECIDE_NOW: 'Decide Now (Override / Authorize)',
            }}
            onSubmit={() => onOpenActionModal(personDecision === 'REJECT' ? 'REJECT' : 'ACCEPT')}
            submitting={isSubmitting}
            disabled={isSubmitting || !currentPortion || currentPortion.plant_decision !== 'PENDING'}
          />

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-border-strong">
            <button
              type="button"
              disabled={isSubmitting || currentPortion.plant_decision !== 'PENDING'}
              onClick={() => onOpenActionModal('REJECT')}
              className="min-h-[44px] py-2.5 px-4 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reject Portion
            </button>

            <button
              type="button"
              disabled={!canAccept || isSubmitting || currentPortion.plant_decision !== 'PENDING'}
              onClick={() => onOpenActionModal('ACCEPT')}
              className="min-h-[44px] py-2.5 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Accept Portion
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
