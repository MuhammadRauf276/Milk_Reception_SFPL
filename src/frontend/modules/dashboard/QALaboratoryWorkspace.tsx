'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FlaskConical, CheckCircle2, XCircle, PauseCircle, Clock, Search, Radio, Play, RefreshCw, AlertCircle, ShieldCheck, Ban, HelpCircle } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import { User } from '@core/types';

// Performance status for a single test result in the form
type TestPerformanceStatus = 'PERFORMED' | 'NOT_PERFORMED';

interface WaitingVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  portion_count: number;
  total_declared_kg: number;
  entry_timestamp: string | null;
  waiting_minutes: number;
}

interface InTestingVisit {
  id: string;
  sessionId: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  started_by_name: string;
  started_by_user_id: string;
  started_at: string;
  elapsed_minutes: number;
  portion_count: number;
  finalized_portion_count: number;
}

interface OnHoldVisit {
  id: string;
  sessionId: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  portion_number: number;
  hold_reason: string;
  held_since: string;
  chemist_name: string;
  chemist_user_id: string;
}

interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
}

interface SavedPlantResult {
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

interface VisitDetailPortion {
  id: string;
  visit_id: string;
  portion_number: number;
  current_status: string;
  // null is preserved — no || 0 fallback
  declared_quantity_value: number | null;
  declared_quantity_unit: string;
  plant_decision: string;
  plant_rejection_reason: string | null;
  dispatch_results: any[];
  plant_results: SavedPlantResult[];
}

interface VisitDetail {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  entry_timestamp: string | null;
  current_status: string;
  visit_decision_summary: string;
  portions: VisitDetailPortion[];
  active_plant_tests: LabTestDef[];
}

// Per-test form state
interface TestInputState {
  performanceStatus: TestPerformanceStatus;
  notPerformedReason: string;
  numericValue: string;
  textValue: string;
}

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
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

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
        const waiting = data.waiting || [];
        const inTesting = data.inTesting || [];
        const onHold = data.onHold || [];

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

