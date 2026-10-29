'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  LogOut,
  Scale,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  FlaskConical,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';
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
import { QAPortionTabs } from './QAPortionTabs';
import { QAWaitingVisitCard, QAHeldVisitCard } from './QAVisitStatusCards';
import { QATestDrawer } from './QATestDrawer';
import { cn } from '@/lib/utils';
import type { User } from '@core/types';

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

  // Drawer and user props:
  currentUser?: User | null;
  onAcceptSubmit?: () => Promise<void> | void;
  onRejectSubmit?: () => Promise<void> | void;
  onRouteVehicle?: (action: 'GATE_EXIT' | 'WEIGHBRIDGE' | 'ESCALATE_AVP_QA') => Promise<void> | void;
  isRoutingVehicle?: boolean;
}

export const QATestingSection: React.FC<QATestingSectionProps> = ({
  activeTab,
  searchQuery: _searchQuery,
  selectedWaitingVisit,
  selectedHeldVisit,
  visitDetail,
  activePortionIndex,
  onSelectPortion,
  isLoadingVisit,
  testInputs,
  onTestPerformanceStatusChange: _onTestPerformanceStatusChange,
  onTestNumericChange,
  onTestTextChange,
  onTestReasonChange: _onTestReasonChange,
  onOpenActionModal,
  requiredManualPlantTests,
  performedCount,
  notPerformedCount: _notPerformedCount,
  unresolvedCount: _unresolvedCount,
  canAccept,
  isSubmitting,
  formatDispatchQty,
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
  currentUser,
  onAcceptSubmit,
  onRejectSubmit,
  onRouteVehicle,
  isRoutingVehicle = false,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [localPhotoStates, setLocalPhotoStates] = useState<Record<string, string>>({});
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

  const { displayableTests, hasDispatchSeal, isSealMatched, currentEnteredSeal, liveDecision } =
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
  const isSealMismatch = hasDispatchSeal && Boolean(currentEnteredSeal) && !isSealMatched;

  if (activeTab === 'WAITING') {
    if (!selectedWaitingVisit) {
      return (
        <div className="p-10 text-center border border-border rounded-xl bg-card space-y-2">
          <div className="w-10 h-10 mx-auto rounded-full bg-muted flex items-center justify-center text-primary">
            <FlaskConical className="w-5 h-5" />
          </div>
          <h3 className="text-xs font-bold text-foreground">Select a vehicle</h3>
          <p className="text-[11px] text-muted-foreground">Pick from queue to test.</p>
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
          Select a vehicle
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
      <div className="bg-card border-border p-12 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
        Loading vehicle testing session…
      </div>
    );
  }

  if (!visitDetail) {
    return (
      <div className="bg-card border-border p-8 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
        Select a session
      </div>
    );
  }

  const portions = visitDetail?.portions || [];
  const isAllDecided =
    portions.length > 0 &&
    portions.every(
      (p) => p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED'
    );
  const allRejected =
    portions.length > 0 && portions.every((p) => p.plant_decision === 'REJECTED');
  const hasAccepted = portions.some((p) => p.plant_decision === 'ACCEPTED');
  const acceptedCount = portions.filter((p) => p.plant_decision === 'ACCEPTED').length;
  const rejectedCount = portions.filter((p) => p.plant_decision === 'REJECTED').length;
  const hasEscalation = portions.some(
    (p) =>
      p.manager_review_status === 'PENDING' ||
      (p.exception_reasons && p.exception_reasons.length > 0 && p.plant_decision === 'PENDING')
  );
  const isAlreadyRoutedToExit = visitDetail?.current_status === 'READY_FOR_GATE_EXIT';
  const isAlreadyRoutedToGross = visitDetail?.current_status === 'READY_FOR_GROSS';
  const showFinishedBanner = isAllDecided || hasEscalation || isAlreadyRoutedToExit || isAlreadyRoutedToGross;

  return (
    <div className="space-y-5 text-foreground">
      {/* Top Context Card */}
      <div className="bg-card border-border p-4 sm:p-5 rounded-xl border shadow-xs space-y-3">
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
                {visitDetail.token_number && (
                  <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                    {visitDetail.token_number}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-muted text-foreground border border-border">
                  Testing Active
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-muted text-foreground border border-border">
                  {visitDetail.test_mode === 'COMPOSITE' ? 'Composite' : 'Portion-Wise'}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-medium mt-0.5 flex items-center gap-1.5 flex-wrap">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Gate Entry:{' '}
                  <strong className="tabular-nums font-semibold text-slate-800">
                    {formatOperationalTime(visitDetail.entry_timestamp)}
                  </strong>
                </span>
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

      {/* Finished & Vehicle Routing Banner matching ZMCC Lab specification */}
      {showFinishedBanner && (
        <div
          role="region"
          aria-label="QA Session Decision Banner"
          className={cn(
            'flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 shadow-2xs transition animate-panel-in',
            hasEscalation
              ? 'border-amber-200 bg-amber-50 text-amber-950'
              : allRejected || isAlreadyRoutedToExit
              ? 'border-rose-200 bg-rose-50 text-rose-950'
              : 'border-emerald-200 bg-emerald-50 text-emerald-950'
          )}
        >
          <div className="flex items-center space-x-3">
            <div
              className={cn(
                'p-2 rounded-lg shrink-0 shadow-2xs',
                hasEscalation
                  ? 'bg-amber-100 text-amber-800'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-emerald-100 text-emerald-800'
              )}
            >
              {hasEscalation ? (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              ) : allRejected || isAlreadyRoutedToExit ? (
                <XCircle className="h-5 w-5" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h4 className="text-sm font-bold leading-tight">
                {hasEscalation
                  ? 'Rule breach detected'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'All portions rejected'
                  : 'Quality passed'}
              </h4>
              <p className="text-xs font-medium text-slate-700 mt-0.5">
                {hasEscalation
                  ? 'Quality exception · AVP QA review required'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'Vehicle rejected · Ready for checkout'
                  : `${acceptedCount} portion(s) accepted, ${rejectedCount} rejected · Ready for scale`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {hasEscalation && onRouteVehicle && (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('ESCALATE_AVP_QA')}
                className="min-h-11 px-4 text-xs font-bold rounded-lg bg-amber-700 text-white hover:bg-amber-800 transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <span>Escalate to AVP QA</span>
              </button>
            )}

            {(allRejected || isAlreadyRoutedToExit) && onRouteVehicle && (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('GATE_EXIT')}
                className="min-h-11 px-4 text-xs font-bold rounded-lg bg-rose-700 text-white hover:bg-rose-800 transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>Send to Gate Exit</span>
              </button>
            )}

            {hasAccepted && !hasEscalation && !allRejected && !isAlreadyRoutedToExit && onRouteVehicle && (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('WEIGHBRIDGE')}
                className="min-h-11 px-4 text-xs font-bold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Scale className="w-4 h-4" />
                )}
                <span>Proceed to Weighbridge</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Portions Navigation Bar & ZMCC-Style Minimalist Portions Grid */}
      <div className="bg-card border-border p-4 sm:p-5 rounded-xl border shadow-xs space-y-4">
        <QAPortionTabs
          visitDetail={visitDetail}
          activePortionIndex={activePortionIndex}
          onSelectPortion={onSelectPortion}
          onAddPortion={onAddPortion}
          isAddingPortion={isAddingPortion}
          onRemovePortion={onRemovePortion}
          isSubmitting={isSubmitting}
        />

        {/* Minimalist Portions Grid Overview identical to ZMCC Lab Station */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-1">
          {visitDetail.portions.map((p, idx) => {
            const isCompleted = p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED';
            const isSelected = activePortionIndex === idx;
            const _portionQty = formatDispatchQty(p);

            const lrResult = p.plant_results?.find(
              (r) => r.testName?.toUpperCase().includes('LR') || r.testCode?.toUpperCase().includes('LR')
            );
            const fatResult = p.plant_results?.find(
              (r) => r.testName?.toUpperCase().includes('FAT') || r.testCode?.toUpperCase().includes('FAT')
            );
            const activeLr = isSelected
              ? displayableTests.find(
                  (t) => t.testName?.toUpperCase().includes('LR') || t.testCode?.toUpperCase().includes('LR')
                )?.id
                ? testInputs[
                    displayableTests.find(
                      (t) => t.testName?.toUpperCase().includes('LR') || t.testCode?.toUpperCase().includes('LR')
                    )!.id
                  ]?.numericValue
                : null
              : null;
            const activeFat = isSelected
              ? displayableTests.find(
                  (t) => t.testName?.toUpperCase().includes('FAT') || t.testCode?.toUpperCase().includes('FAT')
                )?.id
                ? testInputs[
                    displayableTests.find(
                      (t) => t.testName?.toUpperCase().includes('FAT') || t.testCode?.toUpperCase().includes('FAT')
                    )!.id
                  ]?.numericValue
                : null
              : null;
            const displayLr = activeLr || (lrResult?.numericValue != null ? String(lrResult.numericValue) : null);
            const displayFat = activeFat || (fatResult?.numericValue != null ? String(fatResult.numericValue) : null);

            return (
              <article
                key={p.id}
                className={cn(
                  'flex flex-col justify-between rounded-xl border bg-card p-4 shadow-2xs transition hover:border-slate-300',
                  isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                )}
              >
                <div className="space-y-2.5">
                  <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      {visitDetail.test_mode === 'COMPOSITE' ? 'Composite Sample' : `Portion #${p.portion_number}`}
                    </h4>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        p.plant_decision === 'ACCEPTED'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                          : p.plant_decision === 'REJECTED'
                          ? 'bg-rose-50 text-rose-800 border border-rose-300'
                          : 'bg-amber-50 text-amber-800 border border-amber-300'
                      )}
                    >
                      {p.plant_decision === 'ACCEPTED'
                        ? 'Accepted'
                        : p.plant_decision === 'REJECTED'
                        ? 'Rejected'
                        : 'Pending'}
                    </span>
                  </header>

                  <div className="space-y-1 text-xs text-slate-600">
                    {/* Double-Blind Entry: Quantity hidden from QA */}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Quality:</span>
                      <span className="tabular-nums font-semibold text-slate-800">
                        {displayLr || displayFat
                          ? `LR ${displayLr ?? '—'} · Fat ${displayFat ?? '—'}%`
                          : isSelected
                          ? `${performedCount}/${requiredManualPlantTests.length} tests recorded`
                          : 'Not recorded'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Seal check:</span>
                      <span className="tabular-nums font-medium text-slate-700">
                        {p.seal_number
                          ? isSelected && isSealMatched
                            ? 'Matched'
                            : isSelected && isSealMismatch
                            ? 'Mismatch'
                            : p.seal_number
                          : 'No dispatch seal'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPortion(idx);
                      setIsDrawerOpen(true);
                    }}
                    className={cn(
                      'min-h-11 min-w-11 flex w-full items-center justify-center gap-1.5 rounded-lg text-sm font-semibold shadow-2xs transition',
                      !isCompleted
                        ? 'bg-primary text-white hover:bg-primary-hover'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    )}
                  >
                    {!isCompleted ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Test & Decide</span>
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5" />
                        <span>View details</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {currentPortion ? (
        <div className="space-y-5">
          {visitDetail.test_mode === 'COMPOSITE' && (
            <div className="bg-card border-border p-3.5 border rounded-xl text-purple-950 text-xs font-medium flex items-center gap-2.5 shadow-2xs">
              <AlertCircle className="w-4 h-4 text-purple-600 shrink-0" />
              <span>
                <strong>Composite Testing Mode:</strong> 1 portion represents the entire tanker load. An accepted or rejected decision applies to the complete vehicle.
              </span>
            </div>
          )}

          {/* Portion Seal Verification Card - Matching Image 1 */}
          <div className="bg-card border-border p-4 sm:p-5 rounded-xl border shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Seal check
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
                  Dispatch seal
                </label>
                <div className="bg-card border-border p-3 rounded-xl border font-mono font-bold text-foreground text-sm">
                  {currentPortion.seal_number || 'None'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block uppercase">
                  Received seal *
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

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-2xs hover:bg-primary-hover transition"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Open Tests & Decision Drawer</span>
              </button>
            </div>
          </div>

          {currentPortion.plant_decision === 'REJECTED' && currentPortion.plant_rejection_reason && (
            <div className="bg-card border-border p-4 rounded-xl border text-rose-800 text-xs font-semibold space-y-1">
              <span className="uppercase text-[10px] tracking-wider block text-rose-900 font-bold">
                Portion Rejection Reason
              </span>
              <p>
                {isSuperior || ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'QA_HEAD'].includes(currentUser?.role || '')
                  ? currentPortion.plant_rejection_reason
                  : currentPortion.plant_rejection_reason
                      .replace(/super admin/gi, 'Authorized Management')
                      .replace(/avp absent/gi, 'Authorized Management')
                      .replace(/override/gi, 'Authorization')}
              </p>
            </div>
          )}

          {/* QATestDrawer - Drawer on mobile, centered modal on desktop matching Image 2 */}
          <QATestDrawer
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            visitDetail={visitDetail}
            portion={currentPortion}
            displayableTests={displayableTests}
            testInputs={testInputs}
            onTestNumericChange={onTestNumericChange}
            onTestTextChange={onTestTextChange}
            enteredSeal={enteredSeal}
            onSealChange={(val) => onSealChange?.(val)}
            photoStates={activePhotos}
            onPhotoChange={(testId, url) => {
              if (url) {
                handleCapturePhoto(testId, url);
              } else {
                handleClearPhoto(testId);
              }
            }}
            personDecision={personDecision}
            onPersonDecisionChange={onPersonDecisionChange}
            decisionRemarks={decisionRemarks}
            onDecisionRemarksChange={onDecisionRemarksChange}
            canAccept={canAccept}
            performedCount={performedCount}
            requiredManualPlantTests={requiredManualPlantTests}
            liveDecision={liveDecision}
            onAcceptSubmit={async () => {
              if (onAcceptSubmit) {
                await onAcceptSubmit();
                setIsDrawerOpen(false);
              } else {
                onOpenActionModal('ACCEPT');
              }
            }}
            onRejectSubmit={async () => {
              if (onRejectSubmit) {
                await onRejectSubmit();
                setIsDrawerOpen(false);
              } else {
                onOpenActionModal('REJECT');
              }
            }}
            isSubmitting={isSubmitting}
            currentUser={currentUser}
          />
        </div>
      ) : null}
    </div>
  );
};
