'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { User } from '@backend/core/types';
import {
  FlaskConical,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  X,
} from 'lucide-react';

import { useToast } from '@/frontend/context/ToastContext';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { resolveCoreMilkTestResults } from '@/backend/utils/milkTestResolvers';
import { Modal } from '@/components/ui/modal';
import { useRouter, useSearchParams } from 'next/navigation';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { getErrorMessage } from '@/lib/errors';
import { LabPortionsPanel } from '@/frontend/modules/zmcc/lab/LabPortionsPanel';
import { LabQueuePanel } from './LabQueuePanel';
import { LabHistoryPanel } from './LabHistoryPanel';
import { HistoryCorrectionDrawer } from './HistoryCorrectionDrawer';
import { MySubmittedRequestsPanel } from '@/frontend/modules/approvals/MySubmittedRequestsPanel';
import type { MainTab, LabSession, LabResult, ResultDrafts, ActiveTank, LabQueueItem } from './labTypes';
import { RequestCorrectionModal, type EditableFieldOption } from '@/frontend/modules/governance/RequestCorrectionModal';

interface ZmccLabWorkspaceProps {
  currentUser: User | null;
  hideTabBar?: boolean;
}

export const ZmccLabWorkspace: React.FC<ZmccLabWorkspaceProps> = ({ currentUser, hideTabBar = false }) => {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveZmccId =
    currentUser?.procurement_source?.id ||
    searchParams?.get('zmccId') ||
    searchParams?.get('zmcc_id') ||
    searchParams?.get('sourceId') ||
    undefined;

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isZmccLabAttendant = currentUser?.role === 'ZMCC_LAB_ATTENDANT';
  // Superiors may do lab work in their own ZMCC (delegation).
  const canTest = isZmccLabAttendant || isZmccManager || currentUser?.role === 'HEAD_OF_MPD' || isSuperAdmin;
  const canDirectCorrect = isDataExecutive || isSuperAdmin;
  const canReceiveHistorical = isZmccLabAttendant || isSuperAdmin;

  const [requestCorrectionModal, setRequestCorrectionModal] = useState<{
    isOpen: boolean;
    session: LabSession | null;
    fields: EditableFieldOption[];
  }>({
    isOpen: false,
    session: null,
    fields: [],
  });

  const openRequestCorrection = (session: LabSession) => {
    const fields: EditableFieldOption[] = [
      { field: 'quantity_value', label: 'Quantity Value', currentValue: session.quantity_value, type: 'number' },
      { field: 'quantity_unit', label: 'Quantity Unit', currentValue: session.quantity_unit, type: 'select', options: [{ value: 'KG', label: 'KG' }] },
      { field: 'remarks', label: 'Remarks / Notes', currentValue: session.remarks, type: 'text' },
    ];
    if (session.results) {
      for (const r of session.results) {
        fields.push({
          field: `result_${r.test_id}`,
          label: `${r.test_name_snapshot || 'Test'} Result`,
          currentValue: r.numeric_value !== null ? r.numeric_value : r.text_value,
          type: r.numeric_value !== null ? 'number' : 'text',
        });
      }
    }
    setRequestCorrectionModal({
      isOpen: true,
      session,
      fields,
    });
  };

  // The URL's ?tab= strictly drives the active view so sidebar navigation and in-page tabs are 100% in sync
  const urlTab = searchParams?.get('tab')?.toLowerCase();
  const activeTab: MainTab = React.useMemo(() => {
    if (urlTab === 'testing' && canTest) return 'TESTING';
    if (urlTab === 'history') return 'HISTORY';
    if (urlTab === 'requests') return 'REQUESTS';
    if (urlTab === 'queue' && canTest) return 'QUEUE';
    return canTest ? 'QUEUE' : 'HISTORY';
  }, [urlTab, canTest]);

  const handleTabChange = useCallback(
    (newTab: MainTab) => {
      const tabParamMap: Record<MainTab, string> = {
        QUEUE: 'queue',
        TESTING: 'testing',
        HISTORY: 'history',
        REQUESTS: 'requests',
      };
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('tab', tabParamMap[newTab]);
      router.push(`/zmcc/lab?${params.toString()}`);
    },
    [router, searchParams]
  );
  const setActiveTab = handleTabChange;

  // Queue State
  const [queueSearch, setQueueSearch] = useState('');

  // Active Session State
  const [activeSession, setActiveSession] = useState<LabSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [queuePage, setQueuePage] = useState<number>(1);

  // Historical Receive Modal State
  const [showHistoricalReceiveModal, setShowHistoricalReceiveModal] = useState(false);
  const [historicalSession, setHistoricalSession] = useState<LabSession | null>(null);
  const [historicalTanks, setHistoricalTanks] = useState<ActiveTank[]>([]);
  const [selectedHistoricalTankId, setSelectedHistoricalTankId] = useState('');
  const [submittingHistoricalReceive, setSubmittingHistoricalReceive] = useState(false);
  const [rmrSession, setRmrSession] = useState<LabSession | null>(null);
  const [rmrReceiptNumber, setRmrReceiptNumber] = useState('');
  const [issuingRmr, setIssuingRmr] = useState(false);

  // History State
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyDecision, setHistoryDecision] = useState<string>('ALL');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(20);

  // View / Correction Modal State
  const [selectedHistorySession, setSelectedHistorySession] = useState<LabSession | null>(null);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionQuantityValue, setCorrectionQuantityValue] = useState<string>('');
  const [correctionQuantityUnit, setCorrectionQuantityUnit] = useState<'KG' | 'LITER'>('KG');
  const [correctionDecision, setCorrectionDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [correctionRejectionReason, setCorrectionRejectionReason] = useState('');
  const [correctionRemarks, setCorrectionRemarks] = useState('');
  const [correctionValues, setCorrectionValues] = useState<ResultDrafts>({});
  const [savingCorrection, setSavingCorrection] = useState(false);

  // Helper to compute live preview metrics using canonical core resolver
  const calculatePreview = useCallback((
    qtyStr: string,
    unit: 'KG' | 'LITER',
    values: ResultDrafts,
    results: LabResult[]
  ) => {
    const q = Number(qtyStr);
    if (!qtyStr || isNaN(q) || q <= 0) return null;

    const mapped = (results || []).map((r) => ({
      testId: r.test_id,
      testCode: r.test_code_snapshot,
      testName: r.test_name_snapshot,
      resultType: r.result_type_snapshot,
      numericValue:
        values[r.test_id]?.numeric_value !== '' &&
        values[r.test_id]?.numeric_value !== null &&
        values[r.test_id]?.numeric_value !== undefined
          ? Number(values[r.test_id].numeric_value)
          : null,
    }));

    const resolved = resolveCoreMilkTestResults(mapped);
    if (!resolved.success) {
      return null;
    }

    try {
      return computeCanonicalMilkMetrics(q, unit, resolved.lr, resolved.fat);
    } catch {
      return null;
    }
  }, []);

  // Queue (live: refresh every 30s while the tab is open and visible).
  const queueUrl = effectiveZmccId ? `/api/zmcc/lab/queue?zmcc_id=${encodeURIComponent(effectiveZmccId)}` : '/api/zmcc/lab/queue';
  const queueQuery = useQuery({
    queryKey: ['zmcc', 'lab', 'queue', effectiveZmccId],
    enabled: activeTab === 'QUEUE',
    queryFn: ({ signal }) => fetchJson<LabQueueItem[]>(queueUrl, { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });
  const queueItems = Array.isArray(queueQuery.data) ? queueQuery.data : [];
  const loadingQueue = queueQuery.isFetching;
  const fetchQueue = () => queueQuery.refetch();
  useEffect(() => {
    if (queueQuery.error) toast.showError(getErrorMessage(queueQuery.error) || 'Failed to fetch queue');
  }, [queueQuery.error, toast]);

  // History (search debounced; previous rows stay while the next page loads).
  const debouncedHistorySearch = useDebouncedValue(historySearch, 300);
  const historyParams = new URLSearchParams();
  if (effectiveZmccId) historyParams.append('zmcc_id', effectiveZmccId);
  if (historyDate) historyParams.append('date', historyDate);
  if (historyDecision && historyDecision !== 'ALL') historyParams.append('decision', historyDecision);
  if (debouncedHistorySearch) historyParams.append('search', debouncedHistorySearch);
  historyParams.append('page', String(historyPage));
  historyParams.append('pageSize', String(historyPageSize));
  const historyQuery = historyParams.toString();
  const historyResult = useQuery({
    queryKey: ['zmcc', 'lab', 'history', historyQuery],
    enabled: activeTab === 'HISTORY',
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      fetchJson<{ items?: LabSession[]; total?: number; totalPages?: number }>(`/api/zmcc/lab/history?${historyQuery}`, { signal }),
  });
  const historyItems = historyResult.data?.items ?? [];
  const historyTotal = historyResult.data?.total ?? 0;
  const historyTotalPages = historyResult.data?.totalPages ?? 1;
  const loadingHistory = historyResult.isFetching;
  const fetchHistory = () => historyResult.refetch();
  useEffect(() => {
    if (historyResult.error) toast.showError(getErrorMessage(historyResult.error) || 'Failed to fetch lab history');
  }, [historyResult.error, toast]);

  // Start or resume session from queue
  const handleStartOrResume = async (item: LabQueueItem) => {
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

  const loadSessionIntoState = (session: LabSession) => {
    setActiveSession(session);
  };

  // Auto-resume active session if user navigates to TESTING tab and a session is already in-progress
  useEffect(() => {
    if (activeTab === 'TESTING' && !activeSession && !loadingSession && queueItems.length > 0) {
      const inProgress = queueItems.find(
        (q) => q.lab_session_status === 'IN_PROGRESS' || Boolean(q.lab_session_id)
      );
      if (inProgress) {
        handleStartOrResume(inProgress);
      }
    }
  }, [activeTab, activeSession, loadingSession, queueItems]);

  // Historical Receive Handlers
  const openHistoricalReceiveModal = async (session: LabSession) => {
    setHistoricalSession(session);
    setSelectedHistoricalTankId('');
    try {
      const zmccQuery = session.zmcc_id ? `&zmcc_id=${session.zmcc_id}` : '';
      const res = await fetch(`/api/zmcc/tanks?active_only=true${zmccQuery}`);
      if (res.ok) {
        const data = await res.json();
        const activeList = data.tanks || [];
        setHistoricalTanks(activeList);
        if (activeList.length === 1) {
          setSelectedHistoricalTankId(activeList[0].id);
        }
      } else {
        setHistoricalTanks([]);
      }
    } catch {
      setHistoricalTanks([]);
    }
    setShowHistoricalReceiveModal(true);
  };

  const handleHistoricalReceive = async () => {
    if (!historicalSession) return;
    if (historicalTanks.length === 0) {
      toast.showError('No active ZMCC tank configured.');
      return;
    }
    if (historicalTanks.length > 1) {
      toast.showError('Configuration error: Multiple active tanks found for this ZMCC. Only one active tank is permitted.');
      return;
    }
    setSubmittingHistoricalReceive(true);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${historicalSession.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tank_id: historicalTanks.length === 1 ? historicalTanks[0].id : (selectedHistoricalTankId || undefined),
        }),
      });
      if (res.ok) {
        toast.showSuccess('Tank receipt created successfully.');
        setShowHistoricalReceiveModal(false);
        fetchHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.showError(err.error || 'Failed to create tank receipt.');
      }
    } catch {
      toast.showError('Network error creating tank receipt.');
    } finally {
      setSubmittingHistoricalReceive(false);
    }
  };

  const issueLocalSupplierRmr = async () => {
    if (!rmrSession?.local_supplier_arrival?.id) return;
    if (!rmrReceiptNumber.trim()) {
      toast.showError('Enter the receipt number.');
      return;
    }
    setIssuingRmr(true);
    try {
      const res = await fetch(`/api/zmcc/hc-arrivals/${rmrSession.local_supplier_arrival.id}/rmr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_number: rmrReceiptNumber, idempotency_key: `local-rmr-${rmrSession.id}-${Date.now()}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to issue HC RMR.');
      toast.showSuccess(`HC RMR issued: ${data.printable_reference}`);
      setRmrSession(null); fetchHistory();
    } catch (error) { toast.showError(getErrorMessage(error) || 'Failed to issue HC RMR.'); }
    finally { setIssuingRmr(false); }
  };

  // Open correction modal
  const openCorrection = (session: LabSession) => {
    setSelectedHistorySession(session);
    setCorrectionReason('');
    setCorrectionQuantityValue(session.quantity_value !== null && session.quantity_value !== undefined ? String(session.quantity_value) : '');
    setCorrectionQuantityUnit((session.quantity_unit as 'KG' | 'LITER') || 'KG');
    setCorrectionDecision(session.decision === 'REJECTED' ? 'REJECTED' : 'ACCEPTED');
    setCorrectionRejectionReason(session.rejection_reason || '');
    setCorrectionRemarks(session.remarks || '');
    const vals: ResultDrafts = {};
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
        toast.showSuccess('Lab record corrected successfully.');
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
      item.route_name?.toLowerCase().includes(s) ||
      item.local_supplier_name?.toLowerCase().includes(s) ||
      item.local_supplier_code?.toLowerCase().includes(s) ||
      item.rmr_number?.toLowerCase().includes(s)
    );
  });

  const QUEUE_PAGE_SIZE = 6;
  const totalQueuePages = Math.max(1, Math.ceil(filteredQueue.length / QUEUE_PAGE_SIZE));
  const paginatedQueue = filteredQueue.slice((queuePage - 1) * QUEUE_PAGE_SIZE, queuePage * QUEUE_PAGE_SIZE);

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-12 w-full">
      
      {!hideTabBar && (
        <div className="lg:hidden">
          <SegmentedTabs
            label="Laboratory views"
            value={activeTab}
            onValueChange={setActiveTab}
            tabs={[
              ...(canTest ? [{ value: 'QUEUE' as const, label: 'Arrivals queue', icon: Clock, count: queueItems.length }] : []),
              ...(canTest
                ? [{ value: 'TESTING' as const, label: activeSession ? 'Active session' : 'Testing', icon: FlaskConical, badge: activeSession ? 'In progress' : undefined }]
                : []),
              { value: 'HISTORY' as const, label: 'History & corrections', icon: FileText },
              { value: 'REQUESTS' as const, label: 'My Sent Requests' },
            ]}
          />
        </div>
      )}

      
      {activeTab === 'QUEUE' && canTest && (
        <LabQueuePanel
          queueSearch={queueSearch}
          setQueueSearch={setQueueSearch}
          fetchQueue={fetchQueue}
          loadingQueue={loadingQueue}
          loadingSession={loadingSession}
          filteredQueue={filteredQueue}
          paginatedQueue={paginatedQueue}
          queuePage={queuePage}
          setQueuePage={setQueuePage}
          totalQueuePages={totalQueuePages}
          handleStartOrResume={handleStartOrResume}
          canTest={canTest}
        />
      )}

      
      {activeTab === 'TESTING' && canTest && !activeSession && (
        <div className="space-y-4 animate-panel-in">
          <div className="bg-card rounded-2xl border border-border p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Testing desk</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchQueue()}
                disabled={loadingQueue}
                className="min-h-11 min-w-11 self-start sm:self-auto px-3 py-1.5 rounded-lg border border-border bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                {loadingQueue ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {queueItems.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-slate-800">No arrivals waiting</p>
                <button
                  type="button"
                  onClick={() => fetchQueue()}
                  className="min-h-11 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {queueItems.map((item) => (
                  <div
                    key={`${item.queue_type}-${item.arrival_id}`}
                    className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition bg-white"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800">
                          {item.queue_type === 'MOT' ? 'Mobile Tester' : 'HC'}
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          Token #{item.zmcc_token || '—'}
                        </span>
                        {item.vehicle_number && (
                          <span className="font-mono text-xs text-slate-600">
                            ({item.vehicle_number})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {item.queue_type === 'MOT' && (item.route_name || item.route_code ? `Route: ${item.route_name || item.route_code}` : 'Mobile Tester Route')}
                        {item.queue_type === 'HC' && (item.local_supplier_name || 'HC supplier')}
                        <span className="mx-1.5">·</span>
                        Arrived: {new Date(item.arrival_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={loadingSession}
                      onClick={() => handleStartOrResume(item)}
                      className="min-h-11 min-w-11 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-bold shadow-2xs transition flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>{item.lab_session_status === 'IN_PROGRESS' ? 'Resume Testing' : 'Start Testing'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'TESTING' && canTest && activeSession && (
        <div className="space-y-6 animate-panel-in">
          
          <div className="bg-card border-border p-6 rounded-xl border shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    {activeSession.arrival_type}
                  </span>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Testing Session #{activeSession.id}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Started at {new Date(activeSession.started_at).toLocaleString()} by {activeSession.starter?.full_name || activeSession.starter?.username}
                </p>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-500">ZMCC Intake Token</span>
                <p className="tabular-nums font-semibold text-slate-800 text-sm">
                  {activeSession.mot_arrival?.zmcc_token ||
                    activeSession.local_supplier_arrival?.zmcc_token ||
                    '—'}
                </p>
              </div>
            </div>

            
            <LabPortionsPanel
              key={activeSession.id}
              sessionId={activeSession.id}
              arrivalType={activeSession.arrival_type}
              arrivalId={activeSession.local_supplier_arrival?.id ?? activeSession.mot_arrival?.id ?? null}
              tokenNo={
                activeSession.mot_arrival?.zmcc_token ||
                activeSession.local_supplier_arrival?.zmcc_token ||
                null
              }
              vehicleNo={
                activeSession.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
                activeSession.local_supplier_arrival?.vehicle_number ||
                null
              }
              onFinished={() => {
                setActiveSession(null);
                setActiveTab('QUEUE');
                fetchQueue();
              }}
              onViewHistory={() => {
                setActiveSession(null);
                setActiveTab('HISTORY');
                fetchHistory();
              }}
            />
          </div>
        </div>
      )}

      
      {activeTab === 'HISTORY' && (
        <LabHistoryPanel
          historySearch={historySearch}
          setHistorySearch={setHistorySearch}
          historyDate={historyDate}
          setHistoryDate={setHistoryDate}
          historyDecision={historyDecision}
          setHistoryDecision={setHistoryDecision}
          historyPage={historyPage}
          setHistoryPage={setHistoryPage}
          historyItems={historyItems}
          historyTotal={historyTotal}
          historyTotalPages={historyTotalPages}
          loadingHistory={loadingHistory}
          fetchHistory={fetchHistory}
          canTest={canTest}
          canDirectCorrect={canDirectCorrect}
          canReceiveHistorical={canReceiveHistorical}
          canRequestCorrection={!canDirectCorrect}
          showLitres={!isZmccLabAttendant}
          openCorrection={openCorrection}
          openRequestCorrection={openRequestCorrection}
          openHistoricalReceiveModal={openHistoricalReceiveModal}
          startRmr={(item) => { setRmrSession(item); setRmrReceiptNumber(''); }}
        />
      )}

      {activeTab === 'REQUESTS' && (
        <div className="bg-card rounded-2xl border border-border p-5 shadow-2xs animate-panel-in">
          <MySubmittedRequestsPanel />
        </div>
      )}

      
      <HistoryCorrectionDrawer
        open={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        session={selectedHistorySession}
        correctionReason={correctionReason}
        setCorrectionReason={setCorrectionReason}
        correctionQuantityValue={correctionQuantityValue}
        setCorrectionQuantityValue={setCorrectionQuantityValue}
        correctionQuantityUnit={correctionQuantityUnit}
        setCorrectionQuantityUnit={setCorrectionQuantityUnit}
        correctionDecision={correctionDecision}
        setCorrectionDecision={setCorrectionDecision}
        correctionRejectionReason={correctionRejectionReason}
        setCorrectionRejectionReason={setCorrectionRejectionReason}
        correctionValues={correctionValues}
        setCorrectionValues={setCorrectionValues}
        savingCorrection={savingCorrection}
        handleSaveCorrection={handleSaveCorrection}
        calculatePreview={calculatePreview}
      />

      <AnimatePresence>{rmrSession && (
        <Modal key="modal-2" onClose={() => setRmrSession(null)} title="Issue HC RMR" className="max-w-md p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-semibold text-slate-800">Issue HC RMR</h3><button className="min-h-11 min-w-11 flex items-center justify-center" onClick={() => setRmrSession(null)}><X className="w-4 h-4" /></button></div>
            <label htmlFor="hc-rmr-number" className="block text-xs font-semibold text-slate-900">RMR Token (Paper Receipt No.)</label>
            <input id="hc-rmr-number" value={rmrReceiptNumber} onChange={(e) => setRmrReceiptNumber(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" autoComplete="off" placeholder="e.g. 004821" className="min-h-11 w-full p-2 border rounded-lg text-sm tabular-nums" />
            <div className="flex justify-end gap-2"><button onClick={() => setRmrSession(null)} className="min-h-11 min-w-11 px-3 py-2 text-xs border rounded-lg">Cancel</button><button disabled={issuingRmr} onClick={issueLocalSupplierRmr} className="min-h-11 min-w-11 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50">{issuingRmr ? 'Issuing…' : 'Issue RMR'}</button></div>
          </Modal>
      )}</AnimatePresence>

      
      <AnimatePresence>{showHistoricalReceiveModal && historicalSession && (
        <Modal key="modal-3" onClose={() => setShowHistoricalReceiveModal(false)} title="Receive historical session" className="max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-slate-800 text-base">
                  Assign Destination Tank (Session #{historicalSession.id})
                </h3>
              </div>
              <button
                onClick={() => setShowHistoricalReceiveModal(false)}
                className="min-h-11 min-w-11 text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-card border-border p-3 border rounded-xl text-xs text-blue-900 space-y-1">
              <div className="font-semibold">Historical Accepted Milk Lot</div>
              <div>
                Quantity: <span className="tabular-nums font-semibold">{historicalSession.quantity_value} {historicalSession.quantity_unit}</span>
                {historicalSession.gross_liters != null && (
                  <span> ({Number(historicalSession.gross_liters).toFixed(2)} Gross Liters)</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {historicalTanks.length === 0 ? (
                <div className="bg-card border-border p-3 border rounded-xl text-xs text-rose-800 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>No active tank.</span>
                </div>
              ) : historicalTanks.length > 1 ? (
                <div className="bg-card border-border p-3 border rounded-xl text-xs text-rose-800 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Multiple active tanks.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Destination Tank (Sole Active Tank)</label>
                  <div className="bg-card border-border p-2.5 border rounded-xl text-xs text-slate-800 font-semibold">
                    {historicalTanks[0].tank_name} ({historicalTanks[0].tank_code}) · Available: {Number(historicalTanks[0].available_capacity).toFixed(2)} L / {Number(historicalTanks[0].capacity_liters).toFixed(2)} L
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowHistoricalReceiveModal(false)}
                disabled={submittingHistoricalReceive}
                className="min-h-11 min-w-11 px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleHistoricalReceive}
                disabled={
                  submittingHistoricalReceive ||
                  historicalTanks.length !== 1
                }
                className="min-h-11 min-w-11 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submittingHistoricalReceive ? 'Receiving…' : 'Confirm Tank Receipt'}
              </button>
            </div>
          </Modal>
      )}</AnimatePresence>

      {requestCorrectionModal.session && (
        <RequestCorrectionModal
          isOpen={requestCorrectionModal.isOpen}
          onClose={() => setRequestCorrectionModal((prev) => ({ ...prev, isOpen: false }))}
          module="ZMCC_LAB_SESSION"
          recordId={requestCorrectionModal.session.id}
          recordIdentifierLabel={`Lab Session #${requestCorrectionModal.session.id}`}
          availableFields={requestCorrectionModal.fields}
          onSuccess={() => {
            toast.showSuccess('Correction request sent. Follow it under My correction requests.');
            fetchHistory();
          }}
        />
      )}
    </div>
  );
};