      if (data.visit && data.visit.portions.length > 0) {
        populateInputsForPortion(data.visit.portions[0], data.visit.active_plant_tests || []);
      }
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setIsLoadingVisit(false);
    }
  };

  // Populate per-test form state from saved plant_results.
  // NO fake defaults — if no saved result exists, the test starts as PERFORMED with empty values.
  // The chemist must explicitly set values or mark NOT_PERFORMED.
  const populateInputsForPortion = (portion: VisitDetailPortion, plantTests: LabTestDef[]) => {
    const existingMap = new Map(portion.plant_results.map((pr) => [pr.testId, pr]));
    const newInputs: Record<string, TestInputState> = {};

    plantTests.forEach((t) => {
      const existing = existingMap.get(t.id);

      if (existing) {
        // Restore from saved PlantLabResult
        newInputs[t.id] = {
          performanceStatus: (existing.performanceStatus === 'NOT_PERFORMED' ? 'NOT_PERFORMED' : 'PERFORMED') as TestPerformanceStatus,
          notPerformedReason: existing.notPerformedReason || '',
          numericValue: existing.numericValue !== null && existing.numericValue !== undefined ? String(existing.numericValue) : '',
          textValue: existing.textValue !== null && existing.textValue !== undefined ? String(existing.textValue) : '',
        };
      } else {
        // No saved result — start clean, no fake defaults
        newInputs[t.id] = {
          performanceStatus: 'PERFORMED',
          notPerformedReason: '',
          numericValue: '',
          textValue: '',
        };
      }
    });

    setTestInputs(newInputs);
  };

  const handleSelectPortionTab = (index: number) => {
    if (!visitDetail) return;
    setActivePortionIndex(index);
    const targetPortion = visitDetail.portions[index];
    if (targetPortion) {
      populateInputsForPortion(targetPortion, visitDetail.active_plant_tests);
    }
  };

  // Build the results payload for API calls
  const buildResultsPayload = () => {
    return Object.entries(testInputs).map(([testId, state]) => ({
      testId,
      performanceStatus: state.performanceStatus,
      notPerformedReason: state.performanceStatus === 'NOT_PERFORMED' ? (state.notPerformedReason || null) : null,
      numericValue: state.performanceStatus === 'PERFORMED' && state.numericValue !== '' ? Number(state.numericValue) : null,
      textValue: state.performanceStatus === 'PERFORMED' && state.textValue !== '' ? state.textValue : null,
    }));
  };

  const handleStartTestingConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedWaitingVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
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
      if (!res.ok) throw new Error(data.error || 'Failed to start testing');

      toast.showSuccess(`QA testing session started for vehicle ${data.visit?.vehicle_number || ''}.`, 'Session Started');
      setActiveActionModal(null);
      setSelectedWaitingVisitId(null);
      setSelectedTestingVisitId(targetVisitId);
      setActiveTab('IN_TESTING');
      await fetchVisitDetail(targetVisitId);
      await fetchQueues();
    } catch (err: any) {
      toast.showError(err.message || 'Failed to start testing', 'QA Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumeTestingConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVisitId = actionVisitId || selectedHeldVisitId;
    if (!targetVisitId) return;

    setIsSubmitting(true);
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
      if (!res.ok) throw new Error(data.error || 'Failed to resume testing');

      toast.showInfo('QA testing session resumed.', 'Session Resumed');
      setActiveActionModal(null);
      setSelectedHeldVisitId(null);
      setSelectedTestingVisitId(targetVisitId);
      setActiveTab('IN_TESTING');
      await fetchVisitDetail(targetVisitId);
      await fetchQueues();
    } catch (err: any) {
      toast.showError(err.message || 'Failed to resume testing', 'QA Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!visitDetail) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: buildResultsPayload() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save draft');

      toast.showSuccess(`Draft saved for Portion ${currentPortion.portion_number}.`, 'Draft Saved');
      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();
    } catch (err: any) {
      toast.showError(err.message || 'Failed to save draft', 'QA Error');
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

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitDetail.id}/portions/${currentPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'ACCEPTED',
          results: buildResultsPayload(),
          operationalTimestamp: datetimeLocalToIso(qaOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept portion');

      toast.showSuccess(`Portion ${currentPortion.portion_number} ACCEPTED.`, 'Portion Accepted');
      setActiveActionModal(null);

      await fetchVisitDetail(visitDetail.id);
      await fetchQueues();

      if (activePortionIndex < visitDetail.portions.length - 1) {
        handleSelectPortionTab(activePortionIndex + 1);
      }
    } catch (err: any) {
      toast.showError(err.message || 'Failed to accept portion', 'QA Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectPortionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDetail || !rejectionReason.trim()) return;
    const currentPortion = visitDetail.portions[activePortionIndex];
    if (!currentPortion) return;

    // At least one PERFORMED result is required to reject
    const performedResults = buildResultsPayload().filter((r) => r.performanceStatus === 'PERFORMED');

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
          results: buildResultsPayload(),
          rejectionReason: rejectionReason.trim(),
          rejectionRemarks: rejectionRemarks.trim(),
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
  const currentPortion = visitDetail?.portions[activePortionIndex] || null;

  // Only non-CALCULATED required tests count toward mandatory accountability
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

  // Format declared quantity display — never crash on null
  const formatDeclaredQty = (portion: VisitDetailPortion | null): string => {
    if (!portion) return '—';
    if (portion.declared_quantity_value === null || portion.declared_quantity_value === undefined) return '—';
    return `${Number(portion.declared_quantity_value).toLocaleString()} ${portion.declared_quantity_unit || 'KG'}`;
  };

  return (
    <div className="space-y-6">
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

        <div className="flex items-center space-x-2 bg-[#EFE9D9] p-1.5 rounded-2xl border border-[#C4B9A3]">
          <button
            type="button"
            onClick={() => { setActiveTab('WAITING'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${activeTab === 'WAITING' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'}`}
          >
            <Clock className="w-4 h-4" />
            <span>Waiting for Testing</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'WAITING' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {waitingVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('IN_TESTING'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${activeTab === 'IN_TESTING' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'}`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>In Testing</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'IN_TESTING' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {inTestingVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('ON_HOLD'); fetchQueues(); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${activeTab === 'ON_HOLD' ? 'bg-[#1E3A8A] text-white shadow-sm' : 'text-[#334155] hover:bg-amber-100/50'}`}
          >
            <PauseCircle className="w-4 h-4" />
            <span>On Hold</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'ON_HOLD' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {onHoldVisits.length}
            </span>
          </button>
        </div>

        <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200">
          <Radio className="w-3 h-3 animate-pulse text-emerald-600" />
          <span>Live</span>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN (5/12): QUEUE LIST */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-[#111311]">
              {activeTab === 'WAITING' ? 'Waiting Queue' : activeTab === 'IN_TESTING' ? 'In Testing Sessions' : 'On Hold Queue'}
            </h3>
            <span className="text-xs font-mono font-bold text-slate-500">
              {activeTab === 'WAITING' ? `${waitingVisits.length} ready` : activeTab === 'IN_TESTING' ? `${inTestingVisits.length} active` : `${onHoldVisits.length} held`}
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); fetchQueues(e.target.value); }}
              placeholder="Search vehicle or token..."
              className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
            />
          </div>

          {/* Queue Content */}
          <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
            {isLoadingQueues ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading QA queues...
              </div>
            ) : activeTab === 'WAITING' ? (
              waitingVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No vehicles waiting for QA testing.
                </div>
              ) : (
                waitingVisits.map((v) => {
                  const isSelected = selectedWaitingVisitId === v.id;
                  return (
                    <div
                      key={`waiting-${v.id}`}
                      onClick={() => setSelectedWaitingVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${isSelected ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30' : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                            ({v.token_number || 'No Token'})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'}`}>
                          Waiting
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                        <span>{v.portion_count} Portion{v.portion_count > 1 ? 's' : ''} ({v.total_declared_kg.toLocaleString()} KG)</span>
                        <span>Waiting: {v.waiting_minutes} min</span>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={(e) => { e.stopPropagation(); openActionModal('START', v.id); }}
                        className="w-full mt-1 py-2 px-3 rounded-lg bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-1.5 shadow-sm"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start Testing</span>
                      </button>
                    </div>
                  );
                })
              )
            ) : activeTab === 'IN_TESTING' ? (
              inTestingVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No QA testing sessions in progress.
                </div>
              ) : (
                inTestingVisits.map((v) => {
                  const isSelected = selectedTestingVisitId === v.id;
                  return (
                    <div
                      key={`in-testing-${v.id}`}
                      onClick={() => setSelectedTestingVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${isSelected ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30' : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                            ({v.token_number || 'No Token'})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'}`}>
                          In Testing
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                        <span>Chemist: {v.started_by_name}</span>
                        <span>Elapsed: {v.elapsed_minutes} min</span>
                      </div>

                      <div className={`text-[11px] font-mono font-bold ${isSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                        Portions: {v.finalized_portion_count} of {v.portion_count} finalized
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              onHoldVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No QA sessions currently on hold.
                </div>
              ) : (
                onHoldVisits.map((v) => {
                  const isSelected = selectedHeldVisitId === v.id;
                  return (
                    <div
                      key={`on-hold-${v.id}`}
                      onClick={() => setSelectedHeldVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${isSelected ? 'bg-amber-900 text-white border-amber-950 shadow-md ring-2 ring-amber-500/30' : 'bg-amber-50 text-[#111311] border-amber-200 hover:bg-amber-100/80'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          <span className={`font-mono text-xs font-bold ${isSelected ? 'text-amber-200' : 'text-amber-800'}`}>
                            ({v.token_number || 'No Token'})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900 border border-amber-300'}`}>
                          ON HOLD
                        </span>
                      </div>

                      <p className={`text-xs font-bold p-2 rounded-lg border ${isSelected ? 'bg-amber-950/60 text-amber-100 border-amber-800' : 'bg-amber-100/60 text-amber-900 border-amber-200'}`}>
                        Reason: {v.hold_reason}
                      </p>

                      <div className={`flex items-center justify-between text-[11px] font-bold ${isSelected ? 'text-amber-200' : 'text-amber-800'}`}>
                        <span>Chemist: {v.chemist_name}</span>
                        <span>Held since: {new Date(v.held_since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={(e) => { e.stopPropagation(); openActionModal('RESUME', v.id); }}
                        className="w-full mt-1 py-2 px-3 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-1.5 shadow-sm"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Resume Testing</span>
                      </button>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (7/12): TAB-SPECIFIC WORKSPACE PANEL */}
        <div className="lg:col-span-7">
          {activeTab === 'WAITING' ? (
            !selectedWaitingVisit ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                {searchQuery ? 'No matching vehicles found.' : 'No vehicles are waiting for QA testing.'}
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                <div className="pb-3 border-b border-[#C4B9A3]">
                  <h3 className="text-base font-extrabold text-[#111311]">Vehicle Waiting for QA</h3>
                  <p className="text-xs text-[#334155] font-semibold mt-0.5">
                    Vehicle: <strong className="font-mono text-[#111311]">{selectedWaitingVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E3A8A]">{selectedWaitingVisit.token_number || 'NO-TOKEN'}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Declared Volume</span>
                    <span>{selectedWaitingVisit.total_declared_kg.toLocaleString()} KG ({selectedWaitingVisit.portion_count} Portion{selectedWaitingVisit.portion_count > 1 ? 's' : ''})</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Gate Entry Time</span>
                    <span>{selectedWaitingVisit.entry_timestamp ? new Date(selectedWaitingVisit.entry_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Just arrived'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Waiting Time</span>
                    <span className="text-amber-800 font-black">{selectedWaitingVisit.waiting_minutes} minutes</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Status</span>
                    <span className="text-blue-800 font-black">Awaiting Testing</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => openActionModal('START', selectedWaitingVisit.id)}
                  className="w-full py-3 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-2 shadow-md"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start QA Testing</span>
                </button>
              </div>
            )
          ) : activeTab === 'IN_TESTING' ? (
            !selectedTestingVisitId || !visitDetail ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                {searchQuery ? 'No matching QA sessions found.' : 'No QA testing sessions are currently active.'}
              </div>
            ) : isLoadingVisit ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading vehicle lab tests...
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-4 text-[#111311]">
                {/* Sticky Context Header */}
                <div className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] shadow-sm flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black font-mono tracking-tight text-[#111311]">
                      {visitDetail.vehicle_number} • {visitDetail.token_number || 'NO-TOKEN'} • Portion {activePortionIndex + 1} of {visitDetail.portions.length}
                    </h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Operational Date: {visitDetail.operational_date || 'Today'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-extrabold uppercase bg-blue-100 text-[#1E3A8A] font-mono border border-blue-300">
                    Testing
                  </span>
                </div>

                {/* Portion Navigation Selector Tabs */}
                <div className="flex items-center space-x-2 border-b border-[#C4B9A3] pb-2">
                  {visitDetail.portions.map((p, idx) => {
                    const isSelected = activePortionIndex === idx;
                    const isAccepted = p.plant_decision === 'ACCEPTED';
                    const isRejected = p.plant_decision === 'REJECTED';
                    const isHold = p.plant_decision === 'HOLD';

                    return (
                      <button
                        key={`portion-tab-${p.id}`}
                        type="button"
                        onClick={() => handleSelectPortionTab(idx)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center space-x-1.5 ${isSelected ? 'bg-[#1E3A8A] text-white shadow-sm' : 'bg-[#F4EFE3] text-[#334155] border border-[#C4B9A3] hover:bg-amber-100/50'}`}
                      >
                        {isAccepted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isRejected ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        ) : isHold ? (
                          <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <FlaskConical className="w-3.5 h-3.5" />
                        )}
                        <span>Portion {p.portion_number}</span>
                        <span className="text-[10px] uppercase font-mono opacity-80">
                          ({p.plant_decision || 'Pending'})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Active Portion Details */}
                {currentPortion && (
                  <div className="space-y-4">
                    {/* Declared Quantity & Accountability Counter — crash-safe */}
                    <div className="flex items-center justify-between text-xs font-bold text-[#334155]">
                      <span>
                        Declared Quantity: <strong className="font-mono text-[#111311]">{formatDeclaredQty(currentPortion)}</strong>
                      </span>
                      <span>{performedCount} of {requiredManualPlantTests.length} required tests PERFORMED</span>
                    </div>

                    {/* Accountability summary badges */}
                    <div className="flex items-center gap-2 text-[10px] font-mono font-bold">
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {performedCount} PERFORMED
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg flex items-center gap-1 ${notPerformedCount > 0 ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                        <Ban className="w-3 h-3" />
                        {notPerformedCount} NOT PERFORMED
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg flex items-center gap-1 ${unresolvedCount > 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                        <HelpCircle className="w-3 h-3" />
                        {unresolvedCount} UNRESOLVED
                      </span>
                    </div>

                    {currentPortion.plant_rejection_reason && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                        Note: {currentPortion.plant_rejection_reason}
                      </div>
                    )}

                    {msg && (
                      <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${msg.isError ? 'bg-rose-50 border border-rose-200 text-rose-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {msg.text}
                      </div>
                    )}

                    {/* Dynamic Plant QA Lab Tests Form */}
                    <div className="space-y-3 pt-1">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                        Plant Laboratory Test Inputs
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
                        {visitDetail.active_plant_tests.map((test) => {
                          const state = testInputs[test.id] || { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: '', textValue: '' };
                          const isNotPerformed = state.performanceStatus === 'NOT_PERFORMED';

                          return (
                            <div
                              key={`plant-test-${test.id}`}
                              className={`p-3 rounded-xl border space-y-2 ${isNotPerformed ? 'bg-rose-50 border-rose-200' : 'bg-[#F4EFE3] border-[#C4B9A3]'}`}
                            >
                              {/* Test header */}
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span>
                                  {test.testName} {test.isRequired && <span className="text-rose-600">*</span>}
                                </span>
                                {test.unit && (
                                  <span className="text-[10px] font-mono text-slate-500">({test.unit})</span>
                                )}
                              </div>

                              {/* PERFORMED / NOT_PERFORMED toggle — hidden for CALCULATED tests */}
                              {test.resultType !== 'CALCULATED' && (
                                <div className="flex items-center space-x-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsFormDirty(true);
                                      setTestInputs((prev) => ({
                                        ...prev,
                                        [test.id]: { ...state, performanceStatus: 'PERFORMED' },
                                      }));
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-black transition ${state.performanceStatus === 'PERFORMED' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                                  >
                                    PERFORMED
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsFormDirty(true);
                                      setTestInputs((prev) => ({
                                        ...prev,
                                        [test.id]: { ...state, performanceStatus: 'NOT_PERFORMED', numericValue: '', textValue: '' },
                                      }));
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-black transition ${state.performanceStatus === 'NOT_PERFORMED' ? 'bg-rose-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                                  >
                                    NOT PERFORMED
                                  </button>
                                </div>
                              )}

                              {/* NOT_PERFORMED reason textarea */}
                              {isNotPerformed && test.resultType !== 'CALCULATED' && (
                                <textarea
                                  value={state.notPerformedReason}
                                  onChange={(e) => {
                                    setIsFormDirty(true);
                                    setTestInputs((prev) => ({
                                      ...prev,
                                      [test.id]: { ...state, notPerformedReason: e.target.value },
                                    }));
                                  }}
                                  placeholder="Reason not performed..."
                                  rows={2}
                                  className="w-full px-2 py-1.5 text-[10px] font-mono font-bold rounded-lg border border-rose-300 bg-white text-rose-900 resize-none focus:outline-none focus:ring-1 focus:ring-rose-400"
                                />
                              )}

                              {/* Value input — only when PERFORMED */}
                              {!isNotPerformed && (
                                <>
                                  {test.resultType === 'NUMERIC' ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={state.numericValue}
                                      onChange={(e) => {
                                        setIsFormDirty(true);
                                        setTestInputs((prev) => ({
                                          ...prev,
                                          [test.id]: { ...state, numericValue: e.target.value },
                                        }));
                                      }}
                                      placeholder="Enter value"
                                      className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-white text-[#111311]"
                                    />
                                  ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                    <QualitativeResultRadioGroup
                                      name={`qa-${visitDetail.id}-${currentPortion.id}-${test.id}`}
                                      value={state.textValue || null}
                                      options={test.resultOptions}
                                      onChange={(val) => {
                                        setIsFormDirty(true);
                                        setTestInputs((prev) => ({
                                          ...prev,
                                          [test.id]: { ...state, textValue: val },
                                        }));
                                      }}
                                      ariaLabel={`${test.testName} result for Portion ${currentPortion.portion_number}`}
                                    />
                                  ) : test.resultType === 'CALCULATED' ? (
                                    <div className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-slate-100 text-slate-700 flex items-center justify-between">
                                      <span>{state.numericValue || 'Auto-Calculated'}</span>
                                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-blue-700">Calculated</span>
                                    </div>
                                  ) : (
                                    <input
                                      type="text"
                                      value={state.textValue}
                                      onChange={(e) => {
                                        setIsFormDirty(true);
                                        setTestInputs((prev) => ({
                                          ...prev,
                                          [test.id]: { ...state, textValue: e.target.value },
                                        }));
                                      }}
                                      placeholder="Enter text result"
                                      className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-white text-[#111311]"
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#C4B9A3]">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleSaveDraft}
                        className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                      >
                        Save Draft
                      </button>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => openActionModal('HOLD')}
                          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-sm"
                        >
                          Hold
                        </button>

                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => openActionModal('REJECT')}
                          className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold transition shadow-sm"
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          disabled={isSubmitting || !canAccept}
                          onClick={() => openActionModal('ACCEPT')}
                          title={!canAccept ? 'All required tests must be PERFORMED with valid values to accept.' : undefined}
                          className={`px-5 py-2 rounded-xl text-white text-xs font-extrabold transition shadow-md ${canAccept ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-400 cursor-not-allowed'}`}
                        >
                          Accept Portion
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            /* ON_HOLD TAB */
            !selectedHeldVisit ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                {searchQuery ? 'No matching QA sessions found.' : 'No QA sessions are currently on hold.'}
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                <div className="pb-3 border-b border-[#C4B9A3] flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-amber-900 flex items-center gap-2">
                      <PauseCircle className="w-5 h-5 text-amber-700" />
                      QA Session On Hold
                    </h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedHeldVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E3A8A]">{selectedHeldVisit.token_number || 'NO-TOKEN'}</strong>
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-extrabold uppercase bg-amber-100 text-amber-900 font-mono border border-amber-300">
                    On Hold
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold space-y-2 text-amber-950">
                  <div className="flex items-center justify-between">
                    <span>Chemist: <strong>{selectedHeldVisit.chemist_name}</strong></span>
                    <span>Held Since: <strong>{new Date(selectedHeldVisit.held_since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-mono block">Hold Reason</span>
                    <p className="mt-0.5 text-amber-900 bg-white/80 p-2 rounded-lg border border-amber-200">{selectedHeldVisit.hold_reason}</p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => openActionModal('RESUME', selectedHeldVisit.id)}
                  className="w-full py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-2 shadow-md"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Resume Testing</span>
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Start QA Testing Modal */}
      {activeActionModal === 'START' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleStartTestingConfirm} className="bg-[#EFE9D9] border border-[#C4B9A3] p-6 rounded-2xl max-w-md w-full space-y-4 text-[#111311]">
            <h3 className="text-base font-extrabold text-[#1E3A8A] flex items-center gap-2">
              <Play className="w-5 h-5" />
              Start QA Testing Session
            </h3>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>QA Start Time *</span>
                <Clock className="w-3.5 h-3.5 text-blue-700" />
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                min={selectedWaitingVisit?.entry_timestamp ? toDatetimeLocalInput(selectedWaitingVisit.entry_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setQaOpTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <p className="text-[11px] text-slate-600 font-medium mt-1">
                Min: Gate Entry timestamp ({selectedWaitingVisit?.entry_timestamp ? new Date(selectedWaitingVisit.entry_timestamp).toLocaleTimeString() : 'N/A'})
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setActiveActionModal(null)} className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-extrabold shadow-md hover:bg-blue-900 disabled:opacity-50">Start Session</button>
            </div>
          </form>
        </div>
      )}

      {/* Resume QA Testing Modal */}
      {activeActionModal === 'RESUME' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleResumeTestingConfirm} className="bg-[#EFE9D9] border border-[#C4B9A3] p-6 rounded-2xl max-w-md w-full space-y-4 text-[#111311]">
            <h3 className="text-base font-extrabold text-amber-800 flex items-center gap-2">
              <Play className="w-5 h-5" />
              Resume QA Testing Session
            </h3>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>QA Resume Time *</span>
                <Clock className="w-3.5 h-3.5 text-amber-700" />
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                min={selectedHeldVisit?.held_since ? toDatetimeLocalInput(selectedHeldVisit.held_since) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setQaOpTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
              <p className="text-[11px] text-slate-600 font-medium mt-1">
                Min: Latest HOLD timestamp ({selectedHeldVisit?.held_since ? new Date(selectedHeldVisit.held_since).toLocaleTimeString() : 'N/A'})
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setActiveActionModal(null)} className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-5 py-2 rounded-xl bg-amber-700 text-white text-xs font-extrabold shadow-md hover:bg-amber-800 disabled:opacity-50">Resume Session</button>
            </div>
          </form>
        </div>
      )}

      {/* Accept Portion Modal */}
      {activeActionModal === 'ACCEPT' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleAcceptPortionConfirm} className="bg-[#EFE9D9] border border-[#C4B9A3] p-6 rounded-2xl max-w-md w-full space-y-4 text-[#111311]">
            <h3 className="text-base font-extrabold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Accept Portion #{currentPortion?.portion_number}
            </h3>

            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-900 space-y-1.5">
              <div>PERFORMED: {performedCount} / {requiredManualPlantTests.length} required tests</div>
              {notPerformedCount > 0 && <div className="text-rose-700">⚠ NOT PERFORMED: {notPerformedCount} (blocks ACCEPT)</div>}
              {unresolvedCount > 0 && <div className="text-amber-700">⚠ UNRESOLVED: {unresolvedCount} (blocks ACCEPT)</div>}
              {canAccept && <div className="text-emerald-700 text-[11px]">All required plant lab tests are PERFORMED. Ready to accept.</div>}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>Acceptance Time *</span>
                <Clock className="w-3.5 h-3.5 text-emerald-700" />
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                min={visitDetail?.entry_timestamp ? toDatetimeLocalInput(visitDetail.entry_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setQaOpTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setActiveActionModal(null)} className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold">Cancel</button>
              <button type="submit" disabled={isSubmitting || !canAccept} className="px-5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-extrabold shadow-md hover:bg-emerald-800 disabled:opacity-50">
                Confirm Accept
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reject Action Modal */}
      {activeActionModal === 'REJECT' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleRejectPortionConfirm} className="bg-[#EFE9D9] border border-[#C4B9A3] p-6 rounded-2xl max-w-md w-full space-y-4 text-[#111311]">
            <h3 className="text-base font-extrabold text-rose-800 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Confirm Portion Rejection
            </h3>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs font-bold text-amber-900 space-y-1">
              <div>PERFORMED: {performedCount} (genuine evidence required)</div>
              <div className="text-[11px] text-amber-700">
                Unresolved required tests will be auto-finalized as NOT_PERFORMED (VEHICLE_REJECTED_BEFORE_TEST_COMPLETION).
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Rejection Reason *</label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. High acidity / FAT below threshold / Positive adulteration test"
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] h-16 outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Rejection Remarks *</label>
              <textarea
                value={rejectionRemarks}
                onChange={(e) => setRejectionRemarks(e.target.value)}
                placeholder="e.g. Detailed chemist lab observations, sample retest notes..."
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] h-16 outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>Rejection Time *</span>
                <Clock className="w-3.5 h-3.5 text-rose-700" />
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                min={(visitDetail?.entry_timestamp || selectedHeldVisit?.held_since) ? toDatetimeLocalInput(visitDetail?.entry_timestamp || selectedHeldVisit?.held_since) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setQaOpTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setActiveActionModal(null)} className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold">Cancel</button>
              <button
                type="submit"
                disabled={isSubmitting || !rejectionReason.trim() || !rejectionRemarks.trim()}
                className="px-5 py-2 rounded-xl bg-rose-700 text-white text-xs font-extrabold shadow-md hover:bg-rose-800 disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hold Action Modal */}
      {activeActionModal === 'HOLD' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleHoldPortionConfirm} className="bg-[#EFE9D9] border border-[#C4B9A3] p-6 rounded-2xl max-w-md w-full space-y-4 text-[#111311]">
            <h3 className="text-base font-extrabold text-amber-800 flex items-center gap-2">
              <PauseCircle className="w-5 h-5" />
              Place Portion on Hold
            </h3>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs font-bold text-amber-900">
              <div className="text-[11px]">
                Current test state will be preserved: {performedCount} PERFORMED, {notPerformedCount} NOT_PERFORMED, {unresolvedCount} UNRESOLVED.
                No auto-finalization occurs on HOLD.
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Hold Reason *</label>
              <textarea
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g. Retest required / Supervisor review / Inconclusive result"
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] h-20 outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>Hold Time *</span>
                <Clock className="w-3.5 h-3.5 text-amber-700" />
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                min={(visitDetail?.entry_timestamp || selectedHeldVisit?.held_since) ? toDatetimeLocalInput(visitDetail?.entry_timestamp || selectedHeldVisit?.held_since) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setQaOpTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] outline-none focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setActiveActionModal(null)} className="px-4 py-2 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold">Cancel</button>
              <button
                type="submit"
                disabled={isSubmitting || !holdReason.trim()}
                className="px-5 py-2 rounded-xl bg-amber-700 text-white text-xs font-extrabold shadow-md hover:bg-amber-800 disabled:opacity-50"
              >
                Place on Hold
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
