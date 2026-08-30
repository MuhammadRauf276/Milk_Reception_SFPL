'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FlaskConical, Clock, PauseCircle, Radio } from 'lucide-react';
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

interface QALaboratoryWorkspaceProps {
  logs?: any[];
  currentUser?: User | null;
}

export const QALaboratoryWorkspace: React.FC<QALaboratoryWorkspaceProps> = ({ currentUser }) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'WAITING' | 'IN_TESTING' | 'ON_HOLD'>('WAITING');
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
  const [isFormDirty, setIsFormDirty] = useState(false);

  // Action Inputs for Reject / Hold / Datetime
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [qaOpTimestamp, setQaOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [activeActionModal, setActiveActionModal] = useState<'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT' | null>(null);
  const [actionVisitId, setActionVisitId] = useState<string | null>(null);

  const openActionModal = (action: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT', targetVisitId?: string) => {
    setActiveActionModal(action);
    if (targetVisitId) setActionVisitId(targetVisitId);
    setHoldReason('');
    setRejectionReason('');
    setRejectionRemarks('');
    setQaOpTimestamp(toDatetimeLocalInput(new Date()));
  };

  const [isLoadingQueues, setIsLoadingQueues] = useState(true);
  const [isLoadingVisit, setIsLoadingVisit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const isInitialQueuesFetch = React.useRef(true);
  const previousTestingVisitId = React.useRef<string | null>(null);

  const selectedWaitingVisit = useMemo(
    () => waitingVisits.find((v) => v.id === selectedWaitingVisitId) || null,
    [waitingVisits, selectedWaitingVisitId]
  );

  const selectedTestingVisit = useMemo(
    () => inTestingVisits.find((v) => v.id === selectedTestingVisitId) || null,
    [inTestingVisits, selectedTestingVisitId]
  );

  const selectedHeldVisit = useMemo(
    () => onHoldVisits.find((v) => v.id === selectedHeldVisitId) || null,
    [onHoldVisits, selectedHeldVisitId]
  );

  useEffect(() => {
    fetchQueues(searchQuery, true);
    const interval = setInterval(() => {
      fetchQueues(searchQuery, false);
    }, 5000);
    return () => clearInterval(interval);
  }, [searchQuery]);

  useEffect(() => {
    let isCancelled = false;
    if (selectedTestingVisitId) {
      const isSwitchingVisit = previousTestingVisitId.current !== selectedTestingVisitId;
      if (isSwitchingVisit) {
        setIsLoadingVisit(true);
        previousTestingVisitId.current = selectedTestingVisitId;
        setIsFormDirty(false);
      }

      fetch(`/api/qa/vehicle-visits/${selectedTestingVisitId}`)
        .then((res) => res.json())
        .then((data) => {
          if (!isCancelled) {
            if (data.visit) {
              setVisitDetail(data.visit);
              if (isSwitchingVisit || !isFormDirty) {
                if (data.visit.portions && data.visit.portions.length > 0) {
                  populateInputsForPortion(data.visit.portions[0], data.visit.active_plant_tests || []);
                }
              }
            } else {
              setVisitDetail(null);
            }
            if (isSwitchingVisit) {
              setIsLoadingVisit(false);
            }
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setMsg({ text: err.message, isError: true });
            if (isSwitchingVisit) {
              setIsLoadingVisit(false);
            }
          }
        });
    } else {
      setVisitDetail(null);
      previousTestingVisitId.current = null;
      setIsFormDirty(false);
    }

    return () => {
      isCancelled = true;
    };
  }, [selectedTestingVisitId]);

  const fetchQueues = async (query = searchQuery, isInitial = false) => {
    if (isInitial && isInitialQueuesFetch.current) {
      setIsLoadingQueues(true);
    }

    try {
      const res = await fetch(`/api/qa/sessions/queues?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (res.ok) {
        const waiting: WaitingVisit[] = data.waiting || [];
        const inTesting: InTestingVisit[] = data.inTesting || [];
        const onHold: OnHoldVisit[] = data.onHold || [];

        setWaitingVisits(waiting);
        setInTestingVisits(inTesting);
        setOnHoldVisits(onHold);

        setSelectedWaitingVisitId((prev) => {
          if (prev && waiting.some((v: any) => v.id === prev)) return prev;
          return waiting.length > 0 ? waiting[0].id : null;
        });

        setSelectedTestingVisitId((prev) => {
          if (prev && inTesting.some((v: any) => v.id === prev)) return prev;
          if (inTesting.length === 0) return null;
          return inTesting[0].id;
        });

        setSelectedHeldVisitId((prev) => {
          if (prev && onHold.some((v: any) => v.id === prev)) return prev;
          return onHold.length > 0 ? onHold[0].id : null;
        });
      }
    } catch (err: any) {
      console.error('Failed to fetch QA queues', err);
    } finally {
      if (isInitial && isInitialQueuesFetch.current) {
        setIsLoadingQueues(false);
        isInitialQueuesFetch.current = false;
      }
    }
  };

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
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
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
    setIsFormDirty(false);
  };

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
    setIsFormDirty(true);
  };

  const handleTestNumericChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', textValue: '' }),
        numericValue: val,
      },
    }));
    setIsFormDirty(true);
  };

  const handleTestTextChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: '' }),
        textValue: val,
      },
    }));
    setIsFormDirty(true);
  };

  const handleTestReasonChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'NOT_PERFORMED', numericValue: '', textValue: '' }),
        notPerformedReason: val,
      },
    }));
    setIsFormDirty(true);
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
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
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
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
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
      const resultsPayload = Object.entries(testInputs).map(([testId, state]) => ({
        testId,
        performanceStatus: state.performanceStatus,
        notPerformedReason: state.performanceStatus === 'NOT_PERFORMED' ? state.notPerformedReason : null,
        numericValue: state.performanceStatus === 'PERFORMED' && state.numericValue !== '' ? Number(state.numericValue) : null,
        textValue: state.performanceStatus === 'PERFORMED' && state.textValue !== '' ? state.textValue : null,
      }));

      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'ACCEPTED',
          results: resultsPayload,
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept portion');

      toast.showSuccess(`Portion ${currentPortion.portion_number} ACCEPTED.`, 'Portion Accepted');
      setActiveActionModal(null);
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectPortionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDetail || !rejectionReason.trim()) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    const resultsPayload = Object.entries(testInputs).map(([testId, state]) => ({
      testId,
      performanceStatus: state.performanceStatus,
      notPerformedReason: state.performanceStatus === 'NOT_PERFORMED' ? state.notPerformedReason : null,
      numericValue: state.performanceStatus === 'PERFORMED' && state.numericValue !== '' ? Number(state.numericValue) : null,
      textValue: state.performanceStatus === 'PERFORMED' && state.textValue !== '' ? state.textValue : null,
    }));

    // At least one PERFORMED result is required to reject
    const performedResults = resultsPayload.filter((r) => r.performanceStatus === 'PERFORMED');
    if (performedResults.length === 0) {
      const errText = 'At least one PERFORMED Plant QA test result must be recorded before rejecting. NOT_PERFORMED alone is not sufficient rejection evidence.';
      setMsg({ text: errText, isError: true });
      toast.showError(errText, 'Validation Error');
      return;
    }

    if (!rejectionRemarks.trim()) {
      const errText = 'Rejection remarks are required.';
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
          rejectionReason: rejectionReason.trim(),
          rejectionRemarks: rejectionRemarks.trim(),
          results: resultsPayload,
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
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
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
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setIsSubmitting(false);
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

  // Format dispatch quantity display — never crash on null
  const formatDispatchQty = (portion: VisitDetailPortion | null): string => {
    if (!portion) return '—';
    const val = portion.dispatch_quantity_value;
    const unit = portion.dispatch_quantity_unit;
    if (val === null || val === undefined || !unit) return '—';
    return `${Number(val).toLocaleString()} ${unit}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-[#111311]">
      {/* QA Header & Queue Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#C4B9A3]">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#111311] flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-[#1E3A8A]" />
            QA Laboratory Workstation
          </h2>
          <p className="text-xs text-[#334155] font-semibold mt-0.5">
            Chemist: <strong className="text-[#111311]">{currentUser?.name || 'QA Chemist'}</strong> | Dedicated QA Testing & Session Controller
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-[#EFE9D9] p-1.5 rounded-2xl border border-[#C4B9A3] overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => { setActiveTab('WAITING'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'WAITING' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Waiting for Testing</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'WAITING' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {waitingVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('IN_TESTING'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'IN_TESTING' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>In Testing</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'IN_TESTING' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {inTestingVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('ON_HOLD'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'ON_HOLD' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <PauseCircle className="w-4 h-4" />
            <span>On Hold</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'ON_HOLD' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {onHoldVisits.length}
            </span>
          </button>
        </div>

        <div className="hidden lg:flex items-center space-x-1.5 px-3 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200 shrink-0">
          <Radio className="w-3 h-3 animate-pulse text-emerald-600" />
          <span>Live QA</span>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5/12): QUEUE LIST */}
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

        {/* RIGHT COLUMN (7/12): TAB-SPECIFIC WORKSPACE PANEL */}
        <div className="lg:col-span-7">
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
          />
        </div>
      </div>

      {/* Decision Action Modals */}
      <QADecisionModals
        activeActionModal={activeActionModal}
        onCloseModal={() => setActiveActionModal(null)}
        actionVisitId={actionVisitId}
        visitDetail={visitDetail}
        activePortionIndex={activePortionIndex}
        qaOpTimestamp={qaOpTimestamp}
        onQaOpTimestampChange={(val) => setQaOpTimestamp(val)}
        holdReason={holdReason}
        onHoldReasonChange={(val) => setHoldReason(val)}
        rejectionReason={rejectionReason}
        onRejectionReasonChange={(val) => setRejectionReason(val)}
        rejectionRemarks={rejectionRemarks}
        onRejectionRemarksChange={(val) => setRejectionRemarks(val)}
        onStartTestingConfirm={handleStartTesting}
        onResumeTestingConfirm={handleResumeTesting}
        onAcceptPortionConfirm={handleAcceptPortionConfirm}
        onHoldPortionConfirm={handleHoldPortionConfirm}
        onRejectPortionConfirm={handleRejectPortionConfirm}
        isSubmitting={isSubmitting}
        waitingVisits={waitingVisits}
        onHoldVisits={onHoldVisits}
      />
    </div>
  );
};
