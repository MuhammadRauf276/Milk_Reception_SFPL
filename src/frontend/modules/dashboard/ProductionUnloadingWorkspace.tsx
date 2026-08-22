'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Factory, Search, CheckCircle2, AlertCircle, Clock, Database, Play, CheckCheck, RefreshCw, ShieldAlert, ArrowRight, MinusCircle } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';

interface SiloOption {
  id: string;
  silo_code: string;
  silo_name: string;
  capacity_liters: number;
  current_stock_liters: number;
  active_reserved_liters: number;
  provisional_available_liters: number;
  is_active: boolean;
}

interface PortionDef {
  id: string;
  portion_number: number;
  declared_quantity_value: number | null;
  declared_quantity_unit?: string;
  plant_decision: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  plant_rejection_reason: string | null;
  current_status: string;
  lr: number | null;
  fat: number | null;
  snf?: number | null;
  ts?: number | null;
  expected_physical_liters: number | null;
  expected_at13_ts_liters: number | null;
  unloading_log?: {
    id: string;
    silo_id: string | null;
    silo_number: string | null;
    silo_code?: string;
    silo_name?: string | null;
    pump_start_timestamp: string | null;
    started_by_name?: string | null;
  } | null;
}

interface ReadyVisitDef {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  current_status: string;
  gross_weight_kg: number | null;
  gross_timestamp: string | null;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  total_accepted_declared_value: number | null;
  total_accepted_declared_unit: string | null;
  total_accepted_physical_liters: number | null;
  total_accepted_at13_ts_liters: number | null;
  waiting_minutes: number;
  portions: PortionDef[];
}

interface UnloadingVisitDef {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  current_status: string;
  gross_weight_kg: number | null;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  total_accepted_declared_value: number | null;
  total_accepted_declared_unit: string | null;
  total_accepted_physical_liters: number | null;
  total_accepted_at13_ts_liters: number | null;
  started_at: string | null;
  started_by_name: string;
  elapsed_minutes: number;
  portions: PortionDef[];
}

interface SiloIssueHistoryDef {
  id: string;
  time_formatted: string;
  quantity_liters: number;
  purpose: string;
  flow_meter_reference: string | null;
  operator_name: string;
}

interface ProductionUnloadingWorkspaceProps {
  currentUser: User | null;
}

