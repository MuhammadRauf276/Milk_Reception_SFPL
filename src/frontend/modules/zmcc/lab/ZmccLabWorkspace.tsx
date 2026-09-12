'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@backend/core/types';
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  Search,
  FileText,
  Calendar,
  Building2,
  Edit3,
  X,
  ShieldAlert,
  ArrowRight,
  Save,
  Calculator,
} from 'lucide-react';

import { useToast } from '@/frontend/context/ToastContext';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { isLrTestCandidate, isFatTestCandidate } from '@/backend/utils/milkTestResolvers';

interface ZmccLabWorkspaceProps {
  currentUser: User | null;
}

type MainTab = 'QUEUE' | 'TESTING' | 'HISTORY';

export const ZmccLabWorkspace: React.FC<ZmccLabWorkspaceProps> = ({ currentUser }) => {
  const toast = useToast();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isZmccLabAttendant = currentUser?.role === 'ZMCC_LAB_ATTENDANT';
  const canTest = isZmccLabAttendant || isSuperAdmin;
  const canCorrect = isZmccManager || isSuperAdmin;

  const [activeTab, setActiveTab] = useState<MainTab>('QUEUE');

  // Queue State
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');

  // Active Session State
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, { numeric_value: any; text_value: any }>>({});
  const [draftRemarks, setDraftRemarks] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  const [draftQuantityValue, setDraftQuantityValue] = useState<string>('');
  const [draftQuantityUnit, setDraftQuantityUnit] = useState<'KG' | 'LITER'>('KG');

  // Completion Modal State
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionDecision, setCompletionDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [rejectionReason, setRejectionReason] = useState('');
  const [completionRemarks, setCompletionRemarks] = useState('');
  const [completingSession, setCompletingSession] = useState(false);
  const [completionEventId, setCompletionEventId] = useState('');

  // History State
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyDecision, setHistoryDecision] = useState<string>('ALL');

  // View / Correction Modal State
  const [selectedHistorySession, setSelectedHistorySession] = useState<any | null>(null);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionQuantityValue, setCorrectionQuantityValue] = useState<string>('');
  const [correctionQuantityUnit, setCorrectionQuantityUnit] = useState<'KG' | 'LITER'>('KG');
  const [correctionDecision, setCorrectionDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [correctionRejectionReason, setCorrectionRejectionReason] = useState('');
  const [correctionRemarks, setCorrectionRemarks] = useState('');
  const [correctionValues, setCorrectionValues] = useState<Record<string, { numeric_value: any; text_value: any }>>({});
  const [savingCorrection, setSavingCorrection] = useState(false);

  // Helper to compute live preview metrics
  const calculatePreview = useCallback((
    qtyStr: string,
    unit: 'KG' | 'LITER',
    values: Record<string, { numeric_value: any; text_value: any }>,
    results: any[]
  ) => {
    const q = Number(qtyStr);
    if (!qtyStr || isNaN(q) || q <= 0) return null;

    let lrVal: number | null = null;
    let fatVal: number | null = null;

    for (const r of results || []) {
      const code = r.test_code_snapshot;
      const name = r.test_name_snapshot;
      const type = r.result_type_snapshot;
      const val = values[r.test_id]?.numeric_value;
      if (val !== '' && val !== null && val !== undefined) {
        const num = Number(val);
        if (!isNaN(num)) {
          if (isLrTestCandidate(code, name, type)) {
            lrVal = num;
          } else if (isFatTestCandidate(code, name, type)) {
            fatVal = num;
          }
        }
      }
    }

    if (lrVal === null || lrVal <= 0 || fatVal === null || fatVal < 0) {
      return null;
    }

    try {
      return computeCanonicalMilkMetrics(q, unit, lrVal, fatVal);
    } catch {
      return null;
    }
  }, []);

  // Generate unique completion client event id
  const generateCompletionEventId = useCallback(() => {
    return `zmcc-lab-comp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  // Fetch Queue
  const fetchQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const res = await fetch('/api/zmcc/lab/queue', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setQueueItems(Array.isArray(data) ? data : []);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to fetch queue');
      }
    } catch {
      toast.showError('Network error while fetching queue');
    } finally {
      setLoadingQueue(false);
    }
  }, [toast]);

  // Fetch History
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (historyDate) params.append('date', historyDate);
      if (historyDecision && historyDecision !== 'ALL') params.append('decision', historyDecision);
      if (historySearch) params.append('search', historySearch);

      const res = await fetch(`/api/zmcc/lab/history?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(data.items || []);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to fetch lab history');
      }
    } catch {
      toast.showError('Network error while fetching lab history');
    } finally {
      setLoadingHistory(false);
    }
  }, [historyDate, historyDecision, historySearch, toast]);

  useEffect(() => {
    if (activeTab === 'QUEUE') {
      fetchQueue();
    } else if (activeTab === 'HISTORY') {
      fetchHistory();
    }
  }, [activeTab, fetchQueue, fetchHistory]);

  // Start or resume session from queue
  const handleStartOrResume = async (item: any) => {
    setLoadingSession(true);
    try {
      const res = await fetch('/api/zmcc/lab/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrival_type: item.queue_type,
          arrival_id: item.arrival_id,
        }),
      });

      if (res.ok) {
        const session = await res.json();
        loadSessionIntoState(session);
        setActiveTab('TESTING');
        toast.showSuccess(`Testing session active for ${item.queue_type} arrival`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to start testing session');
      }
    } catch {
      toast.showError('Network error starting lab session');
    } finally {
      setLoadingSession(false);
    }
  };

  const loadSessionIntoState = (session: any) => {
    setActiveSession(session);
    setDraftRemarks(session.remarks || '');
    setDraftQuantityValue(session.quantity_value !== null && session.quantity_value !== undefined ? String(session.quantity_value) : '');
    setDraftQuantityUnit((session.quantity_unit as 'KG' | 'LITER') || 'KG');
    const initialVals: Record<string, { numeric_value: any; text_value: any }> = {};
    if (session.results) {
      for (const r of session.results) {
        initialVals[r.test_id] = {
          numeric_value: r.numeric_value !== null && r.numeric_value !== undefined ? r.numeric_value : '',
          text_value: r.text_value || '',
        };
      }
    }
    setDraftValues(initialVals);
  };

  // Save draft values
  const handleSaveDraft = async () => {
    if (!activeSession) return;
    setSavingDraft(true);
    try {
      const payloadResults = Object.keys(draftValues).map((testId) => ({
        test_id: testId,
        numeric_value: draftValues[testId].numeric_value !== '' && draftValues[testId].numeric_value !== null ? Number(draftValues[testId].numeric_value) : null,
        text_value: draftValues[testId].text_value ? String(draftValues[testId].text_value).trim() : null,
      }));

      const res = await fetch(`/api/zmcc/lab/sessions/${activeSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity_value: draftQuantityValue !== '' ? Number(draftQuantityValue) : null,
          quantity_unit: draftQuantityUnit,
          results: payloadResults,
          remarks: draftRemarks,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        loadSessionIntoState(updated);
        toast.showSuccess('Draft test values saved successfully.');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to save draft results');
      }
    } catch {
      toast.showError('Network error saving draft');
    } finally {
      setSavingDraft(false);
    }
  };

  // Open completion modal
  const openCompleteModal = (decision: 'ACCEPTED' | 'REJECTED') => {
    if (!draftQuantityValue || Number(draftQuantityValue) <= 0) {
      toast.showError('Actual milk quantity is required and must be greater than 0.');
      return;
    }
    setCompletionDecision(decision);
    setRejectionReason('');
    setCompletionRemarks(draftRemarks);
    setCompletionEventId(generateCompletionEventId());
    setShowCompleteModal(true);
  };

  // Submit completion
  const handleCompleteSession = async () => {
    if (!activeSession) return;
    if (!draftQuantityValue || Number(draftQuantityValue) <= 0) {
      toast.showError('Actual milk quantity is required and must be greater than 0.');
      return;
    }
    if (completionDecision === 'REJECTED' && !rejectionReason.trim()) {
      toast.showError('Rejection reason is mandatory when rejecting.');
      return;
    }

    setCompletingSession(true);
    try {
      const payloadResults = (activeSession.results || []).map((r: any) => {
        const testId = String(r.test_id);
        const dv = draftValues[testId] || { numeric_value: '', text_value: '' };
        if (r.result_type_snapshot === 'CALCULATED') {
          return {
            test_id: testId,
            numeric_value: null,
            text_value: null,
          };
        }
        return {
          test_id: testId,
          numeric_value: r.result_type_snapshot === 'NUMERIC' && dv.numeric_value !== '' && dv.numeric_value !== null ? Number(dv.numeric_value) : null,
          text_value: r.result_type_snapshot !== 'NUMERIC' && dv.text_value ? String(dv.text_value).trim() : null,
        };
      });

      const res = await fetch(`/api/zmcc/lab/sessions/${activeSession.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completion_client_event_id: completionEventId,
          quantity_value: Number(draftQuantityValue),
          quantity_unit: draftQuantityUnit,
          decision: completionDecision,
          rejection_reason: completionDecision === 'REJECTED' ? rejectionReason.trim() : null,
          remarks: completionRemarks.trim() || null,
          results: payloadResults,
        }),
      });

      if (res.ok) {
        const completed = await res.json();
        setShowCompleteModal(false);
        setActiveSession(null);
        toast.showSuccess(`Session finalized: ${completionDecision}`);
        setActiveTab('HISTORY');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to complete lab session');
      }
    } catch {
      toast.showError('Network error completing lab session');
    } finally {
      setCompletingSession(false);
    }
  };

  // Open correction modal
  const openCorrection = (session: any) => {
    setSelectedHistorySession(session);
    setCorrectionReason('');
    setCorrectionQuantityValue(session.quantity_value !== null && session.quantity_value !== undefined ? String(session.quantity_value) : '');
    setCorrectionQuantityUnit((session.quantity_unit as 'KG' | 'LITER') || 'KG');
    setCorrectionDecision(session.decision || 'ACCEPTED');
    setCorrectionRejectionReason(session.rejection_reason || '');
    setCorrectionRemarks(session.remarks || '');
    const vals: Record<string, { numeric_value: any; text_value: any }> = {};
    if (session.results) {
      for (const r of session.results) {
        vals[r.test_id] = {
          numeric_value: r.numeric_value !== null && r.numeric_value !== undefined ? r.numeric_value : '',
          text_value: r.text_value || '',
        };
      }
    }
    setCorrectionValues(vals);
    setShowCorrectionModal(true);
  };

  // Submit correction
  const handleSaveCorrection = async () => {
    if (!selectedHistorySession) return;
    if (!correctionReason.trim()) {
      toast.showError('Audit correction reason is mandatory.');
      return;
    }
    if (correctionQuantityValue && Number(correctionQuantityValue) <= 0) {
      toast.showError('Corrected quantity must be greater than 0.');
      return;
    }
    if (correctionDecision === 'REJECTED' && !correctionRejectionReason.trim()) {
      toast.showError('Rejection reason is mandatory when decision is REJECTED.');
      return;
    }

    setSavingCorrection(true);
    try {
      const payloadResults = Object.keys(correctionValues).map((testId) => ({
        test_id: testId,
        numeric_value: correctionValues[testId].numeric_value !== '' && correctionValues[testId].numeric_value !== null ? Number(correctionValues[testId].numeric_value) : null,
        text_value: correctionValues[testId].text_value ? String(correctionValues[testId].text_value).trim() : null,
      }));

      const res = await fetch(`/api/zmcc/lab/sessions/${selectedHistorySession.id}/correction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: correctionReason.trim(),
          quantity_value: correctionQuantityValue !== '' ? Number(correctionQuantityValue) : null,
          quantity_unit: correctionQuantityUnit,
          decision: correctionDecision,
          rejection_reason: correctionDecision === 'REJECTED' ? correctionRejectionReason.trim() : null,
          remarks: correctionRemarks.trim() || null,
          results: payloadResults,
        }),
      });

      if (res.ok) {
        const corrected = await res.json();
        const mgrCount = corrected?.manager_correction_count ?? 0;
        if (isZmccManager && mgrCount >= 5) {
          toast.showWarning(
            'Correction saved. Manager correction limit reached (5/5). Further corrections require Super Admin.',
            'Limit Reached'
          );
        } else {
          toast.showSuccess('Lab record corrected successfully.');
        }
        setShowCorrectionModal(false);
        setSelectedHistorySession(null);
        fetchHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to correct lab session');
      }
    } catch {
      toast.showError('Network error correcting lab session');
    } finally {
      setSavingCorrection(false);
    }
  };

  // Filtered Queue
  const filteredQueue = queueItems.filter((item) => {
    if (!queueSearch) return true;
    const s = queueSearch.toLowerCase();
    return (
      item.zmcc_token?.toLowerCase().includes(s) ||
      item.route_milk_token?.toLowerCase().includes(s) ||
      item.vehicle_number?.toLowerCase().includes(s) ||
      item.contractor_name?.toLowerCase().includes(s) ||
      item.route_name?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#F8F9FA] p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <FlaskConical className="w-8 h-8 text-[#1E3A8A]" />
            <h1 className="text-2xl font-bold text-slate-800">ZMCC Laboratory Testing</h1>
          </div>
          <p className="text-sm text-slate-600">
            Intake testing and accept/reject decisioning for MOT and Contractor milk arrivals.
          </p>
        </div>
        {currentUser?.procurement_source && (
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#1E3A8A]" />
            <span>
              <strong>{currentUser.procurement_source.name}</strong> ({currentUser.procurement_source.code})
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('QUEUE')}
          className={`px-5 py-3 font-semibold text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'QUEUE'
              ? 'border-[#1E3A8A] text-[#1E3A8A]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          Arrivals Queue
          {queueItems.length > 0 && (
            <span className="ml-1 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">
              {queueItems.length}
            </span>
          )}
        </button>

        {activeSession && (
          <button
            onClick={() => setActiveTab('TESTING')}
            className={`px-5 py-3 font-semibold text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'TESTING'
                ? 'border-[#1E3A8A] text-[#1E3A8A]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FlaskConical className="w-4 h-4 text-emerald-600" />
            Active Session
            <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-bold">
              In Progress
            </span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`px-5 py-3 font-semibold text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'HISTORY'
              ? 'border-[#1E3A8A] text-[#1E3A8A]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          Test History & Corrections
        </button>
      </div>

      {/* TAB 1: ARRIVALS QUEUE */}
      {activeTab === 'QUEUE' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search token, vehicle, contractor..."
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
            </div>
            <button
              onClick={fetchQueue}
              disabled={loadingQueue}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingQueue ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {loadingQueue ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              Loading pending arrivals...
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">No arrivals waiting for laboratory testing.</p>
              <p className="text-xs text-slate-500 mt-1">All recorded arrivals have been tested or none have arrived yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQueue.map((item) => (
                <div
                  key={`${item.queue_type}-${item.arrival_id}`}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-[#1E3A8A] transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
                          item.queue_type === 'MOT'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {item.queue_type === 'MOT' ? 'MOT Journey Milk' : 'Contractor Milk'}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(item.arrival_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div>
                      <div className="font-bold text-slate-800 text-base">
                        {item.queue_type === 'MOT' ? item.route_name || item.route_code || 'Direct MOT' : item.contractor_name}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Vehicle: <strong className="text-slate-700">{item.vehicle_number || 'N/A'}</strong></span>
                        <span>•</span>
                        <span>Token: <strong className="text-slate-700 font-mono">{item.zmcc_token}</strong></span>
                      </div>
                    </div>

                    {item.queue_type === 'MOT' && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                        <div>Journey: <strong>{item.journey_number}</strong></div>
                        <div>MOT Officer: <strong>{item.mot_name || 'N/A'}</strong> ({item.mot_code || 'N/A'})</div>
                      </div>
                    )}

                    {item.queue_type === 'CONTRACTOR' && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        Contractor Code: <strong>{item.contractor_code}</strong>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      {item.lab_session_status === 'IN_PROGRESS' ? (
                        <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded">
                          Session Started
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Pending Test</span>
                      )}
                    </div>

                    {canTest ? (
                      <button
                        onClick={() => handleStartOrResume(item)}
                        disabled={loadingSession}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#1E3A8A] text-white text-xs font-semibold rounded-xl hover:bg-blue-900 transition-colors shadow-sm"
                      >
                        {item.lab_session_status === 'IN_PROGRESS' ? 'Resume Testing' : 'Start Testing'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Attendant Required</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ACTIVE TESTING SESSION */}
      {activeTab === 'TESTING' && activeSession && (
        <div className="space-y-6">
          {/* Active Session Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    {activeSession.arrival_type}
                  </span>
                  <h2 className="text-lg font-bold text-slate-800">
                    Testing Session #{activeSession.id}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Started at {new Date(activeSession.started_at).toLocaleString()} by {activeSession.starter?.full_name || activeSession.starter?.username}
                </p>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-500">ZMCC Intake Token</span>
                <p className="font-mono font-bold text-slate-800 text-sm">
                  {activeSession.mot_arrival?.zmcc_token || activeSession.contractor_arrival?.zmcc_token}
                </p>
              </div>
            </div>

            {/* 6G-C: Actual Reception Milk Quantity & Final Milk Metrics Panel */}
            {(() => {
              const draftPreview = calculatePreview(
                draftQuantityValue,
                draftQuantityUnit,
                draftValues,
                activeSession.results
              );

              return (
                <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Actual Reception Milk Quantity</h3>
                      <p className="text-xs text-slate-500">
                        Authoritative intake milk quantity physically received and verified at ZMCC
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="flex-1 sm:w-44">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Quantity *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={draftQuantityValue}
                          onChange={(e) => setDraftQuantityValue(e.target.value)}
                          placeholder="e.g. 5000"
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Unit *
                        </label>
                        <select
                          value={draftQuantityUnit}
                          onChange={(e) => setDraftQuantityUnit(e.target.value as 'KG' | 'LITER')}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                        >
                          <option value="KG">KG</option>
                          <option value="LITER">Liters</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Calculated Final Milk Metrics (Read-Only) */}
                  <div className="border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Derived Final Milk Metrics (System-Calculated)
                      </span>
                      {draftPreview ? (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium border border-emerald-200">
                          Formula v{draftPreview.calculationVersion}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">
                          Enter Quantity, Unit, LR, and Fat to calculate
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Density</span>
                        <p className="text-sm font-bold font-mono text-slate-800">
                          {draftPreview ? draftPreview.density.toFixed(4) : (activeSession.density != null ? Number(activeSession.density).toFixed(4) : '—')}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Gross Liters</span>
                        <p className="text-sm font-bold font-mono text-[#1E3A8A]">
                          {draftPreview ? `${draftPreview.grossLiters.toFixed(2)} L` : (activeSession.gross_liters != null ? `${Number(activeSession.gross_liters).toFixed(2)} L` : '—')}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">SNF %</span>
                        <p className="text-sm font-bold font-mono text-slate-800">
                          {draftPreview ? `${draftPreview.snf.toFixed(2)}%` : (activeSession.snf != null ? `${Number(activeSession.snf).toFixed(2)}%` : '—')}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">TS %</span>
                        <p className="text-sm font-bold font-mono text-slate-800">
                          {draftPreview ? `${draftPreview.ts.toFixed(2)}%` : (activeSession.ts != null ? `${Number(activeSession.ts).toFixed(2)}%` : '—')}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">@13TS Liters</span>
                        <p className="text-sm font-bold font-mono text-emerald-700">
                          {draftPreview ? `${draftPreview.at13tsLiters.toFixed(2)} L` : (activeSession.at_13ts_liters != null ? `${Number(activeSession.at_13ts_liters).toFixed(2)} L` : '—')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* MOT Journey Summary (Read-Only Reference, Section 24) */}
                  {activeSession.arrival_type === 'MOT' && activeSession.mot_arrival?.journey?.summary && (
                    <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3 mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-700" />
                          Upstream MOT Journey Summary (Reference Only)
                        </span>
                        <span className="text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-medium">
                          v{activeSession.mot_arrival.journey.summary.summary_version}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-[10px] text-blue-600 block">Gross Liters</span>
                          <span className="font-bold font-mono text-blue-950">
                            {Number(activeSession.mot_arrival.journey.summary.total_gross_liters).toFixed(2)} L
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-blue-600 block">Weighted LR</span>
                          <span className="font-bold font-mono text-blue-950">
                            {activeSession.mot_arrival.journey.summary.weighted_avg_lr != null
                              ? Number(activeSession.mot_arrival.journey.summary.weighted_avg_lr).toFixed(1)
                              : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-blue-600 block">Weighted Fat</span>
                          <span className="font-bold font-mono text-blue-950">
                            {activeSession.mot_arrival.journey.summary.weighted_avg_fat != null
                              ? `${Number(activeSession.mot_arrival.journey.summary.weighted_avg_fat).toFixed(1)}%`
                              : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-blue-600 block">@13TS Liters</span>
                          <span className="font-bold font-mono text-blue-950">
                            {Number(activeSession.mot_arrival.journey.summary.total_at_13ts_liters).toFixed(2)} L
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Test Matrix */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center justify-between">
                <span>Intake Quality Parameters</span>
                <span className="text-xs font-normal text-slate-500">
                  {activeSession.results?.length || 0} configured parameters
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Test Code</th>
                      <th className="py-2.5 px-3">Parameter Name</th>
                      <th className="py-2.5 px-3">Required</th>
                      <th className="py-2.5 px-3">Value / Observation</th>
                      <th className="py-2.5 px-3">Unit</th>
                      <th className="py-2.5 px-3">Rule Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeSession.results?.map((res: any) => {
                      const testId = res.test_id;
                      const current = draftValues[testId] || { numeric_value: '', text_value: '' };
                      const isCalculated = res.result_type_snapshot === 'CALCULATED';
                      const isNumeric = res.result_type_snapshot === 'NUMERIC';
                      const options = res.result_options_snapshot as any[];

                      return (
                        <tr key={testId} className="hover:bg-slate-50/60">
                          <td className="py-3 px-3 font-mono font-bold text-slate-700">
                            {res.test_code_snapshot}
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-800">
                            {res.test_name_snapshot}
                          </td>
                          <td className="py-3 px-3">
                            {res.is_required_snapshot ? (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                                REQUIRED
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">OPTIONAL</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            {isCalculated ? (
                              <input
                                type="text"
                                value="Unsupported (Calculated)"
                                disabled
                                readOnly
                                className="w-44 px-2.5 py-1.5 border border-amber-200 bg-amber-50 text-amber-700 rounded-lg text-xs cursor-not-allowed italic select-none"
                              />
                            ) : isNumeric ? (
                              <input
                                type="number"
                                step="any"
                                value={current.numeric_value}
                                onChange={(e) =>
                                  setDraftValues({
                                    ...draftValues,
                                    [testId]: { ...current, numeric_value: e.target.value },
                                  })
                                }
                                placeholder="Enter value"
                                className="w-32 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                              />
                            ) : options && options.length > 0 ? (
                              <select
                                value={current.text_value}
                                onChange={(e) =>
                                  setDraftValues({
                                    ...draftValues,
                                    [testId]: { ...current, text_value: e.target.value },
                                  })
                                }
                                className="w-36 px-2 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                              >
                                <option value="">-- Select --</option>
                                {options.map((opt: any) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label || opt.value}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={current.text_value}
                                onChange={(e) =>
                                  setDraftValues({
                                    ...draftValues,
                                    [testId]: { ...current, text_value: e.target.value },
                                  })
                                }
                                placeholder="Result text"
                                className="w-36 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                              />
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-500 font-mono">
                            {res.unit_snapshot || '—'}
                          </td>
                          <td className="py-3 px-3">
                            {res.is_passed === true && (
                              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1 w-max">
                                <CheckCircle2 className="w-3 h-3" /> PASS
                              </span>
                            )}
                            {res.is_passed === false && (
                              <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded flex items-center gap-1 w-max">
                                <XCircle className="w-3 h-3" /> FAIL
                              </span>
                            )}
                            {res.is_passed === null && (
                              <span className="text-xs text-slate-400 italic">Pending</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Remarks */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Lab Remarks (Optional)
              </label>
              <textarea
                value={draftRemarks}
                onChange={(e) => setDraftRemarks(e.target.value)}
                rows={2}
                placeholder="Any observations, organoleptic notes, or smell/taste checks..."
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft}
                className="flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {savingDraft ? 'Saving Draft...' : 'Save Draft Values'}
              </button>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => openCompleteModal('REJECTED')}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-colors shadow-sm"
                >
                  <XCircle className="w-4 h-4" />
                  Reject Milk
                </button>
                <button
                  type="button"
                  onClick={() => openCompleteModal('ACCEPTED')}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Accept Milk
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TEST HISTORY & CORRECTIONS */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search token, vehicle..."
                  className="pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                />
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
              />

              <select
                value={historyDecision}
                onChange={(e) => setHistoryDecision(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
              >
                <option value="ALL">All Decisions</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <button
              onClick={fetchHistory}
              disabled={loadingHistory}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Filter
            </button>
          </div>

          {/* History List */}
          {loadingHistory ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              Loading test history...
            </div>
          ) : historyItems.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              No completed laboratory testing records found.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Session #</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Intake Token</th>
                    <th className="py-3 px-4">Source / Vehicle</th>
                    <th className="py-3 px-4">Received Qty</th>
                    <th className="py-3 px-4">Gross Liters</th>
                    <th className="py-3 px-4">@13% TS Liters</th>
                    <th className="py-3 px-4">Completed At</th>
                    <th className="py-3 px-4">Tested By</th>
                    <th className="py-3 px-4">Decision</th>
                    <th className="py-3 px-4">Corrections</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                        #{item.id}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            item.arrival_type === 'MOT'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {item.arrival_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {item.mot_arrival?.zmcc_token || item.contractor_arrival?.zmcc_token || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {item.arrival_type === 'MOT' ? (
                          <span>
                            {item.mot_arrival?.journey?.route?.name || 'Route Milk'} (
                            {item.mot_arrival?.journey?.mot_vehicle?.vehicle_number || 'MOT'})
                          </span>
                        ) : (
                          <span>
                            {item.contractor_arrival?.contractor_source?.name || 'Contractor'} (
                            {item.contractor_arrival?.vehicle_number || '—'})
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-800 font-semibold">
                        {item.quantity_value != null ? (
                          <span>
                            {Number(item.quantity_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                            <span className="text-[10px] text-slate-500 font-normal">
                              {item.quantity_unit === 'LITER' ? 'Liters' : item.quantity_unit}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Not captured under this version</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {item.gross_liters != null ? `${Number(item.gross_liters).toFixed(2)} L` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">
                        {item.at_13ts_liters != null ? `${Number(item.at_13ts_liters).toFixed(2)} L` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {item.completed_at ? new Date(item.completed_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {item.completer?.full_name || item.completer?.username || '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        {item.decision === 'ACCEPTED' ? (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                            ACCEPTED
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full">
                            REJECTED
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-700">
                            Total Corrections: {item.correction_count ?? 0}
                          </div>
                          {isZmccManager ? (
                            <div className="text-[10px] text-slate-500">
                              Manager Corrections: {item.manager_correction_count ?? 0} / 5
                            </div>
                          ) : isSuperAdmin ? (
                            <div className="text-[10px] text-slate-500">
                              Manager Corrections Used: {item.manager_correction_count ?? 0} / 5
                            </div>
                          ) : null}
                          {item.last_corrected_at && (
                            <div className="text-[10px] text-slate-400">
                              Last by {item.last_corrector?.full_name || item.last_corrector?.username || 'user'}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {canCorrect && (isSuperAdmin || (item.manager_correction_count ?? 0) < 5) ? (
                          <button
                            onClick={() => openCorrection(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#1E3A8A] bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                            Correct
                          </button>
                        ) : isZmccManager && (item.manager_correction_count ?? 0) >= 5 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                            Manager correction limit reached (5/5)
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* COMPLETION MODAL */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4 border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                {completionDecision === 'ACCEPTED' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-600" />
                )}
                <h3 className="font-bold text-slate-800 text-base">
                  Confirm Milk Decision: {completionDecision}
                </h3>
              </div>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {completionDecision === 'REJECTED' && (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-rose-700">
                  Rejection Reason *
                </label>
                <textarea
                  required
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Specify why the milk is rejected (e.g., high acidity, abnormal smell, adulteration test fail)..."
                  className="w-full p-2.5 border border-rose-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Final Remarks
              </label>
              <textarea
                rows={2}
                value={completionRemarks}
                onChange={(e) => setCompletionRemarks(e.target.value)}
                placeholder="Optional final remarks..."
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
            </div>

            <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              {completionDecision === 'ACCEPTED'
                ? 'Accepting confirms intake milk meets ZMCC acceptance standards. Milk is stored in ZMCC pending reception/chilling in Stage 6G.'
                : 'Rejecting permanently marks this intake lot as rejected at ZMCC. Supplier/MOT officer must be informed.'}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                disabled={completingSession}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCompleteSession}
                disabled={completingSession}
                className={`px-5 py-2 text-white text-xs font-bold rounded-xl transition-colors ${
                  completionDecision === 'ACCEPTED'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {completingSession ? 'Submitting...' : `Finalize ${completionDecision}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CORRECTION MODAL (ZMCC MANAGER / SUPER ADMIN) */}
      {showCorrectionModal && selectedHistorySession && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl space-y-4 border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-800 text-base">
                  {isSuperAdmin ? 'Super Admin Correction' : 'Manager Correction'}: Session #{selectedHistorySession.id}
                </h3>
              </div>
              <button
                onClick={() => setShowCorrectionModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <strong>Supervisory Correction Policy:</strong>{' '}
              {isSuperAdmin
                ? 'Super Admin corrections are unlimited, but every change is counted and permanently audited.'
                : 'Manager corrections are limited to 5 successful saves per session. All changes are permanently recorded in the immutable audit log.'}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Correction Reason *
              </label>
              <input
                type="text"
                required
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Reason for changing lab results or decision..."
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
            </div>

            {/* Decision Toggle */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Corrected Decision
                </label>
                <select
                  value={correctionDecision}
                  onChange={(e) => setCorrectionDecision(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                >
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </div>

              {correctionDecision === 'REJECTED' && (
                <div>
                  <label className="block text-xs font-bold text-rose-700 mb-1">
                    Rejection Reason *
                  </label>
                  <input
                    type="text"
                    required
                    value={correctionRejectionReason}
                    onChange={(e) => setCorrectionRejectionReason(e.target.value)}
                    placeholder="Reason for rejection..."
                    className="w-full p-2.5 border border-rose-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              )}
            </div>

            {/* Quantity and Unit Override */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Actual Reception Quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={correctionQuantityValue}
                  onChange={(e) => setCorrectionQuantityValue(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Quantity Unit
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCorrectionQuantityUnit('KG')}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                      correctionQuantityUnit === 'KG'
                        ? 'bg-[#1E3A8A] text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    KG
                  </button>
                  <button
                    type="button"
                    onClick={() => setCorrectionQuantityUnit('LITER')}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                      correctionQuantityUnit === 'LITER'
                        ? 'bg-[#1E3A8A] text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    Liters
                  </button>
                </div>
              </div>
            </div>

            {/* Recomputed Preview Metrics */}
            {(() => {
              const corrPreview = calculatePreview(
                correctionQuantityValue,
                correctionQuantityUnit,
                correctionValues,
                selectedHistorySession.results
              );

              return (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      Recomputed Final Metrics Preview
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {corrPreview ? 'Live Recomputed' : 'Awaiting valid inputs'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Density</span>
                      <p className="text-xs font-bold font-mono text-slate-800">
                        {corrPreview ? corrPreview.density.toFixed(4) : (selectedHistorySession.density != null ? Number(selectedHistorySession.density).toFixed(4) : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Gross Liters</span>
                      <p className="text-xs font-bold font-mono text-slate-800">
                        {corrPreview ? `${corrPreview.grossLiters.toFixed(2)} L` : (selectedHistorySession.gross_liters != null ? `${Number(selectedHistorySession.gross_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">SNF</span>
                      <p className="text-xs font-bold font-mono text-slate-800">
                        {corrPreview ? `${corrPreview.snf.toFixed(2)}%` : (selectedHistorySession.snf != null ? `${Number(selectedHistorySession.snf).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Solids</span>
                      <p className="text-xs font-bold font-mono text-slate-800">
                        {corrPreview ? `${corrPreview.ts.toFixed(2)}%` : (selectedHistorySession.ts != null ? `${Number(selectedHistorySession.ts).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">@13TS Liters</span>
                      <p className="text-xs font-bold font-mono text-emerald-700">
                        {corrPreview ? `${corrPreview.at13tsLiters.toFixed(2)} L` : (selectedHistorySession.at_13ts_liters != null ? `${Number(selectedHistorySession.at_13ts_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Test Results Override */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Override Parameter Values
              </label>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2">
                {selectedHistorySession.results?.map((res: any) => {
                  const testId = res.test_id;
                  const current = correctionValues[testId] || { numeric_value: '', text_value: '' };
                  const isCalculated = res.result_type_snapshot === 'CALCULATED';
                  const isNumeric = res.result_type_snapshot === 'NUMERIC';

                  return (
                    <div key={testId} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                      <div className="w-1/2">
                        <span className="font-bold text-slate-800">{res.test_name_snapshot}</span>
                        <span className="text-[10px] text-slate-400 font-mono ml-2">({res.test_code_snapshot})</span>
                      </div>
                      <div className="w-1/2 flex items-center justify-end gap-2">
                        {isCalculated ? (
                          <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 italic">
                            Read-only (Calculated)
                          </span>
                        ) : isNumeric ? (
                          <input
                            type="number"
                            step="any"
                            value={current.numeric_value}
                            onChange={(e) =>
                              setCorrectionValues({
                                ...correctionValues,
                                [testId]: { ...current, numeric_value: e.target.value },
                              })
                            }
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs font-mono"
                          />
                        ) : (
                          <input
                            type="text"
                            value={current.text_value}
                            onChange={(e) =>
                              setCorrectionValues({
                                ...correctionValues,
                                [testId]: { ...current, text_value: e.target.value },
                              })
                            }
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs"
                          />
                        )}
                        <span className="text-[10px] text-slate-400 font-mono w-10">
                          {res.unit_snapshot || ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                disabled={savingCorrection}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrection}
                disabled={savingCorrection}
                className="px-5 py-2 bg-[#1E3A8A] text-white text-xs font-bold rounded-xl hover:bg-blue-900 transition-colors"
              >
                {savingCorrection ? 'Saving...' : 'Apply Correction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
