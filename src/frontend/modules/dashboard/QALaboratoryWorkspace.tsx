'use client';

import React, { useState, useEffect, useMemo, useCallback, useEffectEvent } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';

import {
  QAQueuePanel,
  WaitingVisit,
  InTestingVisit,
  OnHoldVisit,
} from './qa/QAQueuePanel';
import {
  QATestingSection,
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
} from './qa/QATestingSection';
import { QADecisionModals } from './qa/QADecisionModals';
import { PageHeader } from '@/components/ui/page-header';
import { getErrorMessage } from '@/lib/errors';
import type { PersonDecision } from '@/types/stage1-decision';

export type {
  WaitingVisit,
  InTestingVisit,
  OnHoldVisit,
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
};

export type QATab = 'WAITING' | 'IN_TESTING' | 'ON_HOLD';

interface QALaboratoryWorkspaceProps {
  currentUser?: User | null;
  activeTab?: QATab;
  onTabChange?: (tab: QATab) => void;
}

export const QALaboratoryWorkspace: React.FC<QALaboratoryWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const toast = useToast();
  const [internalTab, setInternalTab] = useState<QATab>('WAITING');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: QATab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
  const [searchQuery, setSearchQuery] = useState('');

  // Queue Lists
  const [waitingVisits, setWaitingVisits] = useState<WaitingVisit[]>([]);
  const [inTestingVisits, setInTestingVisits] = useState<InTestingVisit[]>([]);
  const [onHoldVisits, setOnHoldVisits] = useState<OnHoldVisit[]>([]);

  // Tab-Specific Selection States
  const [selectedWaitingVisitId, setSelectedWaitingVisitId] = useState<string | null>(null);
  const [selectedTestingVisitId, setSelectedTestingVisitId] = useState<string | null>(null);
  const [selectedHeldVisitId, setSelectedHeldVisitId] = useState<string | null>(null);

  // Loaded Visit Detail for Active IN_PROGRESS Session
  const [visitDetail, setVisitDetail] = useState<VisitDetail | null>(null);
  const [activePortionIndex, setActivePortionIndex] = useState<number>(0);

  // Per-test form state: testId → TestInputState
  const [testInputs, setTestInputs] = useState<Record<string, TestInputState>>({});

  // Action Inputs for Reject / Hold / Datetime
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [qaOpTimestamp, setQaOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [activeActionModal, setActiveActionModal] = useState<'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT' | null>(null);
  const [actionVisitId, setActionVisitId] = useState<string | null>(null);
  const isSuperior = ['QA_HEAD', 'SUPER_ADMIN'].includes(currentUser?.role || '');
  const [enteredSealMap, setEnteredSealMap] = useState<Record<string, string>>({});
  const [photoStatesMap, setPhotoStatesMap] = useState<Record<string, Record<string, string>>>({});
  const [personDecisionMap, setPersonDecisionMap] = useState<Record<string, PersonDecision | null>>({});
  const [decisionRemarksMap, setDecisionRemarksMap] = useState<Record<string, string>>({});

  const openActionModal = (action: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT', targetVisitId?: string) => {
    setActiveActionModal(action);
    if (targetVisitId) setActionVisitId(targetVisitId);
    setHoldReason('');
    setRejectionReason('');
    setRejectionRemarks('');
    setExceptionReason('');
    setQaOpTimestamp(toDatetimeLocalInput(new Date()));
  };

  const [isLoadingQueues, setIsLoadingQueues] = useState(true);
  const [isRefreshingVisit, setIsLoadingVisit] = useState(false);
  // Visit whose detail request last settled; a different selection means it is still loading.
  const [loadedVisitId, setLoadedVisitId] = useState<string | null>(null);
  const isLoadingVisit = isRefreshingVisit || (selectedTestingVisitId !== null && loadedVisitId !== selectedTestingVisitId);

  // Clearing the visit under test clears its detail.
  const [trackedTestingVisitId, setTrackedTestingVisitId] = useState(selectedTestingVisitId);
  if (trackedTestingVisitId !== selectedTestingVisitId) {
    setTrackedTestingVisitId(selectedTestingVisitId);
    if (!selectedTestingVisitId) setVisitDetail(null);
  }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);


  const selectedWaitingVisit = useMemo(
    () => waitingVisits.find((v) => v.id === selectedWaitingVisitId) || null,
    [waitingVisits, selectedWaitingVisitId]
  );

  const selectedHeldVisit = useMemo(
    () => onHoldVisits.find((v) => v.id === selectedHeldVisitId) || null,
    [onHoldVisits, selectedHeldVisitId]
  );

  const fetchQueues = useCallback(
    (query: string = searchQuery) =>
      fetch(`/api/qa/sessions/queues?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) return;

          const waiting: WaitingVisit[] = data.waiting || [];
          const inTesting: InTestingVisit[] = data.inTesting || [];
          const onHold: OnHoldVisit[] = data.onHold || [];

          setWaitingVisits(waiting);
          setInTestingVisits(inTesting);
          setOnHoldVisits(onHold);

          setSelectedWaitingVisitId((prev) => {
            if (prev && waiting.some((v: WaitingVisit) => v.id === prev)) return prev;
            return waiting.length > 0 ? waiting[0].id : null;
          });

          setSelectedTestingVisitId((prev) => {
            if (prev && inTesting.some((v: InTestingVisit) => v.id === prev)) return prev;
            if (inTesting.length === 0) return null;
            return inTesting[0].id;
          });

          setSelectedHeldVisitId((prev) => {
            if (prev && onHold.some((v: OnHoldVisit) => v.id === prev)) return prev;
            return onHold.length > 0 ? onHold[0].id : null;
          });
        })
        .catch((err) => {
          console.error('Failed to fetch QA queues', err);
        })
        .finally(() => {
          // Only the first load shows the queue skeleton; polling refreshes in place.
          setIsLoadingQueues(false);
        }),
    [searchQuery]
  );

  useEffect(() => {
    fetchQueues(searchQuery);
    const interval = setInterval(() => {
      fetchQueues(searchQuery);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchQueues, searchQuery]);

  const fetchVisitDetail = async (visitId: string) => {
    setIsLoadingVisit(true);
    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch visit detail');

      setVisitDetail(data.visit);
      if (data.visit?.portions && data.visit.portions.length > activePortionIndex) {
        populateInputsForPortion(data.visit.portions[activePortionIndex], data.visit.active_plant_tests || []);
      }
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsLoadingVisit(false);
    }
  };

  const populateInputsForPortion = (portion: VisitDetailPortion, plantTests: LabTestDef[]) => {
    const inputs: Record<string, TestInputState> = {};

    plantTests.forEach((test) => {
      const existing = portion.plant_results.find((pr) => pr.testId === test.id);
      if (existing) {
        inputs[test.id] = {
          performanceStatus: (existing.performanceStatus as TestPerformanceStatus) || 'PERFORMED',
          notPerformedReason: existing.notPerformedReason || '',
          numericValue: existing.numericValue !== null && existing.numericValue !== undefined ? String(existing.numericValue) : '',
          textValue: existing.textValue || '',
        };
      } else {
        inputs[test.id] = {
          performanceStatus: 'PERFORMED',
          notPerformedReason: '',
          numericValue: '',
          textValue: '',
        };
      }
    });

    setTestInputs(inputs);
    if (portion.plant_seal_number_entered) {
      setEnteredSealMap((prev) => ({ ...prev, [portion.id]: portion.plant_seal_number_entered! }));
    }
    const portionPhotos: Record<string, string> = {};
    portion.plant_results?.forEach((pr: SavedPlantResult & { photo_url?: string; photoUrl?: string }) => {
      const pUrl = pr.photoUrl || pr.photo_url;
      if (pUrl) portionPhotos[pr.testId] = pUrl;
    });
    if (Object.keys(portionPhotos).length > 0) {
      setPhotoStatesMap((prev) => ({ ...prev, [portion.id]: portionPhotos }));
    }
  };

  const applyLoadedVisit = useEffectEvent((visit: VisitDetail | null | undefined) => {
    if (visit) {
      setVisitDetail(visit);
      if (visit.portions && visit.portions.length > 0) {
        populateInputsForPortion(visit.portions[0], visit.active_plant_tests || []);
      }
    } else {
      setVisitDetail(null);
    }
  });

  // Load the selected in-testing visit and prefill its first portion's inputs.
  useEffect(() => {
    if (!selectedTestingVisitId) return;
    let isCancelled = false;
    fetch(`/api/qa/vehicle-visits/${selectedTestingVisitId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled) applyLoadedVisit(data.visit);
      })
      .catch((err) => {
        if (!isCancelled) setMsg({ text: getErrorMessage(err), isError: true });
      })
      .finally(() => {
        if (!isCancelled) setLoadedVisitId(selectedTestingVisitId);
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedTestingVisitId]);

  const handleSelectPortion = (index: number) => {
    if (!visitDetail || !visitDetail.portions[index]) return;
    setActivePortionIndex(index);
    populateInputsForPortion(visitDetail.portions[index], visitDetail.active_plant_tests || []);
  };

  const handleTestPerformanceStatusChange = (testId: string, status: TestPerformanceStatus) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { numericValue: '', textValue: '', notPerformedReason: '' }),
        performanceStatus: status,
      },
    }));
  };

  const handleTestNumericChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', textValue: '' }),
        numericValue: val,
      },
    }));
  };

  const handleTestTextChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: '' }),
        textValue: val,
      },
    }));
  };

  const handleTestReasonChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'NOT_PERFORMED', numericValue: '', textValue: '' }),
        notPerformedReason: val,
      },
    }));
  };

  const handleStartTesting = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedWaitingVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch('/api/qa/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: targetVisitId,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start testing session');

      toast.showSuccess('QA testing session started successfully.', 'Session Started');
      setActiveActionModal(null);
      setActiveTab('IN_TESTING');
      setSelectedTestingVisitId(targetVisitId);
      await fetchQueues();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumeTesting = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedHeldVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch('/api/qa/sessions/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: targetVisitId,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resume testing session');

      toast.showSuccess('QA testing session resumed.', 'Session Resumed');
      setActiveActionModal(null);
      setActiveTab('IN_TESTING');
      setSelectedTestingVisitId(targetVisitId);
      await fetchQueues();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptPortionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDetail) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      const portionId = currentPortion.id;
      const enteredSeal = enteredSealMap[portionId] || currentPortion.plant_seal_number_entered || '';
      const portionPhotos = photoStatesMap[portionId] || {};
      const primaryPhotoUrl = Object.values(portionPhotos)[0] || undefined;
      const portionRemarks = decisionRemarksMap[portionId] || '';

      const resultsPayload = Object.entries(testInputs).map(([testId, state]) => ({
        testId,
        performanceStatus: state.performanceStatus,
        notPerformedReason: state.performanceStatus === 'NOT_PERFORMED' ? state.notPerformedReason : null,
        numericValue: state.performanceStatus === 'PERFORMED' && state.numericValue !== '' ? Number(state.numericValue) : null,
        textValue: state.performanceStatus === 'PERFORMED' && state.textValue !== '' ? state.textValue : null,
        photoUrl: portionPhotos[testId] || undefined,
      }));

      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'ACCEPTED',
          completionClientEventId: `plant-qa-${currentPortion.id}-${crypto.randomUUID()}`,
          results: resultsPayload,
          sealNumber: enteredSeal || undefined,
          photoUrl: primaryPhotoUrl,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
          exceptionReason: (portionRemarks || exceptionReason || rejectionReason).trim() || undefined,
          rejectionReason: (portionRemarks || exceptionReason || rejectionReason).trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept portion');

      toast.showSuccess(`Portion ${currentPortion.portion_number} ACCEPTED.`, 'Portion Accepted');
      setActiveActionModal(null);
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectPortionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
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

    const resultsPayload = Object.entries(testInputs).map(([testId, state]) => ({
      testId,
      performanceStatus: state.performanceStatus,
      notPerformedReason: state.performanceStatus === 'NOT_PERFORMED' ? state.notPerformedReason : null,
      numericValue: state.performanceStatus === 'PERFORMED' && state.numericValue !== '' ? Number(state.numericValue) : null,
      textValue: state.performanceStatus === 'PERFORMED' && state.textValue !== '' ? state.textValue : null,
      photoUrl: portionPhotos[testId] || undefined,
    }));

    // At least one PERFORMED result is required to reject (unless seal mismatch)
    const performedResults = resultsPayload.filter((r) => r.performanceStatus === 'PERFORMED');
    const sealMismatch = currentPortion.seal_number && enteredSeal && enteredSeal.toUpperCase() !== currentPortion.seal_number.toUpperCase();
    if (performedResults.length === 0 && !sealMismatch) {
      const errText = 'At least one PERFORMED Plant QA test result must be recorded before rejecting. NOT_PERFORMED alone is not sufficient rejection evidence.';
      setMsg({ text: errText, isError: true });
      toast.showError(errText, 'Validation Error');
      return;
    }

    setIsSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'REJECTED',
          completionClientEventId: `plant-qa-${currentPortion.id}-${crypto.randomUUID()}`,
          rejectionReason: effectiveReason,
          rejectionRemarks: effectiveRemarks,
          results: resultsPayload,
          sealNumber: enteredSeal || undefined,
          photoUrl: primaryPhotoUrl,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject portion');

      toast.showSuccess(`Portion ${currentPortion.portion_number} REJECTED.`, 'Portion Rejected');
      setActiveActionModal(null);
      setRejectionReason('');
      setRejectionRemarks('');
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
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
    setMsg(null);

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: holdReason.trim(),
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place portion on hold');

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
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isAddingPortion, setIsAddingPortion] = useState(false);

  const handleAddPortion = async () => {
    if (!visitDetail) return;
    setIsAddingPortion(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add test portion');

      toast.showSuccess(`Portion ${data.portion.portion_number} added for independent testing.`, 'Portion Added');

      const detailRes = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}`);
      const detailData = await detailRes.json();
      if (detailRes.ok && detailData.visit) {
        setVisitDetail(detailData.visit);
        const newIndex = detailData.visit.portions.length - 1;
        setActivePortionIndex(newIndex);
        populateInputsForPortion(detailData.visit.portions[newIndex], detailData.visit.active_plant_tests || []);
      }
      await fetchQueues();
    } catch (err) {
      toast.showError(getErrorMessage(err), 'Failed to Add Portion');
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsAddingPortion(false);
    }
  };

  const [isRemovingPortion, setIsRemovingPortion] = useState(false);

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
    setMsg(null);
    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${portionId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove test portion');

      toast.showSuccess(`Portion #${portionNumber} removed.`, 'Portion Removed');

      // Refresh visit detail and adjust active tab
      const detailRes = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}`);
      const detailData = await detailRes.json();
      if (detailRes.ok && detailData.visit) {
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
      setMsg({ text: getErrorMessage(err), isError: true });
    } finally {
      setIsRemovingPortion(false);
    }
  };

  // ─── Derived accountability metrics ────────────────────────────────────────
  const requiredManualPlantTests = useMemo(
    () => (visitDetail?.active_plant_tests || []).filter((t) => t.isRequired && t.resultType !== 'CALCULATED'),
    [visitDetail]
  );

  // PERFORMED: has a valid value set
  const performedCount = useMemo(() => {
    return requiredManualPlantTests.filter((t) => {
      const state = testInputs[t.id];
      if (!state || state.performanceStatus !== 'PERFORMED') return false;
      if (t.resultType === 'NUMERIC') return state.numericValue !== '' && !isNaN(Number(state.numericValue));
      return state.textValue !== '';
    }).length;
  }, [requiredManualPlantTests, testInputs]);

  // NOT_PERFORMED: explicitly marked
  const notPerformedCount = useMemo(() => {
    return requiredManualPlantTests.filter((t) => {
      const state = testInputs[t.id];
      return state?.performanceStatus === 'NOT_PERFORMED';
    }).length;
  }, [requiredManualPlantTests, testInputs]);

  // UNRESOLVED: in form but neither PERFORMED with value nor NOT_PERFORMED
  const unresolvedCount = useMemo(() => {
    return requiredManualPlantTests.filter((t) => {
      const state = testInputs[t.id];
      if (!state) return true; // no form entry
      if (state.performanceStatus === 'NOT_PERFORMED') return false;
      if (t.resultType === 'NUMERIC') return state.numericValue === '' || isNaN(Number(state.numericValue));
      return state.textValue === '';
    }).length;
  }, [requiredManualPlantTests, testInputs]);

  const canAccept = performedCount === requiredManualPlantTests.length && notPerformedCount === 0 && unresolvedCount === 0;

  const hasFailingTests = useMemo(() => {
    const currentPortion = visitDetail?.portions?.[activePortionIndex];
    if (!currentPortion) return false;
    if (currentPortion.plant_results?.some((r) => r.isPassed === false)) return true;
    for (const test of requiredManualPlantTests) {
      const input = testInputs[test.id];
      if (!input) continue;
      if (test.isRequired && input.performanceStatus === 'NOT_PERFORMED') return true;
      if (input.performanceStatus === 'PERFORMED' && test.resultOptions) {
        const opt = test.resultOptions.find((o) => o.value === input.textValue);
        if (opt && opt.isPassing === false) return true;
      }
    }
    return false;
  }, [visitDetail, activePortionIndex, requiredManualPlantTests, testInputs]);

  // Format dispatch quantity display — never crash on null
  const formatDispatchQty = (portion: VisitDetailPortion | null): string => {
    if (!portion) return '—';
    const val = portion.dispatch_quantity_value;
    const unit = portion.dispatch_quantity_unit;
    if (val === null || val === undefined || !unit) return '—';
    return `${Number(val).toLocaleString()} ${unit}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title="QA laboratory"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5">
          <QAQueuePanel
            activeTab={activeTab}
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
              fetchQueues(q);
            }}
            waitingVisits={waitingVisits}
            inTestingVisits={inTestingVisits}
            onHoldVisits={onHoldVisits}
            selectedWaitingVisitId={selectedWaitingVisitId}
            selectedTestingVisitId={selectedTestingVisitId}
            selectedHeldVisitId={selectedHeldVisitId}
            onSelectWaitingVisit={(id) => setSelectedWaitingVisitId(id)}
            onSelectTestingVisit={(id) => setSelectedTestingVisitId(id)}
            onSelectHeldVisit={(id) => setSelectedHeldVisitId(id)}
            onOpenActionModal={openActionModal}
            isLoadingQueues={isLoadingQueues}
            isSubmitting={isSubmitting}
          />
        </div>

        <div key={activeTab} className="lg:col-span-7 animate-panel-in">
          <QATestingSection
            activeTab={activeTab}
            searchQuery={searchQuery}
            selectedWaitingVisit={selectedWaitingVisit}
            selectedHeldVisit={selectedHeldVisit}
            visitDetail={visitDetail}
            activePortionIndex={activePortionIndex}
            onSelectPortion={handleSelectPortion}
            isLoadingVisit={isLoadingVisit}
            testInputs={testInputs}
            onTestPerformanceStatusChange={handleTestPerformanceStatusChange}
            onTestNumericChange={handleTestNumericChange}
            onTestTextChange={handleTestTextChange}
            onTestReasonChange={handleTestReasonChange}
            onOpenActionModal={openActionModal}
            requiredManualPlantTests={requiredManualPlantTests}
            performedCount={performedCount}
            notPerformedCount={notPerformedCount}
            unresolvedCount={unresolvedCount}
            canAccept={canAccept}
            isSubmitting={isSubmitting}
            formatDispatchQty={formatDispatchQty}
            onAddPortion={handleAddPortion}
            isAddingPortion={isAddingPortion}
            onRemovePortion={handleRemovePortion}
            isRemovingPortion={isRemovingPortion}
            enteredSeal={
              visitDetail?.portions?.[activePortionIndex]
                ? enteredSealMap[visitDetail.portions[activePortionIndex].id] ?? (visitDetail.portions[activePortionIndex].plant_seal_number_entered || '')
                : ''
            }
            onSealChange={(val) => {
              const cp = visitDetail?.portions?.[activePortionIndex];
              if (cp) {
                setEnteredSealMap((prev) => ({ ...prev, [cp.id]: val }));
              }
            }}
            photoStates={
              visitDetail?.portions?.[activePortionIndex]
                ? photoStatesMap[visitDetail.portions[activePortionIndex].id] || {}
                : {}
            }
            onPhotoChange={(testId, url) => {
              const cp = visitDetail?.portions?.[activePortionIndex];
              if (cp) {
                setPhotoStatesMap((prev) => {
                  const portionMap = { ...(prev[cp.id] || {}) };
                  if (url) {
                    portionMap[testId] = url;
                  } else {
                    delete portionMap[testId];
                  }
                  return { ...prev, [cp.id]: portionMap };
                });
              }
            }}
            personDecision={
              visitDetail?.portions?.[activePortionIndex]
                ? personDecisionMap[visitDetail.portions[activePortionIndex].id] || null
                : null
            }
            onPersonDecisionChange={(d) => {
              const cp = visitDetail?.portions?.[activePortionIndex];
              if (cp) {
                setPersonDecisionMap((prev) => ({ ...prev, [cp.id]: d }));
              }
            }}
            decisionRemarks={
              visitDetail?.portions?.[activePortionIndex]
                ? decisionRemarksMap[visitDetail.portions[activePortionIndex].id] || ''
                : ''
            }
            onDecisionRemarksChange={(r) => {
              const cp = visitDetail?.portions?.[activePortionIndex];
              if (cp) {
                setDecisionRemarksMap((prev) => ({ ...prev, [cp.id]: r }));
              }
            }}
            isSuperior={isSuperior}
          />
        </div>
      </div>

      <QADecisionModals
        activeActionModal={activeActionModal}
        onCloseModal={() => setActiveActionModal(null)}
        actionVisitId={actionVisitId}
        visitDetail={visitDetail}
        activePortionIndex={activePortionIndex}
        qaOpTimestamp={qaOpTimestamp}
        onQaOpTimestampChange={(val) => setQaOpTimestamp(val)}
        rejectionReason={rejectionReason}
        onRejectionReasonChange={(val) => setRejectionReason(val)}
        rejectionRemarks={rejectionRemarks}
        onRejectionRemarksChange={(val) => setRejectionRemarks(val)}
        exceptionReason={exceptionReason}
        onExceptionReasonChange={(val) => setExceptionReason(val)}
        hasFailingTests={hasFailingTests}
        onStartTestingConfirm={handleStartTesting}
        onResumeTestingConfirm={handleResumeTesting}
        onAcceptPortionConfirm={handleAcceptPortionConfirm}
        onRejectPortionConfirm={handleRejectPortionConfirm}
        isSubmitting={isSubmitting}
        waitingVisits={waitingVisits}
        onHoldVisits={onHoldVisits}
      />
    </div>
  );
};
