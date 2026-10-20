'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@backend/core/types';
import {
  FlaskConical,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  FileText,
  Edit3,
  X,
  ShieldAlert,
  ArrowRight,
  Calculator,
} from 'lucide-react';

import { useToast } from '@/frontend/context/ToastContext';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { resolveCoreMilkTestResults } from '@/backend/utils/milkTestResolvers';
import { Modal } from '@/components/ui/modal';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { useUrlSearchParam } from '@/frontend/hooks/useUrlSearchParam';
import { LabPortionsPanel } from '@/frontend/modules/zmcc/lab/LabPortionsPanel';
import type { serializeLabSession } from '@/backend/services/zmccLabService';
import { RequestCorrectionModal, type EditableFieldOption } from '@/frontend/modules/governance/RequestCorrectionModal';

interface ZmccLabWorkspaceProps {
  currentUser: User | null;
  hideTabBar?: boolean;
}

type MainTab = 'QUEUE' | 'TESTING' | 'HISTORY';

type LabSession = ReturnType<typeof serializeLabSession>;
type LabResult = LabSession['results'][number];
type ResultDraft = { numeric_value: number | string; text_value: string };
type ResultDrafts = Record<string, ResultDraft>;
type ActiveTank = { id: string; tank_code: string; tank_name: string; capacity_liters: number; available_capacity: number };

/** Row shape of GET /api/zmcc/lab/queue (see getArrivalsQueue). */
type LabQueueItem = {
  queue_type: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER';
  arrival_id: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  zmcc_token: string | null;
  arrival_timestamp: string;
  arrival_date: string;
  vehicle_number: string | null;
  lab_session_id: string | null;
  lab_session_status: string | null;
  route_milk_token?: string | null;
  journey_id?: string;
  journey_number?: string;
  route_code?: string | null;
  route_name?: string | null;
  mot_code?: string | null;
  mot_name?: string | null;
  contractor_source_id?: string;
  contractor_code?: string;
  contractor_name?: string;
  local_supplier_id?: string;
  local_supplier_code?: string;
  local_supplier_name?: string;
  rmr_number?: string | null;
};

