'use client';

import React from 'react';
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  FlaskConical,
  Calculator,
} from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';
import { DecisionRulePanel } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import {
  calculateSNF,
  calculateTS,
  calculateDensity,
  calculateRatio,
  calculatePhysicalLiters,
} from '@/backend/utils/milkFormulas';
import type { PersonDecision } from '@/types/stage1-decision';
import type { OnHoldVisit, WaitingVisit } from './QAQueuePanel';
import type {
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
} from './qaTypes';
import { useQADecisionPreview } from './useQADecisionPreview';
import { QATestObservationCard } from './QATestObservationCard';
import { QAPortionTabs } from './QAPortionTabs';
import { QAWaitingVisitCard, QAHeldVisitCard } from './QAVisitStatusCards';

export type {
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
};

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

  const currentPortion = visitDetail?.portions[activePortionIndex] || null;

  const { displayableTests, hasDispatchSeal, isSealMatched, currentEnteredSeal, decisionRows, liveDecision } =
    useQADecisionPreview({
      visitDetail,
      currentPortion,
      enteredSeal,
      testInputs,
      activePhotos,
      requiredManualPlantTests,
      personDecision,
      decisionRemarks,
      isSuperior,
    });

  // Calculate live milk quality values from entered observations for the active portion
  const portionCalc = React.useMemo(() => {
    let lrVal: number | null = null;
    let fatVal: number | null = null;

    for (const test of displayableTests) {
      const codeUpper = (test.testCode || '').toUpperCase();
      const nameUpper = (test.testName || '').toUpperCase();
      const isLR = codeUpper.includes('LR') || nameUpper.includes('LR') || nameUpper.includes('LACTOMETER');
      const isFAT = codeUpper.includes('FAT') || nameUpper.includes('FAT') || nameUpper.includes('GERBER');
      const state = testInputs[test.id];

      if (state && state.performanceStatus === 'PERFORMED' && state.numericValue) {
        const num = parseFloat(state.numericValue);
        if (!isNaN(num)) {
          if (isLR) lrVal = num;
          if (isFAT) fatVal = num;
        }
      }
    }

    const density = lrVal !== null && lrVal > 0 ? calculateDensity(lrVal) : null;
    const snf = lrVal !== null && fatVal !== null && lrVal > 0 && fatVal >= 0 ? calculateSNF(lrVal, fatVal) : null;
    const ts = fatVal !== null && snf !== null ? calculateTS(fatVal, snf) : null;
    const ratio = fatVal !== null && snf !== null ? calculateRatio(snf, fatVal) : null;

    const portionQty = currentPortion?.dispatch_quantity_value != null
      ? Number(currentPortion.dispatch_quantity_value)
      : null;
    const grossLiters = portionQty !== null && lrVal !== null && lrVal > 0 ? calculatePhysicalLiters(portionQty, lrVal) : null;

    return {
      lrVal,
      fatVal,
      density,
      snf,
      ts,
      ratio,
      portionQty,
      grossLiters,
    };
  }, [displayableTests, testInputs, currentPortion]);

  if (activeTab === 'WAITING') {
    if (!selectedWaitingVisit) {
      return (
        <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          {searchQuery ? 'No matching vehicles found.' : 'No vehicles are waiting for QA testing.'}
        </div>
      );
    }
    return (
      <QAWaitingVisitCard
        visit={selectedWaitingVisit}
        isSubmitting={isSubmitting}
        onStart={(id) => onOpenActionModal('START', id)}
      />
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
      <QAHeldVisitCard
        visit={selectedHeldVisit}
        isSubmitting={isSubmitting}
        onResume={(id) => onOpenActionModal('RESUME', id)}
      />
    );
  }

  // Active IN_TESTING workspace
  if (isLoadingVisit) {
    return (
      <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground bg-white">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
        Loading vehicle testing session…
      </div>
    );
  }

  if (!visitDetail) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground bg-white">
        Select an active testing session from the left queue to begin observations.
      </div>
    );
  }

  return (
    <div className="space-y-5 text-foreground">
      {/* Top Context Card styled like Dispatch to Plant header */}
      <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-primary text-white shadow-2xs shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-base text-foreground tabular-nums">
                  {visitDetail.vehicle_number}
                </span>
                <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-primary-hover border border-blue-200">
                  {visitDetail.token_number || 'NO-TOKEN'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-50 text-sky-800 border border-sky-200">
                  IN_TESTING
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                    visitDetail.test_mode === 'COMPOSITE'
                      ? 'bg-purple-100 text-purple-900 border-purple-300'
                      : 'bg-indigo-100 text-indigo-900 border-indigo-300'
                  }`}
                >
                  {visitDetail.test_mode === 'COMPOSITE' ? 'Composite Mode' : 'Portion-Wise Mode'}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-medium mt-0.5 flex items-center gap-1.5 flex-wrap">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Gate Entry: <strong className="tabular-nums font-semibold text-slate-800">{formatOperationalTime(visitDetail.entry_timestamp)}</strong></span>
                <span>·</span>
                <span>Visit #{visitDetail.visit_number}</span>
                {visitDetail.reception_number && (
                  <>
                    <span>·</span>
                    <span>Rec #{visitDetail.reception_number}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-start sm:self-center">
            <div className="flex items-center space-x-2 bg-muted px-3 py-1.5 rounded-xl border border-border-strong">
              <span className="text-xs uppercase font-semibold text-slate-500">Status:</span>
              <span className="text-xs font-semibold text-primary-hover tabular-nums">
                {visitDetail.visit_decision_summary}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Portions Navigation Bar */}
      <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs">
        <QAPortionTabs
          visitDetail={visitDetail}
          activePortionIndex={activePortionIndex}
          onSelectPortion={onSelectPortion}
          onAddPortion={onAddPortion}
          isAddingPortion={isAddingPortion}
          onRemovePortion={onRemovePortion}
          isSubmitting={isSubmitting}
        />
      </div>

      {currentPortion ? (
        <div className="space-y-5">
          {visitDetail.test_mode === 'COMPOSITE' && (
            <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-purple-950 text-xs font-medium flex items-center gap-2.5 shadow-2xs">
              <AlertCircle className="w-4 h-4 text-purple-600 shrink-0" />
              <span>
                <strong>Composite Testing Mode:</strong> 1 portion represents the entire tanker load. An accepted or rejected decision applies to the complete vehicle.
              </span>
            </div>
          )}

          {/* Portion Seal Verification Card - Styled like Dispatch to Plant */}
          <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Tanker Seal Check
                </h3>
              </div>
              {hasDispatchSeal ? (
                isSealMatched ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-2xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Seal Match
                  </span>
                ) : currentEnteredSeal ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300 flex items-center gap-1 shadow-2xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Seal Mismatch
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
                    Verification Required
                  </span>
                )
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                  No Dispatch Seal
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 block uppercase">
                  Dispatch Recorded Seal
                </label>
                <div className="p-3 bg-subtle rounded-xl border border-border-strong font-mono font-bold text-foreground text-sm">
                  {currentPortion.seal_number || 'None (No seal recorded)'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block uppercase">
                  Physical Received Seal (Chemist Check) *
                </label>
                <input
                  type="text"
                  value={enteredSeal}
                  onChange={(e) => onSealChange?.(e.target.value)}
                  placeholder="Enter physical seal number…"
                  className="w-full min-h-[48px] px-3 font-mono font-bold text-sm rounded-xl border border-border-strong bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
                />
              </div>
            </div>
          </div>

          {/* Live Calculated Milk Quality Metrics Summary */}
          <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center space-x-2">
                <Calculator className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Portion Quality Metrics (Live Preview)
                </h3>
              </div>
              {portionCalc.portionQty && (
                <span className="text-xs tabular-nums font-semibold bg-blue-50 text-primary-hover px-2.5 py-0.5 rounded-lg border border-blue-200">
                  Portion Qty: {portionCalc.portionQty.toLocaleString()} KG
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums font-semibold text-slate-700">
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Observed LR</span>
                <span className="text-sm font-bold text-foreground">
                  {portionCalc.lrVal !== null ? portionCalc.lrVal.toFixed(1) : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Observed Fat %</span>
                <span className="text-sm font-bold text-foreground">
                  {portionCalc.fatVal !== null ? `${portionCalc.fatVal.toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Calculated SNF %</span>
                <span className="text-sm font-bold text-foreground">
                  {portionCalc.snf !== null ? `${portionCalc.snf.toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Calculated TS %</span>
                <span className="text-sm font-bold text-foreground">
                  {portionCalc.ts !== null ? `${portionCalc.ts.toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Estimated Density</span>
                <span className="text-xs font-bold text-slate-800">
                  {portionCalc.density !== null ? portionCalc.density.toFixed(4) : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">SNF/Fat Ratio</span>
                <span className="text-xs font-bold text-slate-800">
                  {portionCalc.ratio !== null ? portionCalc.ratio.toFixed(2) : '—'}
                </span>
              </div>
              <div className="col-span-2 p-2.5 rounded-xl bg-subtle border border-border">
                <span className="text-[10px] font-sans text-slate-500 block">Estimated Physical Volume</span>
                <span className="text-xs font-bold text-emerald-800">
                  {portionCalc.grossLiters !== null
                    ? `${Math.round(portionCalc.grossLiters).toLocaleString()} Liters`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {currentPortion.plant_decision === 'REJECTED' && currentPortion.plant_rejection_reason && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold space-y-1">
              <span className="uppercase text-[10px] tracking-wider block text-rose-900 font-bold">
                Portion Rejection Reason
              </span>
              <p>{currentPortion.plant_rejection_reason}</p>
            </div>
          )}

          {/* Plant Lab Observations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Plant Lab Observations ({displayableTests.length} Active Tests)
                </h4>
                <p className="text-xs text-slate-500">Record observations and verification photos for Portion #{currentPortion.portion_number}.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
              {displayableTests.map((test) => (
                <QATestObservationCard
                  key={`plant-test-card-${test.id}`}
                  test={test}
                  state={testInputs[test.id]}
                  portionId={currentPortion.id}
                  tokenNumber={visitDetail.token_number}
                  vehicleNumber={visitDetail.vehicle_number}
                  photoUrl={activePhotos[test.id] || null}
                  onPerformanceStatusChange={onTestPerformanceStatusChange}
                  onNumericChange={onTestNumericChange}
                  onTextChange={onTestTextChange}
                  onReasonChange={onTestReasonChange}
                  onCapturePhoto={handleCapturePhoto}
                  onClearPhoto={handleClearPhoto}
                />
              ))}
            </div>
          </div>

          {/* Accountability Card */}
          <div className="p-4 rounded-xl bg-subtle border border-border-strong space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Mandatory Test Accountability:</span>
              <span className="tabular-nums font-bold">
                {performedCount}/{requiredManualPlantTests.length} Performed · {notPerformedCount} Marked Omitted · {unresolvedCount} Unresolved
              </span>
            </div>
            {!canAccept && (
              <p className="text-xs font-semibold text-amber-800">
                All required manual tests must be either marked PERFORMED with valid observation or explicitly marked NOT PERFORMED before accepting portion.
              </p>
            )}
          </div>

          {/* Decision Rule Panel - Standard decision driver */}
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
            disabled={
              isSubmitting ||
              !currentPortion ||
              currentPortion.plant_decision !== 'PENDING' ||
              (personDecision === 'ACCEPT' && !canAccept)
            }
            showSubmit={true}
          />
        </div>
      ) : null}
    </div>
  );
};
