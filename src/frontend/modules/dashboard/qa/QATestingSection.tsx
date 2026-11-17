'use client';

import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  XCircle,
  LogOut,
  Scale,
  Loader2,
  AlertTriangle,
  Clock,
  FlaskConical,
  Edit3,
  PlusCircle,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';
import { HorizontalScrollRow } from '@/components/ui/horizontal-scroll-row';
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
import { computePortionLiveDecision, useQADecisionPreview } from './useQADecisionPreview';
import { isCalculatedTest, pickRoleTest } from '@/lib/lab-test-roles';
import { milkQualityFromLrFat } from '@/backend/utils/milkFormulas';
import { BriefText } from '@/components/ui/brief-text';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { InfoTip } from '@/components/ui/info-tip';
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
  testInputsByPortion?: Record<string, Record<string, TestInputState>>;
  savedPortionsMap?: Record<string, boolean>;
  onSavePortionMap?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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
  onModeSwitch?: (mode: 'COMPOSITE' | 'PORTION_WISE') => Promise<void> | void;
  isSwitchingMode?: boolean;
  onAddPortion?: () => void;
  isAddingPortion?: boolean;
  onRemovePortion?: (portionId: string, portionNumber: number) => void;
  isRemovingPortion?: boolean;

  // Per-portion maps + active portion accessors
  enteredSealMap?: Record<string, string>;
  photoStatesMap?: Record<string, Record<string, string>>;
  personDecisionMap?: Record<string, PersonDecision | null>;
  decisionRemarksMap?: Record<string, string>;
  enteredSeal?: string;
  onSealChange?: (val: string) => void;
  photoStates?: Record<string, string>;
  onPhotoChange?: (testId: string, url: string | null) => void;
  personDecision?: PersonDecision | null;
  onPersonDecisionChange?: (d: PersonDecision) => void;
  decisionRemarks?: string;
  onDecisionRemarksChange?: (val: string) => void;
  isSuperior?: boolean;

  // Drawer and vehicle batch submit props
  currentUser?: User | null;
  onAcceptSubmit?: () => Promise<void> | void;
  onRejectSubmit?: () => Promise<void> | void;
  onSubmitAllPortions?: () => Promise<boolean | void> | void;
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
  testInputsByPortion,
  savedPortionsMap = {},
  onSavePortionMap,
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
  formatDispatchQty: _formatDispatchQty,
  onModeSwitch,
  isSwitchingMode = false,
  onAddPortion,
  isAddingPortion = false,
  onRemovePortion,
  isRemovingPortion = false,
  enteredSealMap = {},
  photoStatesMap = {},
  personDecisionMap = {},
  decisionRemarksMap = {},
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
  onSubmitAllPortions,
  onRouteVehicle,
  isRoutingVehicle = false,
}) => {
  void _searchQuery;
  void _onTestPerformanceStatusChange;
  void _onTestReasonChange;
  void _notPerformedCount;
  void _unresolvedCount;
  void _formatDispatchQty;

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
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

  const { displayableTests, liveDecision } = useQADecisionPreview({
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

  const cloakNote = (note: string) => {
    if (
      isSuperior ||
      ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'QA_HEAD'].includes(
        currentUser?.role || ''
      )
    ) {
      return note;
    }
    return note
      .replace(/super admin/gi, 'Authorized Management')
      .replace(/avp absent/gi, 'Authorized Management')
      .replace(/override/gi, 'Authorization');
  };

  const testMode: 'COMPOSITE' | 'PORTION_WISE' = visitDetail?.test_mode === 'COMPOSITE' ? 'COMPOSITE' : 'PORTION_WISE';

  const evaluatedPortions = useMemo(() => {
    if (!visitDetail) return [];
    const allPortions = visitDetail.portions || [];
    const visible = testMode === 'COMPOSITE' ? allPortions.slice(0, 1) : allPortions;
    const roleByTestId = new Map(displayableTests.map((t) => [t.id, t.systemRole ?? null]));
    const lrDef = pickRoleTest(displayableTests, 'LR');
    const fatDef = pickRoleTest(displayableTests, 'FAT');

    return visible.map((p) => {
      const realIdx = allPortions.findIndex((x) => x.id === p.id);
      const isDecided = p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED';
      const isPendingReview = p.manager_review_status === 'PENDING';
      const isServerSubmitted = isDecided || isPendingReview;
      const isSaved = isServerSubmitted || Boolean(savedPortionsMap[p.id]);

      const pInputs = testInputsByPortion?.[p.id] ?? (currentPortion?.id === p.id ? testInputs : {});
      const pPhotos = photoStatesMap[p.id] ?? (currentPortion?.id === p.id ? activePhotos : {});
      const pSeal = (enteredSealMap[p.id] ?? (currentPortion?.id === p.id ? enteredSeal : p.plant_seal_number_entered) ?? '').trim();
      const pChoice = personDecisionMap[p.id] ?? (currentPortion?.id === p.id ? personDecision : null);
      const pRemarks = decisionRemarksMap[p.id] ?? (currentPortion?.id === p.id ? decisionRemarks : '');

      const savedWithRoles = (p.plant_results ?? []).map((r) => ({
        ...r,
        id: r.testId,
        systemRole: roleByTestId.get(r.testId) ?? null,
      }));
      const lrSaved = pickRoleTest(savedWithRoles, 'LR')?.numericValue ?? null;
      const fatSaved = pickRoleTest(savedWithRoles, 'FAT')?.numericValue ?? null;
      const lrTyped = lrDef && pInputs[lrDef.id]?.numericValue !== '' ? Number(pInputs[lrDef.id]?.numericValue) : null;
      const fatTyped = fatDef && pInputs[fatDef.id]?.numericValue !== '' ? Number(pInputs[fatDef.id]?.numericValue) : null;
      const lrVal = isServerSubmitted ? lrSaved : lrTyped !== null && Number.isFinite(lrTyped) ? lrTyped : lrSaved;
      const fatVal = isServerSubmitted ? fatSaved : fatTyped !== null && Number.isFinite(fatTyped) ? fatTyped : fatSaved;
      const qual = milkQualityFromLrFat(lrVal, fatVal);

      const performedRequiredCount = requiredManualPlantTests.filter((t) => {
        if (isServerSubmitted) {
          return p.plant_results.some((pr) => pr.testId === t.id && pr.performanceStatus === 'PERFORMED');
        }
        const st = pInputs[t.id];
        if (!st || st.performanceStatus === 'NOT_PERFORMED') return false;
        if (t.resultType === 'NUMERIC') return st.numericValue !== '' && Number.isFinite(Number(st.numericValue));
        return Boolean(st.textValue && st.textValue.trim() !== '');
      }).length;

      const hasAnyPerformedTest = displayableTests.some((t) => {
        if (isCalculatedTest(t as LabTestDef & { formulaId?: unknown })) return false;
        const st = pInputs[t.id];
        if (!st || st.performanceStatus === 'NOT_PERFORMED') return false;
        if (t.resultType === 'NUMERIC') return st.numericValue !== '' && Number.isFinite(Number(st.numericValue));
        return Boolean(st.textValue && st.textValue.trim() !== '');
      });

      const live = computePortionLiveDecision({
        displayableTests,
        requiredManualPlantTests,
        testInputs: pInputs,
        activePhotos: pPhotos,
        personDecision: pChoice,
        decisionRemarks: pRemarks,
        isSuperior,
      });

      const mustRequestAvp = isServerSubmitted
        ? isPendingReview
        : // A superior decides their own exception here (DECIDE_NOW), so nothing is sent to AVP QA.
          Boolean(pChoice && live.decision.route === 'SEND_TO_APPROVER');

      let validationErr: string | null = null;
      if (!isServerSubmitted && isSaved) {
        if (!pChoice) validationErr = 'Choose Accept or Reject.';
        else if (pChoice === 'REJECT' && !hasAnyPerformedTest) validationErr = 'Record at least one test measurement before rejecting.';
        else if ((pChoice === 'REJECT' || mustRequestAvp || live.decision.remarksRequired) && pRemarks.trim().length < 3) validationErr = 'Add remarks (3 letters minimum).';
      }

      return {
        portion: p,
        realIdx,
        isDecided,
        isPendingReview,
        isServerSubmitted,
        isSaved,
        pSeal,
        pChoice,
        pRemarks,
        lrVal,
        fatVal,
        snf: qual?.snf ?? null,
        ts: qual?.ts ?? null,
        performedRequiredCount,
        mustRequestAvp,
        live,
        validationErr,
      };
    });
  }, [
    visitDetail,
    testMode,
    displayableTests,
    savedPortionsMap,
    testInputsByPortion,
    currentPortion?.id,
    testInputs,
    photoStatesMap,
    activePhotos,
    enteredSealMap,
    enteredSeal,
    personDecisionMap,
    personDecision,
    decisionRemarksMap,
    decisionRemarks,
    requiredManualPlantTests,
    isSuperior,
  ]);

  const vehicleReview = useMemo(() => {
    const isSingleComposite = testMode === 'COMPOSITE';
    const pendingItems = evaluatedPortions.filter((x) => !x.isServerSubmitted);
    const notReadyLines: string[] = [];
    const approverLines: string[] = [];

    for (const item of pendingItems) {
      const label = isSingleComposite ? 'Composite Sample' : `Portion ${item.portion.portion_number}`;
      if (!item.isSaved) {
        notReadyLines.push(`${label} is not saved yet.`);
        continue;
      }
      if (item.validationErr) {
        notReadyLines.push(`${label}: ${item.validationErr}`);
      }
      if (item.mustRequestAvp) {
        const prefix = evaluatedPortions.length > 1 ? `${label}: ` : '';
        if (item.live.reasons.length > 0) {
          for (const r of item.live.reasons) {
            approverLines.push(`${prefix}${r}`);
          }
        } else {
          approverLines.push(`${prefix}Needs AVP QA approval.`);
        }
      }
    }

    const goesToAvp = approverLines.length > 0;
    const allRejectedClear =
      !goesToAvp &&
      evaluatedPortions.length > 0 &&
      evaluatedPortions.every((x) =>
        x.isServerSubmitted ? x.portion.plant_decision === 'REJECTED' : x.isSaved && x.pChoice === 'REJECT'
      );
    const whyLines = notReadyLines.length > 0 ? notReadyLines : approverLines;
    return {
      pendingItems,
      notReadyLines,
      approverLines,
      goesToAvp,
      allRejectedClear,
      whyLines,
      showWarning: whyLines.length > 0,
    };
  }, [evaluatedPortions, testMode]);

  if (activeTab === 'WAITING') {
    if (!selectedWaitingVisit) {
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
    return <SkeletonList count={2} />;
  }

  if (!visitDetail) {
    return null;
  }

  const portions = visitDetail.portions || [];
  const effectivePortions = testMode === 'COMPOSITE' ? portions.slice(0, 1) : portions;
  const isAllDecided =
    effectivePortions.length > 0 &&
    effectivePortions.every((p) => p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED');
  const allRejected =
    effectivePortions.length > 0 && effectivePortions.every((p) => p.plant_decision === 'REJECTED');
  const hasAccepted = effectivePortions.some((p) => p.plant_decision === 'ACCEPTED');
  const acceptedCount = effectivePortions.filter((p) => p.plant_decision === 'ACCEPTED').length;
  const rejectedCount = effectivePortions.filter((p) => p.plant_decision === 'REJECTED').length;
  const hasEscalation = effectivePortions.some(
    (p) =>
      p.manager_review_status === 'PENDING' ||
      (p.exception_reasons && p.exception_reasons.length > 0 && p.plant_decision === 'PENDING')
  );
  const isSingleComposite = testMode === 'COMPOSITE';
  const isAlreadyRoutedToExit = visitDetail.current_status === 'READY_FOR_GATE_EXIT';
  const isAlreadyRoutedToGross = visitDetail.current_status === 'READY_FOR_GROSS';
  const showFinishedBanner = isAllDecided || hasEscalation || isAlreadyRoutedToExit || isAlreadyRoutedToGross;
  const hasAnyServerSubmitted = portions.some(
    (p) =>
      p.plant_decision === 'ACCEPTED' ||
      p.plant_decision === 'REJECTED' ||
      p.manager_review_status === 'PENDING'
  );
  const allPortionsSubmitted =
    effectivePortions.length > 0 &&
    effectivePortions.every(
      (p) =>
        p.plant_decision === 'ACCEPTED' ||
        p.plant_decision === 'REJECTED' ||
        p.manager_review_status === 'PENDING'
    );
  const isModeAndAddLocked = hasAnyServerSubmitted || showFinishedBanner;
  const canMutateUnsubmittedPortions = !isAlreadyRoutedToExit && !isAlreadyRoutedToGross && !isAllDecided;
  const isVehicleLocked = allPortionsSubmitted || !canMutateUnsubmittedPortions;

  const handleOpenVehicleReview = () => {
    const firstUnsavedOrInvalid = evaluatedPortions.find(
      (x) => !x.isServerSubmitted && (!x.isSaved || x.validationErr)
    );
    if (firstUnsavedOrInvalid) {
      setShowWhy(true);
      onSelectPortion(firstUnsavedOrInvalid.realIdx);
      setIsDrawerOpen(true);
      return;
    }
    setReviewOpen(true);
  };

  return (
    <div className="space-y-5 text-foreground">
      {/* Top Context Card */}
      <div className="bg-card border-border p-4 sm:p-5 rounded-2xl border shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <FlaskConical className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
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
                  {isSingleComposite ? 'Composite' : 'Portion-wise'}
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
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <div data-badge="" className="inline-flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-xl border border-border-strong whitespace-nowrap shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">Status:</span>
              <span className="text-xs font-semibold text-foreground tabular-nums">
                {visitDetail.visit_decision_summary}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Test Mode Selector: Composite vs Portion-wise (matches Dispatch to Plant) */}
      {!showFinishedBanner && (
        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border-strong shadow-xs space-y-2">
          <label className="block text-xs font-semibold text-secondary-foreground">Test mode</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isModeAndAddLocked || isSwitchingMode || isSubmitting || isAddingPortion || isRemovingPortion}
              onClick={() => void onModeSwitch?.('COMPOSITE')}
              className={cn(
                'px-3 py-2 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-11',
                testMode === 'COMPOSITE'
                  ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                  : 'border-border text-secondary-foreground hover:bg-muted',
                (isModeAndAddLocked || isSwitchingMode) && 'opacity-60 cursor-not-allowed'
              )}
            >
              <span>Composite</span>
              <span className="text-xs font-normal text-muted-foreground">One portion</span>
            </button>
            <button
              type="button"
              disabled={isModeAndAddLocked || isSwitchingMode || isSubmitting || isAddingPortion || isRemovingPortion}
              onClick={() => void onModeSwitch?.('PORTION_WISE')}
              className={cn(
                'px-3 py-2 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-11',
                testMode === 'PORTION_WISE'
                  ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                  : 'border-border text-secondary-foreground hover:bg-muted',
                (isModeAndAddLocked || isSwitchingMode) && 'opacity-60 cursor-not-allowed'
              )}
            >
              <span>Portion-wise</span>
              <span className="text-xs font-normal text-muted-foreground">Per portion</span>
            </button>
          </div>
        </div>
      )}

      {/* Finished & Vehicle Routing Banner */}
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
            <div className="flex items-center gap-1">
              <h4 className="text-sm font-semibold leading-tight">
                {hasEscalation
                  ? 'Waiting for AVP QA'
                  : allRejected || isAlreadyRoutedToExit
                  ? 'All portions rejected'
                  : 'Quality passed'}
              </h4>
              <InfoTip
                label="Status details"
                className="-my-2"
                text={
                  hasEscalation
                    ? 'Request sent. This vehicle stays here until the AVP decides every pending portion.'
                    : allRejected || isAlreadyRoutedToExit
                    ? 'Vehicle rejected, ready for checkout.'
                    : `${acceptedCount} portion(s) accepted, ${rejectedCount} rejected, ready for scale.`
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {hasEscalation && portions.some((p) => p.manager_review_status === 'PENDING') ? (
              <div className="px-4 py-2 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-700" />
                <span>With AVP QA. On hold.</span>
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
                <span>Send to AVP QA</span>
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

      {/* Milk Portions (N) Header + List (matches Dispatch to Plant) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">
            Milk Portions ({evaluatedPortions.length})
          </h3>

          {!isModeAndAddLocked && testMode === 'PORTION_WISE' && onAddPortion && (
            <button
              type="button"
              disabled={isAddingPortion || isSubmitting}
              onClick={onAddPortion}
              className="flex items-center space-x-1.5 min-h-12 px-4 rounded-xl bg-primary-hover text-white text-sm font-semibold shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
            >
              {isAddingPortion ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PlusCircle className="w-4 h-4" />
              )}
              <span>+ Add Portion</span>
            </button>
          )}
        </div>

        <div className="space-y-3.5">
          {evaluatedPortions.map((item) => {
            const p = item.portion;
            const label = isSingleComposite ? 'Composite Sample' : `Portion ${p.portion_number}`;
            const isReject = item.isServerSubmitted ? p.plant_decision === 'REJECTED' : item.pChoice === 'REJECT';

            if (!item.isSaved && !item.isServerSubmitted) {
              const wasReturnedByAvp = p.manager_review_status === 'REJECTED' && p.plant_decision === 'PENDING';
              return (
                <div key={p.id} className="space-y-1.5">
                  {wasReturnedByAvp && (
                    <div className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                      <span className="font-semibold">Returned by AVP QA</span>
                      <InfoTip
                        label="AVP QA remarks"
                        className="-my-2"
                        text={
                          p.manager_review_reason
                            ? `"${cloakNote(p.manager_review_reason)}"`
                            : 'Re-test or revise decision.'
                        }
                      />
                    </div>
                  )}
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPortion(item.realIdx);
                        setIsDrawerOpen(true);
                      }}
                      className="flex flex-1 min-h-14 items-center justify-between rounded-xl border border-dashed border-action/40 bg-action-soft px-4 text-left text-sm font-semibold text-action hover:bg-action/10 transition"
                    >
                      <span>{label}: enter seal, tests and decision</span>
                      <Edit3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </button>
                    {canMutateUnsubmittedPortions && evaluatedPortions.length > 1 && onRemovePortion && (
                      <button
                        type="button"
                        disabled={isRemovingPortion || isSubmitting}
                        onClick={() => onRemovePortion(p.id, p.portion_number)}
                        aria-label={`Cancel ${label}`}
                        title={`Cancel ${label}`}
                        className="min-h-14 min-w-14 shrink-0 inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                      >
                        {isRemovingPortion ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-5 w-5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={p.id}
                className={cn(
                  'p-4 rounded-2xl bg-card border shadow-xs space-y-3 transition',
                  item.validationErr ? 'border-rose-300' : 'border-border-strong'
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <div className="bg-card border-border border p-2 rounded-xl shrink-0">
                      {isReject ? (
                        <XCircle className="w-4 h-4 text-rose-700" />
                      ) : item.mustRequestAvp ? (
                        <AlertTriangle className="w-4 h-4 text-amber-700" />
                      ) : (
                        <Check className="w-4 h-4 stroke-3 text-emerald-800" />
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{label}</span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-lg text-xs font-semibold border',
                            isReject
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : item.mustRequestAvp
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          )}
                        >
                          {item.isPendingReview
                            ? 'With AVP QA'
                            : p.plant_decision === 'ACCEPTED'
                            ? 'Accepted'
                            : p.plant_decision === 'REJECTED'
                            ? 'Rejected'
                            : isReject
                            ? 'Reject'
                            : item.mustRequestAvp
                            ? 'Needs AVP QA'
                            : 'Accept'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-secondary-foreground mt-0.5">
                        Seal: <span className="tabular-nums font-semibold">{item.pSeal || p.seal_number || '—'}</span> ·{' '}
                        {item.performedRequiredCount}/{requiredManualPlantTests.length} must-do tests
                      </p>
                      {item.validationErr && (
                        <p className="text-xs font-semibold text-rose-700 mt-0.5">{item.validationErr}</p>
                      )}
                      {p.manager_review_status === 'REJECTED' && p.plant_decision === 'PENDING' && (
                        <div className="inline-flex items-center text-xs font-semibold text-amber-800 mt-0.5">
                          <span>Returned by AVP QA</span>
                          <InfoTip
                            label="AVP QA remarks"
                            className="-my-2"
                            text={p.manager_review_reason ? `"${cloakNote(p.manager_review_reason)}"` : 'Re-test or revise decision.'}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPortion(item.realIdx);
                        setIsDrawerOpen(true);
                      }}
                      className="min-h-11 min-w-11 flex items-center space-x-1 h-9 px-3 rounded-lg bg-card border border-border-strong text-xs font-semibold text-primary-hover hover:bg-blue-50 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{item.isServerSubmitted ? 'View' : 'Edit'}</span>
                    </button>

                    {!item.isServerSubmitted && canMutateUnsubmittedPortions && evaluatedPortions.length > 1 && onRemovePortion && (
                      <button
                        type="button"
                        disabled={isRemovingPortion || isSubmitting}
                        onClick={() => onRemovePortion(p.id, p.portion_number)}
                        className="min-h-11 min-w-11 flex items-center space-x-1 h-9 px-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Quality Summary Strip (LR, Fat %, SNF %, TS %) */}
                <HorizontalScrollRow className="pt-2 border-t border-border">
                  <div className="flex items-stretch gap-2 min-w-max text-xs tabular-nums font-semibold text-secondary-foreground">
                    <div className="min-w-20.5 flex-1 bg-card border-border p-2.5 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">LR</span>
                      <span className="text-foreground">{item.lrVal !== null ? item.lrVal.toFixed(1) : '—'}</span>
                    </div>
                    <div className="min-w-20.5 flex-1 bg-card border-border p-2.5 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">Fat %</span>
                      <span className="text-foreground">{item.fatVal !== null ? `${item.fatVal.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div className="min-w-20.5 flex-1 bg-card border-border p-2.5 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">SNF %</span>
                      <span className="text-foreground">{item.snf !== null ? `${item.snf.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div className="min-w-20.5 flex-1 bg-card border-border p-2.5 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">TS %</span>
                      <span className="text-emerald-900 font-semibold">{item.ts !== null ? `${item.ts.toFixed(2)}%` : '—'}</span>
                    </div>
                  </div>
                </HorizontalScrollRow>

                {p.plant_decision === 'REJECTED' && p.plant_rejection_reason && (
                  <div className="text-xs font-semibold text-rose-800 pt-1">
                    <BriefText text={cloakNote(p.plant_rejection_reason)} label="Rejection reason" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Vehicle-Level Warning Details & Bottom Action Bar */}
      {!isVehicleLocked && vehicleReview.pendingItems.length > 0 && (
        <div className="space-y-3 pt-1">
          {vehicleReview.showWarning && showWhy && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
              <div className="font-semibold">
                {vehicleReview.notReadyLines.length > 0 ? 'Not ready yet' : 'Why this goes to AVP QA'}
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {vehicleReview.whyLines.map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex w-full items-stretch justify-end gap-2">
            {vehicleReview.showWarning && (
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                aria-label="Needs attention"
                aria-expanded={showWhy}
                className="flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 text-amber-600 transition hover:bg-amber-100 active:scale-[0.97] active:bg-amber-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
              >
                <AlertTriangle className="h-6 w-6" />
              </button>
            )}
            <Button
              type="button"
              variant={vehicleReview.allRejectedClear ? 'destructive' : 'default'}
              size="lg"
              loading={isSubmitting}
              loadingText="Submitting…"
              disabled={isSubmitting || isAddingPortion || isRemovingPortion || isSwitchingMode}
              onClick={handleOpenVehicleReview}
              className="min-h-14 h-auto min-w-0 flex-1 shrink whitespace-normal rounded-xl px-5 py-2.5 text-base font-semibold sm:flex-initial sm:min-w-65 sm:px-8"
            >
              {vehicleReview.goesToAvp ? (
                <AlertTriangle className="h-4 w-4" />
              ) : vehicleReview.allRejectedClear ? (
                <XCircle className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>
                {vehicleReview.goesToAvp
                  ? 'Review & Send Request to AVP QA'
                  : vehicleReview.allRejectedClear
                    ? 'Review & Reject Vehicle'
                    : 'Review & Submit QA Decision'}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* Post-Decision Bottom Routing Bar (matches submit button position once portions are finalized) */}
      {showFinishedBanner && isAllDecided && !hasEscalation && !isAlreadyRoutedToGross && !isAlreadyRoutedToExit && onRouteVehicle && (
        <div className="flex w-full justify-end pt-1">
          {allRejected ? (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              loading={isRoutingVehicle}
              loadingText="Sending to gate exit…"
              disabled={isRoutingVehicle}
              onClick={() => onRouteVehicle('GATE_EXIT')}
              className="min-h-14 h-auto min-w-0 flex-1 shrink whitespace-normal rounded-xl px-5 py-2.5 text-base font-semibold sm:flex-initial sm:min-w-65 sm:px-8"
            >
              <LogOut className="h-5 w-5" />
              <span>Send to Gate Exit</span>
            </Button>
          ) : hasAccepted ? (
            <Button
              type="button"
              variant="default"
              size="lg"
              loading={isRoutingVehicle}
              loadingText="Proceeding to weighbridge…"
              disabled={isRoutingVehicle}
              onClick={() => onRouteVehicle('WEIGHBRIDGE')}
              className="min-h-14 h-auto min-w-0 flex-1 shrink whitespace-normal rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-semibold text-white hover:bg-emerald-800 sm:flex-initial sm:min-w-65 sm:px-8"
            >
              <Scale className="h-5 w-5" />
              <span>Proceed to Weighbridge</span>
            </Button>
          ) : null}
        </div>
      )}

      {/* Vehicle-Level Review and Decide Drawer */}
      <Drawer open={reviewOpen} onOpenChange={setReviewOpen} dismissible={!isSubmitting}>
        <DrawerContent>
          <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-2 sm:px-5">
            <div>
              <DrawerTitle>Review and decide</DrawerTitle>
              <p className="text-xs text-muted-foreground font-medium">
                Vehicle: <strong className="text-foreground">{visitDetail.vehicle_number}</strong> ·{' '}
                {isSingleComposite ? 'Composite' : `Portion-wise (${evaluatedPortions.length})`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              disabled={isSubmitting}
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-secondary-foreground disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
            <div
              className={cn(
                'flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs',
                vehicleReview.goesToAvp
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : vehicleReview.allRejectedClear
                    ? 'border-rose-300 bg-rose-50 text-rose-950'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950'
              )}
            >
              <span className="font-semibold text-sm">
                {vehicleReview.goesToAvp
                  ? 'Goes to AVP QA'
                  : vehicleReview.allRejectedClear
                    ? 'Ready to reject'
                    : 'Ready to submit'}
              </span>
              <InfoTip
                label="Submission details"
                className="-my-2"
                text={
                  vehicleReview.goesToAvp
                    ? `All ${vehicleReview.pendingItems.length} portion(s) will be sent together for AVP QA review.`
                    : vehicleReview.allRejectedClear
                      ? `All ${vehicleReview.pendingItems.length} portion(s) are marked Reject in line with test results.`
                      : `All ${vehicleReview.pendingItems.length} portion(s) will be completed and ready for routing.`
                }
              />
            </div>

            <div className="space-y-2.5">
              {evaluatedPortions.map((item) => {
                const label = isSingleComposite ? 'Composite Sample' : `Portion ${item.portion.portion_number}`;
                const isReject = item.isServerSubmitted ? item.portion.plant_decision === 'REJECTED' : item.pChoice === 'REJECT';
                return (
                  <div key={item.portion.id} className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-md font-semibold border',
                            isReject
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : item.mustRequestAvp
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          )}
                        >
                          {isReject ? 'Reject' : 'Accept'}
                          {item.mustRequestAvp ? ' · Needs AVP QA' : ''}
                        </span>
                        {item.mustRequestAvp && item.live.reasons.length > 0 && (
                          <InfoTip
                            label="Why it goes to AVP QA"
                            className="-my-2"
                            text={
                              <ul className="list-disc space-y-1 pl-4">
                                {item.live.reasons.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="text-muted-foreground">
                      Seal: <strong className="text-foreground tabular-nums">{item.pSeal || item.portion.seal_number || '—'}</strong>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs tabular-nums">
                      <div>
                        <span className="text-muted-foreground block">LR</span>
                        <strong className="text-foreground">{item.lrVal !== null ? item.lrVal.toFixed(1) : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Fat</span>
                        <strong className="text-foreground">{item.fatVal !== null ? `${item.fatVal.toFixed(2)}%` : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">SNF</span>
                        <strong className="text-foreground">{item.snf !== null ? `${item.snf.toFixed(2)}%` : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">TS</span>
                        <strong className="text-foreground">{item.ts !== null ? `${item.ts.toFixed(2)}%` : '—'}</strong>
                      </div>
                    </div>

                    {item.pRemarks && (
                      <div className="text-secondary-foreground">
                        <BriefText text={item.pRemarks} label="Remarks" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant={vehicleReview.allRejectedClear ? 'destructive' : 'default'}
                size="lg"
                loading={isSubmitting}
                loadingText="Submitting…"
                disabled={isSubmitting || vehicleReview.pendingItems.length === 0}
                onClick={async () => {
                  if (onSubmitAllPortions) {
                    const ok = await onSubmitAllPortions();
                    if (ok !== false) setReviewOpen(false);
                  }
                }}
                className="min-h-12 h-auto w-full min-w-0 shrink whitespace-normal rounded-xl px-4 py-3 text-base font-semibold"
              >
                {vehicleReview.goesToAvp ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : vehicleReview.allRejectedClear ? (
                  <XCircle className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>
                  {vehicleReview.goesToAvp
                    ? 'Send Request to AVP QA'
                    : vehicleReview.allRejectedClear
                      ? 'Confirm & Submit Rejection'
                      : 'Confirm & Submit QA Decision'}
                </span>
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Active Portion Entry Drawer */}
      {currentPortion && (
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
          onAcceptSubmit={onAcceptSubmit}
          onRejectSubmit={onRejectSubmit}
          onSavePortion={
            onSavePortionMap
              ? () => {
                  onSavePortionMap((prev) => ({ ...prev, [currentPortion.id]: true }));
                  setIsDrawerOpen(false);
                }
              : undefined
          }
          canRemovePortion={
            canMutateUnsubmittedPortions &&
            evaluatedPortions.length > 1 &&
            currentPortion.plant_decision !== 'ACCEPTED' &&
            currentPortion.plant_decision !== 'REJECTED' &&
            currentPortion.manager_review_status !== 'PENDING'
          }
          onRemovePortion={
            onRemovePortion
              ? () => {
                  setIsDrawerOpen(false);
                  onRemovePortion(currentPortion.id, currentPortion.portion_number);
                }
              : undefined
          }
          isSubmitting={isSubmitting}
          currentUser={currentUser}
        />
      )}
    </div>
  );
};