export const ZmccLabWorkspace: React.FC<ZmccLabWorkspaceProps> = ({ currentUser, hideTabBar = true }) => {
  const toast = useToast();
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
      { field: 'quantity_unit', label: 'Quantity Unit', currentValue: session.quantity_unit, type: 'select', options: [{ value: 'KG', label: 'KG' }, { value: 'LITER', label: 'LITER' }] },
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

  // The URL's ?tab= picks the initial view until the user chooses one.
  const urlTab = useUrlSearchParam('tab')?.toLowerCase();
  const [selectedTab, setSelectedTab] = useState<MainTab | null>(null);
  const urlMainTab: MainTab | null =
    urlTab === 'queue' && canTest ? 'QUEUE'
    : urlTab === 'testing' && canTest ? 'TESTING'
    : urlTab === 'history' ? 'HISTORY'
    : null;
  const activeTab: MainTab = selectedTab ?? urlMainTab ?? (canTest ? 'QUEUE' : 'HISTORY');
  const setActiveTab = setSelectedTab;

  // Queue State
  const [queueItems, setQueueItems] = useState<LabQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(canTest);
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
  const [rmrSeries, setRmrSeries] = useState('LSR');
  const [rmrBookNumber, setRmrBookNumber] = useState('');
  const [rmrReceiptNumber, setRmrReceiptNumber] = useState('');
  const [issuingRmr, setIssuingRmr] = useState(false);

  // History State
  const [historyItems, setHistoryItems] = useState<LabSession[]>([]);
  const [refreshingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyDecision, setHistoryDecision] = useState<string>('ALL');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(20);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

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

  // Fetch Queue
  const loadQueue = useCallback(
    () =>
      fetch('/api/zmcc/lab/queue', { cache: 'no-store' })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setQueueItems(Array.isArray(data) ? data : []);
          } else {
            const err = await res.json().catch(() => ({}));
            toast.showError(err.error || 'Failed to fetch queue');
          }
        })
        .catch(() => {
          toast.showError('Network error while fetching queue');
        })
        .finally(() => {
          setLoadingQueue(false);
        }),
    [toast]
  );

  const fetchQueue = () => {
    setLoadingQueue(true);
    return loadQueue();
  };

  // Fetch History
  const historyParams = new URLSearchParams();
  if (historyDate) historyParams.append('date', historyDate);
  if (historyDecision && historyDecision !== 'ALL') historyParams.append('decision', historyDecision);
  if (historySearch) historyParams.append('search', historySearch);
  historyParams.append('page', String(historyPage));
  historyParams.append('pageSize', String(historyPageSize));
  const historyQuery = historyParams.toString();
  // Filters whose history request last settled; any other query means a fetch is in flight.
  const [loadedHistoryQuery, setLoadedHistoryQuery] = useState<string | null>(null);

  const loadHistory = useCallback(
    () =>
      fetch(`/api/zmcc/lab/history?${historyQuery}`, { cache: 'no-store' })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setHistoryItems(data.items || []);
            if (data.total !== undefined) setHistoryTotal(data.total);
            if (data.totalPages !== undefined) setHistoryTotalPages(data.totalPages);
          } else {
            const err = await res.json().catch(() => ({}));
            toast.showError(err.error || 'Failed to fetch lab history');
          }
        })
        .catch(() => {
          toast.showError('Network error while fetching lab history');
        })
        .finally(() => {
          setLoadingHistory(false);
          setLoadedHistoryQuery(historyQuery);
        }),
    [historyQuery, toast]
  );

  const loadingHistory = refreshingHistory || (activeTab === 'HISTORY' && loadedHistoryQuery !== historyQuery);

  const fetchHistory = () => {
    setLoadingHistory(true);
    return loadHistory();
  };

  useEffect(() => {
    if (activeTab === 'QUEUE') {
      loadQueue();
    } else if (activeTab === 'HISTORY') {
      loadHistory();
    }
  }, [activeTab, loadQueue, loadHistory]);

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
    if (!rmrSeries.trim() || !rmrBookNumber.trim() || !rmrReceiptNumber.trim()) {
      toast.showError('Series, book number, and receipt number are required.');
      return;
    }
    setIssuingRmr(true);
    try {
      const res = await fetch(`/api/zmcc/local-supplier-arrivals/${rmrSession.local_supplier_arrival.id}/rmr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: rmrSeries, book_number: rmrBookNumber, receipt_number: rmrReceiptNumber, idempotency_key: `local-rmr-${rmrSession.id}-${Date.now()}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to issue Local Supplier RMR.');
      toast.showSuccess(`Local Supplier RMR issued: ${data.printable_reference}`);
      setRmrSession(null); fetchHistory();
    } catch (error) { toast.showError(getErrorMessage(error) || 'Failed to issue Local Supplier RMR.'); }
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
        <SegmentedTabs
          label="Laboratory views"
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={[
            ...(canTest ? [{ value: 'QUEUE' as const, label: 'Arrivals queue', icon: Clock, count: queueItems.length }] : []),
            ...(canTest && activeSession
              ? [{ value: 'TESTING' as const, label: 'Active session', icon: FlaskConical, badge: 'In progress' }]
              : []),
            { value: 'HISTORY' as const, label: 'History & corrections', icon: FileText },
          ]}
        />
      )}

      
      {activeTab === 'QUEUE' && canTest && (
        <div className="space-y-4 animate-panel-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search token, vehicle, supplier…"
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={fetchQueue}
              disabled={loadingQueue}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {loadingQueue ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              Loading pending arrivals…
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">No arrivals waiting for laboratory testing.</p>
              <p className="text-xs text-slate-500 mt-1">All recorded arrivals have been tested or none have arrived yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedQueue.map((item) => (
                <div
                  key={`${item.queue_type}-${item.arrival_id}`}
                  className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between hover:border-primary transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase ${
                          item.queue_type === 'MOT'
                            ? 'bg-blue-100 text-blue-800'
                            : item.queue_type === 'LOCAL_SUPPLIER'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-800 border border-slate-200'
                        }`}
                      >
                        {item.queue_type === 'MOT'
                          ? 'MOT Journey Milk'
                          : item.queue_type === 'LOCAL_SUPPLIER'
                          ? 'Local Supplier Milk'
                          : 'Historical Contractor Milk'}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1 tabular-nums">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(item.arrival_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div>
                      <div className="font-semibold text-slate-800 text-base">
                        {item.queue_type === 'MOT'
                          ? item.route_name || item.route_code || 'Direct MOT'
                          : item.queue_type === 'LOCAL_SUPPLIER'
                          ? item.local_supplier_name
                          : item.contractor_name}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Vehicle: <strong className="text-slate-700">{item.vehicle_number || 'N/A'}</strong></span>
                        <span>·</span>
                        <span>Token: <strong className="text-slate-700 tabular-nums">{item.zmcc_token}</strong></span>
                      </div>
                    </div>

                    {item.queue_type === 'MOT' && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                        <div>Journey: <strong>{item.journey_number}</strong></div>
                        <div>Mobile Tester: <strong>{item.mot_name || 'N/A'}</strong> ({item.mot_code || 'N/A'})</div>
                      </div>
                    )}

                    {item.queue_type === 'LOCAL_SUPPLIER' && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                        <div>Supplier Code: <strong>{item.local_supplier_code}</strong></div>
                        <div>RMR Number: <strong>{item.rmr_number || 'N/A'}</strong></div>
                      </div>
                    )}

                    {item.queue_type === 'CONTRACTOR' && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                        <div className="text-xs text-amber-700 font-semibold uppercase">Legacy / Historical Contractor Record</div>
                        <div>Contractor Code: <strong>{item.contractor_code}</strong></div>
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
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-hover transition-colors shadow-xs"
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

              {totalQueuePages > 1 && (
                <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-600 font-semibold">
                    Page {queuePage} of {totalQueuePages} ({filteredQueue.length} pending arrivals)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={queuePage <= 1}
                      onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={queuePage >= totalQueuePages}
                      onClick={() => setQueuePage((p) => Math.min(totalQueuePages, p + 1))}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      
      {activeTab === 'TESTING' && canTest && activeSession && (
        <div className="space-y-6 animate-panel-in">
          
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
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
                    activeSession.contractor_arrival?.zmcc_token ||
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
                activeSession.contractor_arrival?.zmcc_token ||
                null
              }
              vehicleNo={
                activeSession.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
                activeSession.local_supplier_arrival?.vehicle_number ||
                activeSession.contractor_arrival?.vehicle_number ||
                null
              }
              onFinished={() => {
                setActiveSession(null);
                setActiveTab('QUEUE');
                fetchQueue();
              }}
            />
          </div>
        </div>
      )}

      
      {activeTab === 'HISTORY' && (
        <div className="space-y-4 animate-panel-in">
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                  placeholder="Search token, vehicle…"
                  className="pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => { setHistoryDate(e.target.value); setHistoryPage(1); }}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              />

              <select
                value={historyDecision}
                onChange={(e) => { setHistoryDecision(e.target.value); setHistoryPage(1); }}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All decisions</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <button
              onClick={fetchHistory}
              disabled={loadingHistory}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
            >
              Filter
            </button>
          </div>

          
          {loadingHistory ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              Loading test history…
            </div>
          ) : historyItems.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              No completed laboratory testing records found.
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
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
                    <th className="py-3 px-4">Tank Receipt</th>
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
                      <td className="py-3.5 px-4 tabular-nums font-semibold text-slate-800">
                        #{item.id}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            item.arrival_type === 'MOT'
                              ? 'bg-blue-100 text-blue-800'
                              : item.arrival_type === 'LOCAL_SUPPLIER'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-800 border border-slate-200'
                          }`}
                        >
                          {item.arrival_type === 'CONTRACTOR' ? 'CONTRACTOR (historical)' : item.arrival_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-700">
                        {item.mot_arrival?.zmcc_token ||
                          item.local_supplier_arrival?.zmcc_token ||
                          item.contractor_arrival?.zmcc_token ||
                          '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {item.arrival_type === 'MOT' ? (
                          <span>
                            {item.mot_arrival?.journey?.route?.name || 'Route Milk'} (
                            {item.mot_arrival?.journey?.mot_vehicle?.vehicle_number || 'MOT'})
                          </span>
                        ) : item.arrival_type === 'LOCAL_SUPPLIER' ? (
                          <span>
                            {item.local_supplier_arrival?.local_supplier?.name || 'Local Supplier'} (
                            {item.local_supplier_arrival?.vehicle_number || '—'})
                          </span>
                        ) : (
                          <span>
                            <span className="text-slate-400 mr-1">[Historical]</span>
                            {item.contractor_arrival?.contractor_source?.name || 'Contractor'} (
                            {item.contractor_arrival?.vehicle_number || '—'})
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-800 font-semibold">
                        {item.quantity_value != null ? (
                          <span>
                            {Number(item.quantity_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                            <span className="text-xs text-slate-500 font-normal">
                              {item.quantity_unit === 'LITER' ? 'Liters' : item.quantity_unit}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Not captured under this version</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-700">
                        {item.gross_liters != null ? `${Number(item.gross_liters).toFixed(2)} L` : '—'}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums font-semibold text-emerald-700">
                        {item.at_13ts_liters != null ? `${Number(item.at_13ts_liters).toFixed(2)} L` : '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        {item.tank_receipt ? (
                          <div className="tabular-nums text-xs">
                            <span className="font-semibold text-slate-800">
                              {item.tank_receipt.tank?.tank_code || 'Tank'}
                            </span>
                            <div className="text-xs text-slate-500 font-sans">
                              {Number(item.tank_receipt.gross_liters).toFixed(2)} L
                            </div>
                          </div>
                        ) : item.decision === 'ACCEPTED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200">
                              Unassigned
                            </span>
                            {canReceiveHistorical && (
                              <button
                                type="button"
                                onClick={() => openHistoricalReceiveModal(item)}
                                className="px-2 py-0.5 text-xs font-semibold text-white bg-primary rounded hover:bg-primary-hover shadow-xs"
                              >
                                Receive
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {item.completed_at ? new Date(item.completed_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {item.completer?.full_name || item.completer?.username || '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        {item.manager_review_status === 'PENDING' ? (
                          <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                            MANAGER REVIEW
                          </span>
                        ) : item.decision === 'ACCEPTED' ? (
                          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                            ACCEPTED
                          </span>
                        ) : item.decision === 'REJECTED' ? (
                          <span className="text-xs font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full">
                            REJECTED
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                            PENDING
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-700">
                            Total Corrections: {item.correction_count ?? 0}
                          </div>
                          {isZmccManager ? (
                            <div className="text-xs text-slate-500">
                              Manager Corrections: {item.manager_correction_count ?? 0} / 5
                            </div>
                          ) : isSuperAdmin ? (
                            <div className="text-xs text-slate-500">
                              Manager Corrections Used: {item.manager_correction_count ?? 0} / 5
                            </div>
                          ) : null}
                          {item.last_corrected_at && (
                            <div className="text-xs text-slate-400">
                              Last by {item.last_corrector?.full_name || item.last_corrector?.username || 'user'}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {canTest && item.arrival_type === 'LOCAL_SUPPLIER' && item.final_decision === 'ACCEPTED' && item.tank_receipt && (
                          <button
                            onClick={() => { setRmrSession(item); setRmrSeries('LSR'); setRmrBookNumber(''); setRmrReceiptNumber(''); }}
                            className="mr-2 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-lg hover:bg-emerald-100"
                          >
                            Issue RMR
                          </button>
                        )}
                        {canDirectCorrect ? (
                          (isSuperAdmin || (item.manager_correction_count ?? 0) < 5) ? (
                            <button
                              onClick={() => openCorrection(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-primary bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                              Correct
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )
                        ) : isZmccManager ? (
                          <button
                            onClick={() => openRequestCorrection(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors cursor-pointer"
                          >
                            Request Correction
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            
            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <div>
                  Page <span className="font-semibold text-primary">{historyPage}</span> of{' '}
                  <span className="font-semibold text-primary">{historyTotalPages}</span> ({historyTotal} completed tests)
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1 || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= historyTotalPages || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )}

      
      <AnimatePresence>{showCorrectionModal && selectedHistorySession && (
        <Modal key="modal-1" onClose={() => setShowCorrectionModal(false)} title="Correct lab record" className="max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-slate-800 text-base">
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

            
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Correction Reason *
              </label>
              <input
                type="text"
                required
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Reason for changing lab results or decision…"
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>

            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Corrected Decision
                </label>
                <select
                  value={correctionDecision}
                  onChange={(e) => setCorrectionDecision(e.target.value as 'ACCEPTED' | 'REJECTED')}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </div>

              {correctionDecision === 'REJECTED' && (
                <div>
                  <label className="block text-xs font-semibold text-rose-700 mb-1">
                    Rejection Reason *
                  </label>
                  <input
                    type="text"
                    required
                    value={correctionRejectionReason}
                    onChange={(e) => setCorrectionRejectionReason(e.target.value)}
                    placeholder="Reason for rejection…"
                    className="w-full p-2.5 border border-rose-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              )}
            </div>

            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Actual Reception Quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={correctionQuantityValue}
                  onChange={(e) => setCorrectionQuantityValue(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs tabular-nums focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity Unit
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCorrectionQuantityUnit('KG')}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
                      correctionQuantityUnit === 'KG'
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    KG
                  </button>
                  <button
                    type="button"
                    onClick={() => setCorrectionQuantityUnit('LITER')}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
                      correctionQuantityUnit === 'LITER'
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    Liters
                  </button>
                </div>
              </div>
            </div>

            
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
                    <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5 text-primary" />
                      Recomputed Final Metrics Preview
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {corrPreview ? 'Recomputed' : 'Awaiting valid inputs'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Density</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? corrPreview.density.toFixed(4) : (selectedHistorySession.density != null ? Number(selectedHistorySession.density).toFixed(4) : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Gross Liters</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.grossLiters.toFixed(2)} L` : (selectedHistorySession.gross_liters != null ? `${Number(selectedHistorySession.gross_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">SNF</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.snf.toFixed(2)}%` : (selectedHistorySession.snf != null ? `${Number(selectedHistorySession.snf).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Total Solids</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.ts.toFixed(2)}%` : (selectedHistorySession.ts != null ? `${Number(selectedHistorySession.ts).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">@13TS Liters</span>
                      <p className="text-xs font-semibold tabular-nums text-emerald-700">
                        {corrPreview ? `${corrPreview.at13tsLiters.toFixed(2)} L` : (selectedHistorySession.at_13ts_liters != null ? `${Number(selectedHistorySession.at_13ts_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Override Parameter Values
              </label>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2">
                {selectedHistorySession.results?.map((res) => {
                  const testId = res.test_id;
                  const current = correctionValues[testId] || { numeric_value: '', text_value: '' };
                  const isCalculated = res.result_type_snapshot === 'CALCULATED';
                  const isNumeric = res.result_type_snapshot === 'NUMERIC';

                  return (
                    <div key={testId} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                      <div className="w-1/2">
                        <span className="font-semibold text-slate-800">{res.test_name_snapshot}</span>
                        <span className="text-xs text-slate-400 tabular-nums ml-2">({res.test_code_snapshot})</span>
                      </div>
                      <div className="w-1/2 flex items-center justify-end gap-2">
                        {isCalculated ? (
                          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 italic">
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
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs tabular-nums"
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
                        <span className="text-xs text-slate-400 tabular-nums w-10">
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
                className="px-5 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-hover transition-colors"
              >
                {savingCorrection ? 'Saving…' : 'Apply Correction'}
              </button>
            </div>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{rmrSession && (
        <Modal key="modal-2" onClose={() => setRmrSession(null)} title="Issue local supplier RMR" className="max-w-md p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-semibold text-slate-800">Issue Local Supplier RMR</h3><button onClick={() => setRmrSession(null)}><X className="w-4 h-4" /></button></div>
            <p className="text-xs text-slate-600">Enter the physical receipt book details. This number is permanent and cannot be reused.</p>
            <input value={rmrSeries} onChange={(e) => setRmrSeries(e.target.value)} placeholder="Series (for example LSR)" className="w-full p-2 border rounded-lg text-sm" />
            <input value={rmrBookNumber} onChange={(e) => setRmrBookNumber(e.target.value)} placeholder="Book number" className="w-full p-2 border rounded-lg text-sm" />
            <input value={rmrReceiptNumber} onChange={(e) => setRmrReceiptNumber(e.target.value)} placeholder="Receipt number" className="w-full p-2 border rounded-lg text-sm" />
            <div className="flex justify-end gap-2"><button onClick={() => setRmrSession(null)} className="px-3 py-2 text-xs border rounded-lg">Cancel</button><button disabled={issuingRmr} onClick={issueLocalSupplierRmr} className="px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50">{issuingRmr ? 'Issuing…' : 'Issue RMR'}</button></div>
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
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900 space-y-1">
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
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>No active ZMCC tank configured. Please configure an active tank first.</span>
                </div>
              ) : historicalTanks.length > 1 ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Configuration error: Multiple active tanks found. Only one active tank is permitted per ZMCC.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Destination Tank (Sole Active Tank)</label>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold">
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
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
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
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            toast.showSuccess('Correction request submitted to Data Executive desk.');
            fetchHistory();
          }}
        />
      )}
    </div>
  );
};
