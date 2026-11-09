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
import { pickRoleTest } from '@/lib/lab-test-roles';
import { QAPortionTabs } from './QAPortionTabs';
import { QAWaitingVisitCard, QAHeldVisitCard } from './QAVisitStatusCards';
import { QATestDrawer } from './QATestDrawer';
import { cn } from '@/lib/utils';
import { SkeletonList } from '@/components/ui/loaders';
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
      // The queue beside this panel already says it is empty.
      return null;
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
      return null;
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
      <SkeletonList count={2} />
    );
  }

  if (!visitDetail) {
    return null;
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
  // "Composite Sample" only while the whole tanker is one portion; with two or more it is Portion 1, Portion 2 ...
  const isSingleComposite = visitDetail?.test_mode === 'COMPOSITE' && portions.length === 1;
  const isAlreadyRoutedToExit = visitDetail?.current_status === 'READY_FOR_GATE_EXIT';
  const isAlreadyRoutedToGross = visitDetail?.current_status === 'READY_FOR_GROSS';
  const showFinishedBanner = isAllDecided || hasEscalation || isAlreadyRoutedToExit || isAlreadyRoutedToGross;

  return (
    <div className="space-y-5 text-foreground">
      {/* Top Context Card */}
      <div className="bg-card border-border p-4 sm:p-5 rounded-2xl border shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <FlaskConical className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-base text-foreground tabular-nums">
                  {visitDetail.vehicle_number}
                </span>
                {visitDetail.token_number && (
                  <span className="font-mono text-xs tabular-nums px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                    {visitDetail.token_number}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-muted text-foreground border border-border">
                  Testing
                </span>
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-muted text-foreground border border-border">
                  {isSingleComposite ? 'Composite' : 'By portion'}
                </span>
              </div>
              <p className="text-xs text-secondary-foreground font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span>
                  Gate entry:{' '}
                  <strong className="tabular-nums font-semibold text-foreground">
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
            <div className="flex items-center space-x-2 bg-muted px-3 py-2 rounded-xl border border-border-strong">
              <span className="text-xs font-semibold text-muted-foreground">Status:</span>
              <span className="text-xs font-semibold text-foreground tabular-nums">
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
          aria-label="QA session decision"
          className={cn(
            'flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border p-4 transition-colors animate-panel-in',
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
              <h4 className="text-sm font-semibold leading-tight">
                {hasEscalation
                  ? 'Waiting for AVP QA reception lab'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'All portions rejected'
                  : 'Quality passed'}
              </h4>
              <p className="text-xs font-medium text-secondary-foreground mt-0.5">
                {hasEscalation
                  ? 'Request sent. This vehicle stays here until the AVP decides every pending portion'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'Vehicle rejected, ready for checkout'
                  : `${acceptedCount} portion(s) accepted, ${rejectedCount} rejected, ready for scale`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {hasEscalation && portions.some((p) => p.manager_review_status === 'PENDING') ? (
              <div className="px-4 py-2 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-700" />
                <span>Pending with AVP QA, vehicle on hold</span>
              </div>
            ) : hasEscalation && onRouteVehicle ? (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('ESCALATE_AVP_QA')}
                className="min-h-11 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <span>Send request to AVP QA reception lab</span>
              </button>
            ) : null}

            {(allRejected || isAlreadyRoutedToExit) && onRouteVehicle && (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('GATE_EXIT')}
                className="min-h-11 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>Send to gate exit</span>
              </button>
            )}

            {hasAccepted && isAllDecided && !hasEscalation && !allRejected && !isAlreadyRoutedToExit && onRouteVehicle && (
              <button
                type="button"
                disabled={isRoutingVehicle}
                onClick={() => onRouteVehicle('WEIGHBRIDGE')}
                className="min-h-11 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isRoutingVehicle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Scale className="w-4 h-4" />
                )}
                <span>Proceed to weighbridge</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Portions Navigation Bar & ZMCC-Style Minimalist Portions Grid */}
      <div className="bg-card border-border p-4 sm:p-5 rounded-2xl border shadow-xs space-y-4">
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

            // LR and Fat are found by stored role (never by a "LR"/"FAT" text match, which also hits the SNF/Fat ratio).
            const roleByTestId = new Map(displayableTests.map((t) => [t.id, t.systemRole ?? null]));
            const savedResults = (p.plant_results ?? []).map((r) => ({
              ...r,
              id: r.testId,
              systemRole: roleByTestId.get(r.testId) ?? null,
            }));
            const lrResult = pickRoleTest(savedResults, 'LR');
            const fatResult = pickRoleTest(savedResults, 'FAT');
            const lrDef = pickRoleTest(displayableTests, 'LR');
            const fatDef = pickRoleTest(displayableTests, 'FAT');
            const activeLr = isSelected && lrDef ? testInputs[lrDef.id]?.numericValue : null;
            const activeFat = isSelected && fatDef ? testInputs[fatDef.id]?.numericValue : null;
            const displayLr = activeLr || (lrResult?.numericValue != null ? String(lrResult.numericValue) : null);
            const displayFat = activeFat || (fatResult?.numericValue != null ? String(fatResult.numericValue) : null);

            return (
              <article
                key={p.id}
                className={cn(
                  'flex flex-col justify-between rounded-2xl border bg-card p-4 transition-colors hover:border-border-strong',
                  isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                )}
              >
                <div className="space-y-2.5">
                  <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
                    <h4 className="text-sm font-semibold text-foreground">
                      {isSingleComposite ? 'Composite sample' : `Portion #${p.portion_number}`}
                    </h4>
                    <span
                      className={cn(
                        'rounded-md px-3 py-0.5 text-xs font-semibold',
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

                  <div className="space-y-1 text-xs text-secondary-foreground">
                    {/* Double-Blind Entry: Quantity hidden from QA */}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Quality:</span>
                      <span className="font-mono tabular-nums font-semibold text-foreground">
                        {displayLr || displayFat
                          ? `LR ${displayLr ?? '—'} · Fat ${displayFat ?? '—'}%`
                          : isSelected
                          ? `${performedCount}/${requiredManualPlantTests.length} tests recorded`
                          : 'Not recorded'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Seal check:</span>
                      <span className="tabular-nums font-medium text-secondary-foreground">
                        {p.seal_number
                          ? isSelected && isSealMatched
                            ? 'Matched'
                            : isSelected && isSealMismatch
                            ? 'Differs'
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
                      'min-h-11 min-w-11 flex w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors',
                      !isCompleted
                        ? 'bg-primary text-white hover:bg-primary-hover'
                        : 'border border-border bg-subtle text-secondary-foreground hover:bg-muted'
                    )}
                  >
                    {!isCompleted ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Test and decide</span>
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
          {isSingleComposite && (
            <div className="bg-card border-border p-4 border rounded-2xl text-foreground text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>
                <strong>Composite testing:</strong> One portion covers the whole tanker. The decision applies to the whole vehicle.
              </span>
            </div>
          )}

          {/* Portion Seal Verification Card - Matching Image 1 */}
          <div className="bg-card border-border p-4 sm:p-5 rounded-2xl border shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold text-secondary-foreground">
                  Seal check
                </h3>
              </div>
              {hasDispatchSeal ? (
                isSealMatched ? (
                  <span className="px-3 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-2xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Seal matches
                  </span>
                ) : currentEnteredSeal ? (
                  <span className="px-3 py-1 rounded-md text-xs font-semibold bg-muted text-secondary-foreground border border-border-strong">
                    Seal differs (optional)
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-md text-xs font-semibold bg-muted text-secondary-foreground">
                    Seal not entered (optional)
                  </span>
                )
              ) : (
                <span className="px-3 py-1 rounded-md text-xs font-semibold bg-muted text-secondary-foreground">
                  No dispatch seal
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground block">
                  Dispatch seal
                </label>
                <div className="bg-card border-border p-3 rounded-xl border font-mono font-semibold text-foreground text-sm">
                  {currentPortion.seal_number || 'None'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-secondary-foreground block">
                  Received seal (optional)
                </label>
                <input
                  type="text"
                  value={enteredSeal}
                  onChange={(e) => onSealChange?.(e.target.value)}
                  placeholder="Physical seal number"
                  className="w-full min-h-12 px-3 font-mono font-semibold text-sm rounded-xl border border-border-strong bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                className="flex min-h-11 items-center gap-2 px-4 py-2 border border-border bg-card text-foreground text-xs font-semibold rounded-lg hover:bg-muted transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Open tests and decision</span>
              </button>
            </div>
          </div>

          {currentPortion.plant_decision === 'REJECTED' && currentPortion.plant_rejection_reason && (
            <div className="bg-card border-border p-4 rounded-2xl border text-rose-800 text-xs font-semibold space-y-1">
              <span className="text-xs block text-rose-900 font-semibold">
                Portion rejection reason
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
