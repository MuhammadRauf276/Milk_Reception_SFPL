'use client';

import React, { useState, useRef } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import { apiClient } from '@/frontend/lib/apiClient';
import type { QAVisitDetailState } from './useQAVisitDetail';

export type QAActionModal = 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT';
type QATab = 'WAITING' | 'IN_TESTING' | 'ON_HOLD';

interface UseQAActionsArgs {
  detail: QAVisitDetailState;
  selectedWaitingVisitId: string | null;
  selectedHeldVisitId: string | null;
  setSelectedTestingVisitId: (id: string | null) => void;
  setSelectedHeldVisitId: (id: string | null) => void;
  setActiveTab: (tab: QATab) => void;
  fetchQueues: () => Promise<unknown>;
}

/** Start / resume / accept / reject / hold actions and portion add / remove, with their form state. */
export function useQAActions({
  detail,
  selectedWaitingVisitId,
  selectedHeldVisitId,
  setSelectedTestingVisitId,
  setSelectedHeldVisitId,
  setActiveTab,
  fetchQueues,
}: UseQAActionsArgs) {
  const toast = useToast();
  const {
    visitDetail,
    setVisitDetail,
    activePortionIndex,
    setActivePortionIndex,
    testInputs,
    enteredSealMap,
    photoStatesMap,
    decisionRemarksMap,
    populateInputsForPortion,
    fetchVisitDetail,
  } = detail;

  // Action inputs for Reject / Hold / Datetime
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [qaOpTimestamp, setQaOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [activeActionModal, setActiveActionModal] = useState<QAActionModal | null>(null);
  const [actionVisitId, setActionVisitId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingPortion, setIsAddingPortion] = useState(false);
  const [isRemovingPortion, setIsRemovingPortion] = useState(false);
  const [isRoutingVehicle, setIsRoutingVehicle] = useState(false);

  // Stable client operation identities retained across transient network timeouts / errors
  const activeAddPortionOpIdRef = useRef<string | null>(null);
  const activeCompletionOpIdMap = useRef<Record<string, string>>({});

  const openActionModal = (action: QAActionModal, targetVisitId?: string) => {
    setActiveActionModal(action);
    if (targetVisitId) setActionVisitId(targetVisitId);
    setHoldReason('');
    setRejectionReason('');
    setRejectionRemarks('');
    setExceptionReason('');
    setQaOpTimestamp(toDatetimeLocalInput(new Date()));
  };

  const reportError = (err: unknown, title: string) => toast.showError(getErrorMessage(err), title);

  const handleStartTesting = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedWaitingVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
    try {
      await apiClient.post('/api/qa/sessions/start', {
        visitId: targetVisitId,
        operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
      }, {
        dedupKey: `qa-start-${targetVisitId}`,
        timeoutMs: 15_000,
      });

      toast.showSuccess('QA testing session started successfully.', 'Session Started');
      setActiveActionModal(null);
      setActiveTab('IN_TESTING');
      setSelectedTestingVisitId(targetVisitId);
      await fetchQueues();
    } catch (err) {
      reportError(err, 'Failed to Start Session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumeTesting = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedHeldVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
    try {
      await apiClient.post('/api/qa/sessions/resume', {
        visitId: targetVisitId,
        operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
      }, {
        dedupKey: `qa-resume-${targetVisitId}`,
        timeoutMs: 15_000,
      });

      toast.showSuccess('QA testing session resumed.', 'Session Resumed');
      setActiveActionModal(null);
      setActiveTab('IN_TESTING');
      setSelectedTestingVisitId(targetVisitId);
      await fetchQueues();
    } catch (err) {
      reportError(err, 'Failed to Resume Session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildResultsPayload = (
    portionPhotos: Record<string, string>,
    isRejecting = false,
    decisionReason = ''
  ) =>
    Object.entries(testInputs).map(([testId, state]) => {
      const hasNum = state.numericValue !== '' && !isNaN(Number(state.numericValue));
      const hasText = Boolean(state.textValue && state.textValue.trim() !== '');
      const isPerformed = hasNum || hasText;

      const perfStatus: 'PERFORMED' | 'NOT_PERFORMED' = isPerformed ? 'PERFORMED' : 'NOT_PERFORMED';
      let notPerfReason: string | null = null;

      if (!isPerformed) {
        if (isRejecting) {
          notPerfReason = 'VEHICLE_REJECTED_BEFORE_TEST_COMPLETION';
        } else {
          notPerfReason = (decisionReason || state.notPerformedReason || 'Omitted with exception').trim();
        }
      }

      return {
        testId,
        performanceStatus: perfStatus,
        notPerformedReason: notPerfReason,
        numericValue: hasNum ? Number(state.numericValue) : null,
        textValue: hasText ? state.textValue : null,
        photoUrl: portionPhotos[testId] || undefined,
      };
    });

  const handleAcceptPortionConfirm = async (e?: React.FormEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    if (!visitDetail) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    setIsSubmitting(true);
    try {
      const portionId = currentPortion.id;
      const enteredSeal = enteredSealMap[portionId] || currentPortion.plant_seal_number_entered || '';
      const portionPhotos = photoStatesMap[portionId] || {};
      const primaryPhotoUrl = Object.values(portionPhotos)[0] || undefined;
      const portionRemarks = decisionRemarksMap[portionId] || '';
      const effectiveReason = (portionRemarks || exceptionReason || rejectionReason).trim();
      const resultsPayload = buildResultsPayload(portionPhotos, false, effectiveReason);

      // Stable operation ID across retries of the same portion decision
      if (!activeCompletionOpIdMap.current[portionId]) {
        activeCompletionOpIdMap.current[portionId] = `plant-qa-${portionId}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const completionClientEventId = activeCompletionOpIdMap.current[portionId];

      await apiClient.post(
        `/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`,
        {
          decision: 'ACCEPTED',
          completionClientEventId,
          results: resultsPayload,
          sealNumber: enteredSeal || undefined,
          photoUrl: primaryPhotoUrl,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
          exceptionReason: (portionRemarks || exceptionReason || rejectionReason).trim() || undefined,
          rejectionReason: (portionRemarks || exceptionReason || rejectionReason).trim() || undefined,
        },
        {
          idempotencyKey: completionClientEventId,
          dedupKey: `qa-portion-complete-${visitDetail.id}-${currentPortion.id}`,
          timeoutMs: 25_000,
        }
      );

      delete activeCompletionOpIdMap.current[portionId];
      toast.showSuccess(`Portion ${currentPortion.portion_number} ACCEPTED.`, 'Portion Accepted');
      setActiveActionModal(null);
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err) {
      reportError(err, 'Failed to Accept Portion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectPortionConfirm = async (e?: React.FormEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    if (!visitDetail) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    const portionId = currentPortion.id;
    const enteredSeal = enteredSealMap[portionId] || currentPortion.plant_seal_number_entered || '';
    const portionPhotos = photoStatesMap[portionId] || {};
    const primaryPhotoUrl = Object.values(portionPhotos)[0] || undefined;
    const portionRemarks = decisionRemarksMap[portionId] || '';

    const effectiveReason = rejectionReason.trim() || portionRemarks.trim() || 'Quality Specification Breach';
    const effectiveRemarks = rejectionRemarks.trim() || portionRemarks.trim() || effectiveReason;

    const resultsPayload = buildResultsPayload(portionPhotos, true, effectiveReason);

    // At least one PERFORMED result is required to reject (unless seal mismatch)
    const performedResults = resultsPayload.filter((r) => r.performanceStatus === 'PERFORMED');
    const sealMismatch = currentPortion.seal_number && enteredSeal && enteredSeal.toUpperCase() !== currentPortion.seal_number.toUpperCase();
    if (performedResults.length === 0 && !sealMismatch) {
      toast.showError(
        'At least one PERFORMED Plant QA test result must be recorded before rejecting. NOT_PERFORMED alone is not sufficient rejection evidence.',
        'Validation Error'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Stable operation ID across retries of the same portion decision
      if (!activeCompletionOpIdMap.current[portionId]) {
        activeCompletionOpIdMap.current[portionId] = `plant-qa-${portionId}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const completionClientEventId = activeCompletionOpIdMap.current[portionId];

      await apiClient.post(
        `/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`,
        {
          decision: 'REJECTED',
          completionClientEventId,
          rejectionReason: effectiveReason,
          rejectionRemarks: effectiveRemarks,
          results: resultsPayload,
          sealNumber: enteredSeal || undefined,
          photoUrl: primaryPhotoUrl,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        },
        {
          idempotencyKey: completionClientEventId,
          dedupKey: `qa-portion-complete-${visitDetail.id}-${currentPortion.id}`,
          timeoutMs: 25_000,
        }
      );

      delete activeCompletionOpIdMap.current[portionId];
      toast.showSuccess(`Portion ${currentPortion.portion_number} REJECTED.`, 'Portion Rejected');
      setActiveActionModal(null);
      setRejectionReason('');
      setRejectionRemarks('');
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err) {
      reportError(err, 'Failed to Reject Portion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHoldPortionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDetail || !holdReason.trim()) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    setIsSubmitting(true);
    try {
      await apiClient.post(
        `/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/hold`,
        {
          reason: holdReason.trim(),
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        },
        {
          dedupKey: `qa-portion-hold-${visitDetail.id}-${currentPortion.id}`,
          timeoutMs: 15_000,
        }
      );

      toast.showSuccess(`Portion ${currentPortion.portion_number} placed ON HOLD.`, 'Portion On Hold');
      setActiveActionModal(null);
      setHoldReason('');

      const heldVisitId = visitDetail.id;
      setSelectedTestingVisitId(null);
      setVisitDetail(null);
      setActiveTab('ON_HOLD');
      setSelectedHeldVisitId(heldVisitId);
      await fetchQueues();
    } catch (err) {
      reportError(err, 'Failed to Hold Portion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPortion = async () => {
    if (!visitDetail) return;
    setIsAddingPortion(true);
    try {
      if (!activeAddPortionOpIdRef.current) {
        activeAddPortionOpIdRef.current = `add-portion-${visitDetail.id}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const opId = activeAddPortionOpIdRef.current;

      const data = await apiClient.post<{ success: boolean; portion: { id: string; portion_number: number } }>(
        `/api/qa/vehicle-visits/${visitDetail.id}/portions`,
        { clientOperationId: opId },
        {
          idempotencyKey: opId,
          dedupKey: `add-portion-${visitDetail.id}`,
          timeoutMs: 20_000,
        }
      );

      activeAddPortionOpIdRef.current = null;
      toast.showSuccess(`Portion ${data.portion.portion_number} added for independent testing.`, 'Portion Added');

      const detailData = await apiClient.get<{ visit?: any }>(`/api/qa/vehicle-visits/${visitDetail.id}`);
      if (detailData && detailData.visit) {
        setVisitDetail(detailData.visit);
        const newIndex = detailData.visit.portions.length - 1;
        setActivePortionIndex(newIndex);
        populateInputsForPortion(detailData.visit.portions[newIndex], detailData.visit.active_plant_tests || []);
      }
      await fetchQueues();
    } catch (err) {
      toast.showError(getErrorMessage(err), 'Failed to Add Portion');
    } finally {
      setIsAddingPortion(false);
    }
  };

  const handleRemovePortion = async (portionId: string, portionNumber: number) => {
    if (!visitDetail) return;
    if (visitDetail.portions.length <= 1) {
      toast.showError('A vehicle visit must have at least one test portion.', 'Cannot Remove');
      return;
    }

    const confirmRemove = window.confirm(
      `Remove Portion #${portionNumber}? Any unsaved observations for this portion will be discarded.`
    );
    if (!confirmRemove) return;

    setIsRemovingPortion(true);
    try {
      await apiClient.delete(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${portionId}`);

      toast.showSuccess(`Portion #${portionNumber} removed.`, 'Portion Removed');

      // Refresh visit detail and adjust active tab
      const detailData = await apiClient.get<{ visit?: any }>(`/api/qa/vehicle-visits/${visitDetail.id}`);
      if (detailData && detailData.visit) {
        setVisitDetail(detailData.visit);
        const fallbackIndex = Math.max(0, Math.min(activePortionIndex, detailData.visit.portions.length - 1));
        setActivePortionIndex(fallbackIndex);
        if (detailData.visit.portions[fallbackIndex]) {
          populateInputsForPortion(detailData.visit.portions[fallbackIndex], detailData.visit.active_plant_tests || []);
        }
      }
      await fetchQueues();
    } catch (err) {
      toast.showError(getErrorMessage(err), 'Failed to Remove Portion');
    } finally {
      setIsRemovingPortion(false);
    }
  };

  const handleRouteVehicle = async (targetAction: 'GATE_EXIT' | 'WEIGHBRIDGE' | 'ESCALATE_AVP_QA') => {
    if (!visitDetail) return;
    setIsRoutingVehicle(true);
    try {
      await apiClient.post(
        `/api/qa/vehicle-visits/${visitDetail.id}/complete-session`,
        {
          action: targetAction,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        },
        {
          dedupKey: `qa-route-${visitDetail.id}`,
          timeoutMs: 20_000,
        }
      );

      if (targetAction === 'GATE_EXIT') {
        toast.showSuccess(
          `Vehicle ${visitDetail.vehicle_number} routed to Gate Exit.`,
          'Sent to Gate Exit'
        );
        setSelectedTestingVisitId(null);
        setVisitDetail(null);
        setActiveTab('WAITING');
      } else if (targetAction === 'WEIGHBRIDGE') {
        toast.showSuccess(
          `Vehicle ${visitDetail.vehicle_number} routed to Weighbridge.`,
          'Sent to Weighbridge'
        );
        setSelectedTestingVisitId(null);
        setVisitDetail(null);
        setActiveTab('WAITING');
      } else {
        toast.showSuccess(
          `Vehicle ${visitDetail.vehicle_number} escalated to AVP QA.`,
          'Escalated to AVP QA'
        );
        setSelectedTestingVisitId(null);
        setVisitDetail(null);
        setActiveTab('ON_HOLD');
      }

      await fetchQueues();
    } catch (err) {
      reportError(err, 'Routing Failed');
    } finally {
      setIsRoutingVehicle(false);
    }
  };

  return {
    rejectionReason,
    setRejectionReason,
    rejectionRemarks,
    setRejectionRemarks,
    exceptionReason,
    setExceptionReason,
    holdReason,
    setHoldReason,
    qaOpTimestamp,
    setQaOpTimestamp,
    activeActionModal,
    setActiveActionModal,
    actionVisitId,
    isSubmitting,
    isAddingPortion,
    isRemovingPortion,
    openActionModal,
    handleStartTesting,
    handleResumeTesting,
    handleAcceptPortionConfirm,
    handleRejectPortionConfirm,
    handleHoldPortionConfirm,
    handleAddPortion,
    handleRemovePortion,
    handleRouteVehicle,
    isRoutingVehicle,
  };
}