export const ProductionUnloadingWorkspace: React.FC<ProductionUnloadingWorkspaceProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'READY' | 'UNLOADING' | 'SILO_ISSUE'>('READY');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab 1 (Ready) state
  const [readyVisits, setReadyVisits] = useState<ReadyVisitDef[]>([]);
  const [activeSilos, setActiveSilos] = useState<SiloOption[]>([]);
  const [selectedReadyVisitId, setSelectedReadyVisitId] = useState<string | null>(null);

  // Tab 2 (Unloading) state
  const [unloadingVisits, setUnloadingVisits] = useState<UnloadingVisitDef[]>([]);
  const [selectedUnloadingVisitId, setSelectedUnloadingVisitId] = useState<string | null>(null);

  // Tab 3 (Silo Issue) state
  const [selectedIssueSiloId, setSelectedIssueSiloId] = useState<string | null>(null);
  const [issueQuantityLiters, setIssueQuantityLiters] = useState<string>('');
  const [issuePurpose, setIssuePurpose] = useState<string>('UHT Milk');
  const [issueFlowMeterRef, setIssueFlowMeterRef] = useState<string>('');
  const [issueOpTimestamp, setIssueOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [issueHistory, setIssueHistory] = useState<SiloIssueHistoryDef[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Input states for Unloading
  const [portionSiloMap, setPortionSiloMap] = useState<Record<string, string>>({}); // portionId -> siloId
  const [startOpTimestamp, setStartOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [completeOpTimestamp, setCompleteOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));

  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Local helper for local ISO datetime-local format
  const getLocalISOString = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  useEffect(() => {
    setStartOpTimestamp(getLocalISOString());
    setCompleteOpTimestamp(getLocalISOString());
    setIssueOpTimestamp(getLocalISOString());
  }, []);

  // Fetch Ready Queue & Silo Data
  const fetchReadyData = async (query = searchQuery, isCancelledFlag = { current: false }) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/production/ready-for-unloading?search=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (isCancelledFlag.current) return;

      if (res.ok) {
        const fetchedVisits: ReadyVisitDef[] = data.visits || [];
        const fetchedSilos: SiloOption[] = data.silos || [];
        setReadyVisits(fetchedVisits);
        setActiveSilos(fetchedSilos);

        // Auto-selection repair for Ready queue
        setSelectedReadyVisitId((prev) => {
          if (prev && fetchedVisits.some((v) => v.id === prev)) {
            return prev;
          }
          return fetchedVisits.length > 0 ? fetchedVisits[0].id : null;
        });

        // Auto-selection repair for Silo Issue queue (first visible silo with stock or matching query)
        setSelectedIssueSiloId((prev) => {
          if (prev && fetchedSilos.some((s) => s.id === prev)) {
            return prev;
          }
          const eligible = fetchedSilos.filter((s) => s.current_stock_liters > 0);
          return eligible.length > 0 ? eligible[0].id : fetchedSilos.length > 0 ? fetchedSilos[0].id : null;
        });
      } else {
        setErrorMsg(data.error || 'Failed to fetch ready for unloading vehicles');
      }
    } catch (err: any) {
      if (!isCancelledFlag.current) {
        setErrorMsg('Network error fetching ready queue');
      }
    } finally {
      if (!isCancelledFlag.current) {
        setIsLoading(false);
      }
    }
  };

  // Fetch Unloading Queue Data
  const fetchUnloadingData = async (query = searchQuery, isCancelledFlag = { current: false }) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/production/unloading-queue?search=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (isCancelledFlag.current) return;

      if (res.ok) {
        const fetchedVisits: UnloadingVisitDef[] = data.visits || [];
        setUnloadingVisits(fetchedVisits);

        // Auto-selection repair
        setSelectedUnloadingVisitId((prev) => {
          if (prev && fetchedVisits.some((v) => v.id === prev)) {
            return prev;
          }
          return fetchedVisits.length > 0 ? fetchedVisits[0].id : null;
        });
      } else {
        setErrorMsg(data.error || 'Failed to fetch unloading vehicles');
      }
    } catch (err: any) {
      if (!isCancelledFlag.current) {
        setErrorMsg('Network error fetching unloading queue');
      }
    } finally {
      if (!isCancelledFlag.current) {
        setIsLoading(false);
      }
    }
  };

  // Fetch Silo Issue History
  const fetchIssueHistory = async (siloId: string) => {
    try {
      setHistoryLoading(true);
      const res = await fetch(`/api/production/silo-issue/history?siloId=${encodeURIComponent(siloId)}`);
      const data = await res.json();
      if (res.ok) {
        setIssueHistory(data.issues || []);
      }
    } catch (err) {
      console.error('Failed to fetch issue history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Fetch Silo Issue history when selected issue silo changes
  useEffect(() => {
    if (selectedIssueSiloId && activeTab === 'SILO_ISSUE') {
      fetchIssueHistory(selectedIssueSiloId);
    }
  }, [selectedIssueSiloId, activeTab]);

  // Load active tab data & set 5s live polling
  useEffect(() => {
    const isCancelledFlag = { current: false };

    if (activeTab === 'READY' || activeTab === 'SILO_ISSUE') {
      fetchReadyData(searchQuery, isCancelledFlag);
    } else {
      fetchUnloadingData(searchQuery, isCancelledFlag);
    }

    const interval = setInterval(() => {
      if (activeTab === 'READY' || activeTab === 'SILO_ISSUE') {
        fetchReadyData(searchQuery, isCancelledFlag);
      } else {
        fetchUnloadingData(searchQuery, isCancelledFlag);
      }
    }, 5000);

    return () => {
      isCancelledFlag.current = true;
      clearInterval(interval);
    };
  }, [activeTab, searchQuery]);

  // Selected vehicle & silo helpers
  const selectedReadyVisit = useMemo(
    () => readyVisits.find((v) => v.id === selectedReadyVisitId) || null,
    [readyVisits, selectedReadyVisitId]
  );

  const selectedUnloadingVisit = useMemo(
    () => unloadingVisits.find((v) => v.id === selectedUnloadingVisitId) || null,
    [unloadingVisits, selectedUnloadingVisitId]
  );

  const selectedIssueSilo = useMemo(
    () => activeSilos.find((s) => s.id === selectedIssueSiloId) || null,
    [activeSilos, selectedIssueSiloId]
  );

  // Silo list for Silo Issue tab (filter by search query, prioritize stock > 0)
  const siloIssueList = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return activeSilos.filter((s) => {
      if (!query) return true;
      return s.silo_code.toLowerCase().includes(query) || s.silo_name.toLowerCase().includes(query);
    });
  }, [activeSilos, searchQuery]);

  // Pre-fill default Silo inputs when selected ready visit changes
  useEffect(() => {
    if (selectedReadyVisit && activeSilos.length > 0) {
      const newMap: Record<string, string> = {};
      const acceptedPortions = selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      const activeOnlySilos = activeSilos.filter((s) => s.is_active);
      acceptedPortions.forEach((p, idx) => {
        const targetSilo = activeOnlySilos[idx % activeOnlySilos.length] || activeSilos[0];
        newMap[p.id] = portionSiloMap[p.id] || targetSilo?.id || '';
      });
      setPortionSiloMap(newMap);
    }
  }, [selectedReadyVisitId, activeSilos]);

  const toast = useToast();

  // Handle Start Unloading
  const handleStartUnloading = async () => {
    if (!selectedReadyVisit) return;

    const acceptedPortions = selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
    const assignments = acceptedPortions.map((p) => ({
      portionId: p.id,
      siloId: portionSiloMap[p.id],
    }));

    const missingSilo = assignments.some((a) => !a.siloId);
    if (missingSilo) {
      const errText = 'Destination Silo is required for every accepted portion before starting unloading.';
      setErrorMsg(errText);
      toast.showError(errText, 'Validation Error');
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const firstPortion = acceptedPortions[0];
      const res = await fetch(`/api/production/vehicle-visits/${selectedReadyVisit.id}/portions/${firstPortion.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments,
          opTimestamp: datetimeLocalToIso(startOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const successText = `Unloading started for vehicle ${selectedReadyVisit.vehicle_number}.`;
        toast.showSuccess(successText, 'Unloading Started');
        fetchReadyData();
        fetchUnloadingData();
        setActiveTab('UNLOADING');
      } else {
        const errText = data.error || 'Failed to start unloading';
        setErrorMsg(errText);
        toast.showError(errText, 'Unloading Error');
      }
    } catch (err: any) {
      const errText = 'Network error starting unloading';
      setErrorMsg(errText);
      toast.showError(errText, 'Network Error');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Complete Unloading
  const handleCompleteUnloading = async () => {
    if (!selectedUnloadingVisit) return;

    const acceptedPortions = selectedUnloadingVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
    if (acceptedPortions.length === 0) return;

    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const firstPortion = acceptedPortions[0];
      const res = await fetch(`/api/production/vehicle-visits/${selectedUnloadingVisit.id}/portions/${firstPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opTimestamp: datetimeLocalToIso(completeOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const successText = `Unloading completed for vehicle ${selectedUnloadingVisit.vehicle_number}. Vehicle moved to READY_FOR_TARE.`;
        toast.showSuccess(successText, 'Unloading Completed');
        fetchReadyData();
        fetchUnloadingData();
        setActiveTab('READY');
      } else {
        const errText = data.error || 'Failed to complete unloading';
        setErrorMsg(errText);
        toast.showError(errText, 'Unloading Error');
      }
    } catch (err: any) {
      const errText = 'Network error completing unloading';
      setErrorMsg(errText);
      toast.showError(errText, 'Network Error');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Record Silo Issue
  const handleRecordSiloIssue = async () => {
    if (!selectedIssueSilo) return;

    const quantityNum = Number(issueQuantityLiters);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      const errText = 'Issue quantity must be a positive number greater than 0 Liters.';
      setErrorMsg(errText);
      toast.showError(errText, 'Validation Error');
      return;
    }

    if (quantityNum > selectedIssueSilo.current_stock_liters) {
      const errText = `Issue quantity (${quantityNum.toLocaleString()} L) exceeds available physical stock (${selectedIssueSilo.current_stock_liters.toLocaleString()} L).`;
      setErrorMsg(errText);
      toast.showError(errText, 'Stock Error');
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const clientRequestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const res = await fetch('/api/production/silo-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siloId: selectedIssueSilo.id,
          quantityLiters: quantityNum,
          operationalTimestamp: datetimeLocalToIso(issueOpTimestamp) || undefined,
          purpose: issuePurpose,
          flowMeterReference: issueFlowMeterRef,
          clientRequestId,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const successText = `Milk issue of ${quantityNum.toLocaleString()} L recorded from ${selectedIssueSilo.silo_code}.`;
        toast.showSuccess(successText, 'Silo Issue Recorded');
        setIssueQuantityLiters('');
        setIssueFlowMeterRef('');
        fetchReadyData();
        fetchIssueHistory(selectedIssueSilo.id);
      } else {
        const errText = data.error || 'Failed to record silo milk issue';
        setErrorMsg(errText);
        toast.showError(errText, 'Silo Issue Error');
      }
    } catch (err: any) {
      const errText = 'Network error recording silo milk issue';
      setErrorMsg(errText);
      toast.showError(errText, 'Network Error');
    } finally {
      setActionLoading(false);
    }
  };

  // Preview remaining liters for Silo Issue form
  const parsedIssueLiters = Number(issueQuantityLiters) || 0;
  const currentStock = selectedIssueSilo ? selectedIssueSilo.current_stock_liters : 0;
  const previewRemaining = currentStock - parsedIssueLiters;
  const isOverIssue = parsedIssueLiters > currentStock;

  return (
    <div className="space-y-6">
      {/* Top Banner & Tab Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 rounded-lg text-amber-700">
              <Factory className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">Milk Operations</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live
                </span>
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[280px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'SILO_ISSUE' ? "Search silo code or name..." : "Search vehicle or token..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={() => {
              setActiveTab('READY');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'READY'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Clock className="w-4 h-4" />
            Ready for Unloading
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              activeTab === 'READY' ? 'bg-amber-700 text-amber-100' : 'bg-gray-200 text-gray-700'
            }`}>
              {readyVisits.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('UNLOADING');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'UNLOADING'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Play className="w-4 h-4" />
            Unloading
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              activeTab === 'UNLOADING' ? 'bg-amber-700 text-amber-100' : 'bg-gray-200 text-gray-700'
            }`}>
              {unloadingVisits.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('SILO_ISSUE');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'SILO_ISSUE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <MinusCircle className="w-4 h-4" />
            Silo Issue
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              activeTab === 'SILO_ISSUE' ? 'bg-amber-700 text-amber-100' : 'bg-gray-200 text-gray-700'
            }`}>
              {activeSilos.filter((s) => s.current_stock_liters > 0).length}
            </span>
          </button>
        </div>
      </div>

      {/* Workspace Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Queue List / Silo List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          {activeTab === 'READY' && (
            readyVisits.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">No vehicles are ready for unloading.</p>
              </div>
            ) : (
              readyVisits.map((v) => {
                const isSelected = v.id === selectedReadyVisitId;
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedReadyVisitId(v.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-base">{v.vehicle_number}</span>
                        {v.token_number && (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-md">
                            Token: {v.token_number}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {v.waiting_minutes} min wait
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono">
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Gross Weight:</span>
                        <span className="font-bold text-gray-900">{v.gross_weight_kg ? v.gross_weight_kg.toLocaleString() : '—'} kg</span>
                      </div>
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Expected Volume:</span>
                        <span className="font-bold text-amber-700">{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'UNLOADING' && (
            unloadingVisits.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Play className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">No vehicles are currently unloading.</p>
              </div>
            ) : (
              unloadingVisits.map((v) => {
                const isSelected = v.id === selectedUnloadingVisitId;
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedUnloadingVisitId(v.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-base">{v.vehicle_number}</span>
                        <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 rounded-md animate-pulse">
                          Unloading Active
                        </span>
                      </div>
                      <span className="text-xs text-amber-700 font-bold flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5" />
                        {v.elapsed_minutes} min
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono">
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Unloading Volume:</span>
                        <span className="font-bold text-amber-900">{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Started By:</span>
                        <span className="font-medium text-gray-700">{v.started_by_name}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'SILO_ISSUE' && (
            siloIssueList.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Database className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">No silos match search query or have stock available.</p>
              </div>
            ) : (
              siloIssueList.map((silo) => {
                const isSelected = silo.id === selectedIssueSiloId;
                return (
                  <div
                    key={silo.id}
                    onClick={() => setSelectedIssueSiloId(silo.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-base">{silo.silo_code}</span>
                        <span className="text-xs text-gray-500 font-medium">— {silo.silo_name}</span>
                      </div>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-md ${
                        silo.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}>
                        {silo.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono">
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Current Physical Stock:</span>
                        <span className="font-black text-amber-900 text-sm">{silo.current_stock_liters.toLocaleString()} L</span>
                      </div>
                      <div>
                        <span className="text-gray-500 font-sans block text-[11px]">Maximum Capacity:</span>
                        <span className="font-medium text-gray-700">{silo.capacity_liters.toLocaleString()} L</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>

        {/* Right Column: Action Form / Details (7 cols) */}
        <div className="lg:col-span-7">
          {activeTab === 'READY' && (
            selectedReadyVisit ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Start Unloading</h2>
                    <p className="text-xs text-gray-500 font-mono">Vehicle: {selectedReadyVisit.vehicle_number} | Token: {selectedReadyVisit.token_number || '—'}</p>
                  </div>
                  <span className="px-3 py-1 bg-amber-50 text-amber-800 text-xs font-bold rounded-lg border border-amber-200">
                    Ready for Unloading
                  </span>
                </div>

                {/* Portion Assignment Table */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Accepted Portions & Destination Silos</h3>
                  {selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900 text-sm">
                          Portion #{p.portion_number} ({p.declared_quantity_value !== null ? p.declared_quantity_value.toLocaleString() : '—'} {p.declared_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-xs font-mono font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                          Expected: {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-gray-700">
                          Destination Silo <span className="text-rose-600">*</span>
                        </label>
                        <select
                          value={portionSiloMap[p.id] || ''}
                          onChange={(e) => setPortionSiloMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Select Target Silo...</option>
                          {activeSilos.filter((s) => s.is_active).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.silo_code} — {s.silo_name} (Avail: {s.provisional_available_liters.toLocaleString()} L)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Operational Timestamp */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-gray-700">
                    Unloading Start Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={startOpTimestamp}
                    min={selectedReadyVisit.gross_timestamp ? toDatetimeLocalInput(selectedReadyVisit.gross_timestamp) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setStartOpTimestamp(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-medium rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStartUnloading}
                  className="w-full py-3.5 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2"
                >
                  {actionLoading ? <span>Starting Unloading...</span> : <> <Play className="w-4 h-4" /> <span>Start Unloading</span> </>}
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                Select a vehicle from the ready queue to assign silos and start unloading.
              </div>
            )
          )}

          {activeTab === 'UNLOADING' && (
            selectedUnloadingVisit ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Complete Unloading</h2>
                    <p className="text-xs text-gray-500 font-mono">Vehicle: {selectedUnloadingVisit.vehicle_number} | Started by: {selectedUnloadingVisit.started_by_name}</p>
                  </div>
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-lg border border-emerald-200 animate-pulse">
                    Unloading In Progress
                  </span>
                </div>

                {/* Portion Silo Assignments Read-Only */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Silo Assignment</h3>
                  {selectedUnloadingVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-gray-900 block">
                          Portion #{p.portion_number} ({p.declared_quantity_value !== null ? p.declared_quantity_value.toLocaleString() : '—'} {p.declared_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-gray-600">Assigned Silo: <strong className="text-emerald-900 font-bold">{p.unloading_log?.silo_code || p.unloading_log?.silo_number || 'Silo 1'}</strong></span>
                      </div>
                      <span className="font-mono font-bold text-emerald-800">
                        {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Operational Timestamp */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-gray-700">
                    Unloading Complete Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={completeOpTimestamp}
                    min={selectedUnloadingVisit.started_at ? toDatetimeLocalInput(selectedUnloadingVisit.started_at) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setCompleteOpTimestamp(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-medium rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleCompleteUnloading}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2"
                >
                  {actionLoading ? <span>Completing Unloading...</span> : <> <CheckCheck className="w-4 h-4" /> <span>Complete Unloading</span> </>}
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                Select a vehicle from the unloading in-progress queue to record completion.
              </div>
            )
          )}

          {activeTab === 'SILO_ISSUE' && (
            selectedIssueSilo ? (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Record Milk Issue</h2>
                      <p className="text-xs text-gray-500 font-mono">Silo: {selectedIssueSilo.silo_code} ({selectedIssueSilo.silo_name})</p>
                    </div>
                    <span className={`px-3 py-1 text-xs font-bold rounded-lg border ${
                      selectedIssueSilo.is_active ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      {selectedIssueSilo.is_active ? 'Active Silo' : 'Inactive Silo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 text-xs font-mono">
                    <div>
                      <span className="text-gray-500 font-sans block text-[11px]">Current Physical Stock:</span>
                      <span className="font-black text-amber-900 text-base">{selectedIssueSilo.current_stock_liters.toLocaleString()} L</span>
                    </div>
                    <div>
                      <span className="text-gray-500 font-sans block text-[11px]">Preview Remaining Stock:</span>
                      <span className={`font-black text-base ${isOverIssue ? 'text-rose-600' : 'text-gray-900'}`}>
                        {previewRemaining.toLocaleString()} L
                      </span>
                    </div>
                  </div>

                  {/* Stock Preview */}
                  {parsedIssueLiters > 0 && (
                    <div className={`p-4 rounded-xl border text-xs font-mono ${
                      isOverIssue ? 'bg-red-50 border-red-300 text-red-900' : 'bg-blue-50 border-blue-200 text-blue-950'
                    }`}>
                      <div className="flex items-center justify-between font-bold">
                        <span>After-Issue Stock Preview:</span>
                        <span className={`text-sm ${isOverIssue ? 'text-red-700' : 'text-blue-900'}`}>
                          {previewRemaining.toLocaleString()} L
                        </span>
                      </div>
                      {isOverIssue && (
                        <p className="mt-1 text-[11px] text-red-600 font-sans">
                          Issue quantity exceeds current physical stock in {selectedIssueSilo.silo_code}!
                        </p>
                      )}
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="button"
                    disabled={actionLoading || !issueQuantityLiters || isOverIssue}
                    onClick={handleRecordSiloIssue}
                    className="w-full py-3.5 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <span>Recording Issue...</span> : <> <MinusCircle className="w-4 h-4" /> <span>Record Silo Issue</span> </>}
                  </button>
                </div>

                {/* Compact Recent Issues Card */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Recent Issues — {selectedIssueSilo.silo_code}</h3>
                    <span className="text-[11px] text-gray-400 font-mono">Last 10 Records</span>
                  </div>

                  {historyLoading ? (
                    <div className="p-4 text-center text-xs text-gray-400 font-mono">Loading issue history...</div>
                  ) : issueHistory.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400">No recent milk issues recorded for this silo.</div>
                  ) : (
                    <div className="space-y-2">
                      {issueHistory.map((h) => (
                        <div key={h.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-gray-900 block">{h.purpose}</span>
                            <span className="text-[11px] text-gray-500 font-mono">
                              {h.time_formatted} | {h.operator_name} {h.flow_meter_reference ? `| ${h.flow_meter_reference}` : ''}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-amber-800 text-sm">
                            -{h.quantity_liters.toLocaleString()} L
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                Select a silo from the list to record outbound milk issue.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
