'use client';

import React, { useState, useEffect } from 'react';
import { Factory, Search, Clock, Database, Play, CheckCheck, RefreshCw, Radio, MinusCircle } from 'lucide-react';
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
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
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
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  total_accepted_dispatch_value: number | null;
  total_accepted_dispatch_unit: string | null;
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
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  total_accepted_dispatch_value: number | null;
  total_accepted_dispatch_unit: string | null;
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
  const [_errorMsg, setErrorMsg] = useState<string | null>(null);
  const [_successMsg, setSuccessMsg] = useState<string | null>(null);

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

        if (fetchedVisits.length > 0 && !selectedReadyVisitId) {
          setSelectedReadyVisitId(fetchedVisits[0].id);
        }
        if (fetchedSilos.length > 0 && !selectedIssueSiloId) {
          const withStock = fetchedSilos.find((s) => s.current_stock_liters > 0);
          setSelectedIssueSiloId(withStock ? withStock.id : fetchedSilos[0].id);
        }
      }
    } catch (_err) {
      // Handled silently
    } finally {
      if (!isCancelledFlag.current) setIsLoading(false);
    }
  };

  // Fetch Unloading Active Queue
  const fetchUnloadingData = async (query = searchQuery, isCancelledFlag = { current: false }) => {
    try {
      const res = await fetch(`/api/production/unloading-queue?search=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (isCancelledFlag.current) return;

      if (res.ok) {
        const fetchedVisits: UnloadingVisitDef[] = data.visits || [];
        setUnloadingVisits(fetchedVisits);
        if (fetchedVisits.length > 0 && !selectedUnloadingVisitId) {
          setSelectedUnloadingVisitId(fetchedVisits[0].id);
        }
      }
    } catch (_err) {
      // Handled silently
    }
  };

  // Fetch Silo Issue History
  const fetchIssueHistory = async (siloId: string) => {
    if (!siloId) return;
    try {
      setHistoryLoading(true);
      const res = await fetch(`/api/production/silo-issue/history?siloId=${siloId}`);
      const data = await res.json();
      if (res.ok) {
        setIssueHistory(data.history || []);
      }
    } catch (_err) {
      // Handled silently
    } finally {
      setHistoryLoading(false);
    }
  };

  // Polling intervals & query effect
  useEffect(() => {
    const isCancelledFlag = { current: false };

    fetchReadyData(searchQuery, isCancelledFlag);
    fetchUnloadingData(searchQuery, isCancelledFlag);

    const interval = setInterval(() => {
      fetchReadyData(searchQuery, isCancelledFlag);
      fetchUnloadingData(searchQuery, isCancelledFlag);
    }, 5000);

    return () => {
      isCancelledFlag.current = true;
      clearInterval(interval);
    };
  }, [searchQuery]);

  // Load history when issue silo selection changes
  useEffect(() => {
    if (selectedIssueSiloId && activeTab === 'SILO_ISSUE') {
      fetchIssueHistory(selectedIssueSiloId);
    }
  }, [selectedIssueSiloId, activeTab]);

  // Active object references
  const selectedReadyVisit = readyVisits.find((v) => v.id === selectedReadyVisitId) || null;
  const selectedUnloadingVisit = unloadingVisits.find((v) => v.id === selectedUnloadingVisitId) || null;
  const selectedIssueSilo = activeSilos.find((s) => s.id === selectedIssueSiloId) || null;

  // Filtered Silo list for Issue tab
  const siloIssueList = activeSilos.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return s.silo_code.toLowerCase().includes(q) || s.silo_name.toLowerCase().includes(q);
  });

  // Auto-populate default silo mapping for selected ready visit
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
    } catch (_err) {
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
    } catch (_err) {
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
    } catch (_err) {
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
    <div className="w-full max-w-7xl mx-auto space-y-6 text-[#111311]">
      {/* Top Header & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#C4B9A3]">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#111311] flex items-center gap-2">
            <Factory className="w-6 h-6 text-[#1E3A8A]" />
            Production & Silo Unloading
          </h2>
          <p className="text-xs text-[#334155] font-semibold mt-0.5">
            Operator: <strong className="text-[#111311]">{currentUser?.name || 'Production Operator'}</strong> | Unloading Bays & Silo Stock Management
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-[#EFE9D9] p-1.5 rounded-2xl border border-[#C4B9A3] overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => {
              setActiveTab('READY');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'READY'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Ready for Unloading</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'READY' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {readyVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('UNLOADING');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'UNLOADING'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <Play className="w-4 h-4" />
            <span>Unloading Active</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'UNLOADING' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {unloadingVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('SILO_ISSUE');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 shrink-0 min-h-[44px] ${
              activeTab === 'SILO_ISSUE'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <MinusCircle className="w-4 h-4" />
            <span>Silo Issue</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'SILO_ISSUE' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'
            }`}>
              {activeSilos.filter((s) => s.current_stock_liters > 0).length}
            </span>
          </button>
        </div>

        <div className="hidden lg:flex items-center space-x-1.5 px-3 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200 shrink-0">
          <Radio className="w-3 h-3 animate-pulse text-emerald-600" />
          <span>Live Bays</span>
        </div>
      </div>

      {/* Workspace Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Queue List / Silo List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-[#111311]">
              {activeTab === 'READY' ? 'Ready Queue' : activeTab === 'UNLOADING' ? 'In Unloading Queue' : 'Active Silos'}
            </h3>
            <span className="text-xs font-mono font-bold text-slate-500">
              {activeTab === 'READY' ? `${readyVisits.length} ready` : activeTab === 'UNLOADING' ? `${unloadingVisits.length} unloading` : `${siloIssueList.length} silos`}
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={activeTab === 'SILO_ISSUE' ? 'Search silo code or name...' : 'Search vehicle or token...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            />
          </div>

          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading production queue...
              </div>
            ) : activeTab === 'READY' ? (
              readyVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No vehicles currently ready for unloading.
                </div>
              ) : (
                readyVisits.map((v) => {
                  const isSelected = v.id === selectedReadyVisitId;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setSelectedReadyVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                          : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          {v.token_number && (
                            <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                              ({v.token_number})
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] font-mono font-bold flex items-center space-x-1 ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                          <Clock className="w-3 h-3" />
                          <span>{v.waiting_minutes}m wait</span>
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg font-mono font-bold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-[#F4EFE3] text-[#334155] border border-[#C4B9A3]'
                      }`}>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Gross Weight</span>
                          <span>{v.gross_weight_kg ? `${v.gross_weight_kg.toLocaleString()} kg` : '—'}</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Expected Volume</span>
                          <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : activeTab === 'UNLOADING' ? (
              unloadingVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No vehicles are currently unloading.
                </div>
              ) : (
                unloadingVisits.map((v) => {
                  const isSelected = v.id === selectedUnloadingVisitId;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setSelectedUnloadingVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                          : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-[#1E3A8A] border border-blue-300'
                          }`}>
                            Unloading Active
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono font-bold flex items-center space-x-1 ${isSelected ? 'text-blue-200' : 'text-amber-800'}`}>
                          <Clock className="w-3 h-3" />
                          <span>{v.elapsed_minutes}m</span>
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg font-mono font-bold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-[#F4EFE3] text-[#334155] border border-[#C4B9A3]'
                      }`}>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Unloading Volume</span>
                          <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Started By</span>
                          <span className="truncate block">{v.started_by_name}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              siloIssueList.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No silos match query or have stock available.
                </div>
              ) : (
                siloIssueList.map((silo) => {
                  const isSelected = silo.id === selectedIssueSiloId;
                  return (
                    <div
                      key={silo.id}
                      onClick={() => setSelectedIssueSiloId(silo.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                          : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{silo.silo_code}</span>
                          <span className={`text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#334155]'}`}>
                            ({silo.silo_name})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                          silo.is_active
                            ? isSelected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {silo.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg font-mono font-bold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-[#F4EFE3] text-[#334155] border border-[#C4B9A3]'
                      }`}>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Physical Stock</span>
                          <span className="text-sm font-black">{silo.current_stock_liters.toLocaleString()} L</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[9.5px] opacity-75">Capacity</span>
                          <span>{silo.capacity_liters.toLocaleString()} L</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>

        {/* Right Column: Action Form / Details (7 cols) */}
        <div className="lg:col-span-7">
          {activeTab === 'READY' && (
            !selectedReadyVisit ? (
              <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                Select a vehicle from the ready queue to assign silos and start unloading.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-6 text-[#111311]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#C4B9A3] pb-4">
                  <div>
                    <h3 className="text-base font-extrabold text-[#111311]">Start Silo Unloading</h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedReadyVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E3A8A]">{selectedReadyVisit.token_number || 'NO-TOKEN'}</strong>
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] uppercase font-mono font-bold bg-blue-100 text-[#1E3A8A] border border-blue-300 self-start sm:self-auto">
                    Ready for Unloading
                  </span>
                </div>

                {/* Portion Assignment Table */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#111311]">
                    Accepted Portions & Destination Silos
                  </h4>
                  {selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-[#F4EFE3] rounded-xl border border-[#C4B9A3] space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-extrabold text-sm text-[#111311]">
                          Portion #{p.portion_number} ({p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? p.dispatch_quantity_value.toLocaleString() : '—'} {p.dispatch_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-xs font-mono font-bold text-[#1E3A8A] bg-white px-2 py-0.5 rounded border border-[#C4B9A3]">
                          Expected: {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-[#111311]">
                          Destination Silo <span className="text-rose-600">*</span>
                        </label>
                        <select
                          value={portionSiloMap[p.id] || ''}
                          onChange={(e) => setPortionSiloMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
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
                  <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                    Unloading Start Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={startOpTimestamp}
                    min={selectedReadyVisit.gross_timestamp ? toDatetimeLocalInput(selectedReadyVisit.gross_timestamp) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setStartOpTimestamp(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStartUnloading}
                  className="w-full min-h-[44px] py-3.5 px-4 bg-[#1E3A8A] hover:bg-blue-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                >
                  {actionLoading ? <span>Starting Unloading...</span> : <> <Play className="w-4 h-4" /> <span>Start Silo Unloading</span> </>}
                </button>
              </div>
            )
          )}

          {activeTab === 'UNLOADING' && (
            !selectedUnloadingVisit ? (
              <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                Select a vehicle from the unloading in-progress queue to record completion.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-6 text-[#111311]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#C4B9A3] pb-4">
                  <div>
                    <h3 className="text-base font-extrabold text-[#111311]">Complete Silo Unloading</h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedUnloadingVisit.vehicle_number}</strong> | Started by: <strong className="text-[#1E3A8A]">{selectedUnloadingVisit.started_by_name}</strong>
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] uppercase font-mono font-bold bg-blue-100 text-[#1E3A8A] border border-blue-300 self-start sm:self-auto">
                    Unloading Active
                  </span>
                </div>

                {/* Portion Silo Assignments Read-Only */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#111311]">
                    Assigned Silo Allocation
                  </h4>
                  {selectedUnloadingVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-[#F4EFE3] rounded-xl border border-[#C4B9A3] flex items-center justify-between text-xs font-mono font-bold">
                      <div>
                        <span className="font-black text-[#111311] block">
                          Portion #{p.portion_number} ({p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? p.dispatch_quantity_value.toLocaleString() : '—'} {p.dispatch_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-slate-600 font-sans text-[11px]">
                          Destination: <strong className="text-[#1E3A8A]">{p.unloading_log?.silo_code || p.unloading_log?.silo_number || 'Silo 1'}</strong>
                        </span>
                      </div>
                      <span className="text-emerald-800 text-sm font-black">
                        {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Operational Timestamp */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                    Unloading Completion Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={completeOpTimestamp}
                    min={selectedUnloadingVisit.started_at ? toDatetimeLocalInput(selectedUnloadingVisit.started_at) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setCompleteOpTimestamp(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleCompleteUnloading}
                  className="w-full min-h-[44px] py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                >
                  {actionLoading ? <span>Completing Unloading...</span> : <> <CheckCheck className="w-4 h-4" /> <span>Confirm Unloading Completion</span> </>}
                </button>
              </div>
            )
          )}

          {activeTab === 'SILO_ISSUE' && (
            !selectedIssueSilo ? (
              <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                Select a silo from the list to record outbound milk issue.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-6 text-[#111311]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#C4B9A3] pb-4">
                    <div>
                      <h3 className="text-base font-extrabold text-[#111311]">Record Outbound Milk Issue</h3>
                      <p className="text-xs text-[#334155] font-semibold mt-0.5">
                        Silo: <strong className="font-mono text-[#111311]">{selectedIssueSilo.silo_code}</strong> ({selectedIssueSilo.silo_name})
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-mono font-bold ${
                      selectedIssueSilo.is_active ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}>
                      {selectedIssueSilo.is_active ? 'Active Silo' : 'Inactive Silo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Physical Stock</span>
                      <span className="text-base font-black text-[#1E3A8A]">{selectedIssueSilo.current_stock_liters.toLocaleString()} L</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">After-Issue Stock Preview</span>
                      <span className={`text-base font-black ${isOverIssue ? 'text-rose-600' : 'text-emerald-800'}`}>
                        {previewRemaining.toLocaleString()} L
                      </span>
                    </div>
                  </div>

                  {/* Form Inputs */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                        Issue Quantity (Liters) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={issueQuantityLiters}
                        onChange={(e) => setIssueQuantityLiters(e.target.value)}
                        placeholder="e.g. 5000"
                        className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                          Purpose / Destination
                        </label>
                        <input
                          type="text"
                          value={issuePurpose}
                          onChange={(e) => setIssuePurpose(e.target.value)}
                          placeholder="e.g. UHT Milk, Pasteurized Milk"
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                          Flow Meter Reference
                        </label>
                        <input
                          type="text"
                          value={issueFlowMeterRef}
                          onChange={(e) => setIssueFlowMeterRef(e.target.value)}
                          placeholder="e.g. FM-004"
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                        Operational Timestamp <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={issueOpTimestamp}
                        max={toDatetimeLocalInput(new Date())}
                        onChange={(e) => setIssueOpTimestamp(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="button"
                    disabled={actionLoading || !issueQuantityLiters || isOverIssue}
                    onClick={handleRecordSiloIssue}
                    className="w-full min-h-[44px] py-3.5 px-4 bg-[#1E3A8A] hover:bg-blue-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? <span>Recording Issue...</span> : <> <MinusCircle className="w-4 h-4" /> <span>Record Silo Issue</span> </>}
                  </button>
                </div>

                {/* Compact Recent Issues Card */}
                <div className="p-5 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-3 text-[#111311]">
                  <div className="flex items-center justify-between border-b border-[#C4B9A3] pb-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#111311]">
                      Recent Issues — {selectedIssueSilo.silo_code}
                    </h4>
                    <span className="text-[11px] text-slate-500 font-mono font-bold">Last 10 Records</span>
                  </div>

                  {historyLoading ? (
                    <div className="p-4 text-center text-xs text-slate-500 font-mono font-bold">Loading issue history...</div>
                  ) : issueHistory.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 font-bold">No recent milk issues recorded for this silo.</div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {issueHistory.map((h) => (
                        <div key={h.id} className="p-3 bg-[#F4EFE3] rounded-xl border border-[#C4B9A3] flex items-center justify-between text-xs">
                          <div>
                            <span className="font-extrabold text-[#111311] block">{h.purpose}</span>
                            <span className="text-[11px] text-slate-500 font-mono font-bold">
                              {h.time_formatted} | {h.operator_name} {h.flow_meter_reference ? `| ${h.flow_meter_reference}` : ''}
                            </span>
                          </div>
                          <span className="font-mono font-black text-rose-700 text-sm">
                            -{h.quantity_liters.toLocaleString()} L
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
