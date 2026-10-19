'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Clock, Play, CheckCheck, MinusCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';
import { PageHeader } from '@/components/ui/page-header';
import { onActivateKey } from '@/lib/a11y';

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

export type ProductionTab = 'READY' | 'UNLOADING' | 'SILO_ISSUE';

interface ProductionUnloadingWorkspaceProps {
  currentUser?: User | null;
  activeTab?: ProductionTab;
  onTabChange?: (tab: ProductionTab) => void;
}

/** Idempotency key for one silo-issue submission. */
function newClientRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const ProductionUnloadingWorkspace: React.FC<ProductionUnloadingWorkspaceProps> = ({
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<ProductionTab>('READY');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: ProductionTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
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
  const [issueOpTimestamp, setIssueOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [issueHistory, setIssueHistory] = useState<SiloIssueHistoryDef[]>([]);
  // Silo whose issue-history request last settled; a different silo means it is still loading.
  const [historyLoadedSiloId, setHistoryLoadedSiloId] = useState<string | null>(null);

  // Input states for Unloading
  const [portionSiloMap, setPortionSiloMap] = useState<Record<string, string>>({}); // portionId -> siloId
  const [startOpTimestamp, setStartOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [completeOpTimestamp, setCompleteOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));

  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [_errorMsg, setErrorMsg] = useState<string | null>(null);
  const [_successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch Ready Queue & Silo Data
  const fetchReadyData = useCallback(
    (query: string, isCancelledFlag = { current: false }) =>
      fetch(`/api/production/ready-for-unloading?search=${encodeURIComponent(query)}`)
        .then(async (res) => {
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

            // Auto-selection repair for Silo Issue queue
            setSelectedIssueSiloId((prev) => {
              if (prev && fetchedSilos.some((s) => s.id === prev)) {
                return prev;
              }
              const eligible = fetchedSilos.filter((s) => s.current_stock_liters > 0);
              return eligible.length > 0 ? eligible[0].id : fetchedSilos.length > 0 ? fetchedSilos[0].id : null;
            });
          }
        })
        .catch(() => {
          // Handled silently
        })
        .finally(() => {
          // Only the first load shows the loading state; polling refreshes in place.
          if (!isCancelledFlag.current) setIsLoading(false);
        }),
    []
  );

  // Fetch Unloading Active Queue
  const fetchUnloadingData = useCallback(
    (query: string, isCancelledFlag = { current: false }) =>
      fetch(`/api/production/unloading-queue?search=${encodeURIComponent(query)}`)
        .then(async (res) => {
          const data = await res.json();

          if (isCancelledFlag.current) return;

          if (res.ok) {
            const fetchedVisits: UnloadingVisitDef[] = data.visits || [];
            setUnloadingVisits(fetchedVisits);
            setSelectedUnloadingVisitId((prev) => {
              if (prev && fetchedVisits.some((v) => v.id === prev)) {
                return prev;
              }
              return fetchedVisits.length > 0 ? fetchedVisits[0].id : null;
            });
          }
        })
        .catch(() => {
          // Handled silently
        }),
    []
  );

  // Fetch Silo Issue History
  const fetchIssueHistory = useCallback(
    (siloId: string) =>
      fetch(`/api/production/silo-issue/history?siloId=${siloId}`)
        .then(async (res) => {
          const data = await res.json();
          if (res.ok) {
            setIssueHistory(data.history || []);
          }
        })
        .catch(() => {
          // Handled silently
        })
        .finally(() => {
          setHistoryLoadedSiloId(siloId);
        }),
    []
  );

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
  }, [searchQuery, fetchReadyData, fetchUnloadingData]);

  // Load history when issue silo selection changes
  const showIssueHistory = Boolean(selectedIssueSiloId) && activeTab === 'SILO_ISSUE';
  const historyLoading = showIssueHistory && historyLoadedSiloId !== selectedIssueSiloId;
  useEffect(() => {
    if (showIssueHistory && selectedIssueSiloId) {
      fetchIssueHistory(selectedIssueSiloId);
    }
  }, [showIssueHistory, selectedIssueSiloId, fetchIssueHistory]);

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

  // Auto-populate default silo mapping when the selected ready visit or silo list changes,
  // keeping any silo the operator already chose for a portion.
  const [siloMapSource, setSiloMapSource] = useState<{ visitId: string | null; silos: SiloOption[] }>({
    visitId: null,
    silos: [],
  });
  if (
    selectedReadyVisit &&
    activeSilos.length > 0 &&
    (siloMapSource.visitId !== selectedReadyVisitId || siloMapSource.silos !== activeSilos)
  ) {
    setSiloMapSource({ visitId: selectedReadyVisitId, silos: activeSilos });
    const newMap: Record<string, string> = {};
    const acceptedPortions = selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
    const activeOnlySilos = activeSilos.filter((s) => s.is_active);
    acceptedPortions.forEach((p, idx) => {
      const targetSilo = activeOnlySilos[idx % activeOnlySilos.length] || activeSilos[0];
      newMap[p.id] = portionSiloMap[p.id] || targetSilo?.id || '';
    });
    setPortionSiloMap(newMap);
  }

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
        fetchReadyData(searchQuery);
        fetchUnloadingData(searchQuery);
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
        fetchReadyData(searchQuery);
        fetchUnloadingData(searchQuery);
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
      const clientRequestId = newClientRequestId();
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
        fetchReadyData(searchQuery);
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
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      {/* Top Header & Tab Navigation */}
      <PageHeader
        title="Production & silo unloading"
        description="Assign unloading bays, record silo receipts and issue stock."
      />

      {/* Workspace Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Queue List / Silo List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-foreground">
              {activeTab === 'READY' ? 'Ready Queue' : activeTab === 'UNLOADING' ? 'In Unloading Queue' : 'Active Silos'}
            </h3>
            <span className="text-xs tabular-nums font-semibold text-slate-500">
              {activeTab === 'READY' ? `${readyVisits.length} ready` : activeTab === 'UNLOADING' ? `${unloadingVisits.length} unloading` : `${siloIssueList.length} silos`}
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={activeTab === 'SILO_ISSUE' ? 'Search silo code or name…' : 'Search vehicle or token…'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
            />
          </div>

          <div key={activeTab} className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1 stagger-children">
            {isLoading ? (
              <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading production queue…
              </div>
            ) : activeTab === 'READY' ? (
              readyVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles currently ready for unloading.
                </div>
              ) : (
                readyVisits.map((v) => {
                  const isSelected = v.id === selectedReadyVisitId;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={v.id}
                      onClick={() => setSelectedReadyVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                          {v.token_number && (
                            <span className={`tabular-nums text-xs font-semibold text-primary`}>
                              ({v.token_number})
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] tabular-nums font-semibold flex items-center space-x-1 text-slate-500`}>
                          <Clock className="w-3 h-3" />
                          <span>{v.waiting_minutes}m wait</span>
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg tabular-nums font-semibold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-muted text-slate-700 border border-border-strong'
                      }`}>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Gross Weight</span>
                          <span>{v.gross_weight_kg ? `${v.gross_weight_kg.toLocaleString()} kg` : '—'}</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Expected Volume</span>
                          <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : activeTab === 'UNLOADING' ? (
              unloadingVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles are currently unloading.
                </div>
              ) : (
                unloadingVisits.map((v) => {
                  const isSelected = v.id === selectedUnloadingVisitId;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={v.id}
                      onClick={() => setSelectedUnloadingVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-blue-100 text-primary border border-blue-300`}>
                            Unloading Active
                          </span>
                        </div>
                        <span className={`text-[10px] tabular-nums font-semibold flex items-center space-x-1 text-amber-800`}>
                          <Clock className="w-3 h-3" />
                          <span>{v.elapsed_minutes}m</span>
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg tabular-nums font-semibold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-muted text-slate-700 border border-border-strong'
                      }`}>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Unloading Volume</span>
                          <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : '—'}</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Started By</span>
                          <span className="truncate block">{v.started_by_name}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              siloIssueList.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No silos match query or have stock available.
                </div>
              ) : (
                siloIssueList.map((silo) => {
                  const isSelected = silo.id === selectedIssueSiloId;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={silo.id}
                      onClick={() => setSelectedIssueSiloId(silo.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="tabular-nums font-semibold text-sm">{silo.silo_code}</span>
                          <span className={`text-xs font-semibold text-slate-700`}>
                            ({silo.silo_name})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                          silo.is_active
                            ? isSelected ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : isSelected ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {silo.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      <div className={`grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg tabular-nums font-semibold ${
                        isSelected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-muted text-slate-700 border border-border-strong'
                      }`}>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Physical Stock</span>
                          <span className="text-sm font-semibold">{silo.current_stock_liters.toLocaleString()} L</span>
                        </div>
                        <div>
                          <span className="font-sans block text-[10px] opacity-75">Capacity</span>
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
        <div key={activeTab} className="lg:col-span-7 animate-panel-in">
          {activeTab === 'READY' && (
            !selectedReadyVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a vehicle from the ready queue to assign silos and start unloading.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-6 text-foreground">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-strong pb-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Start Silo Unloading</h3>
                    <p className="text-xs text-slate-700 font-semibold mt-0.5">
                      Vehicle: <strong className="tabular-nums text-foreground">{selectedReadyVisit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary">{selectedReadyVisit.token_number || 'NO-TOKEN'}</strong>
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums font-semibold bg-blue-100 text-primary border border-blue-300 self-start sm:self-auto">
                    Ready for Unloading
                  </span>
                </div>

                {/* Portion Assignment Table */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-foreground">
                    Accepted Portions & Destination Silos
                  </h4>
                  {selectedReadyVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-subtle rounded-xl border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums font-semibold text-sm text-foreground">
                          Portion #{p.portion_number} ({p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? p.dispatch_quantity_value.toLocaleString() : '—'} {p.dispatch_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-xs tabular-nums font-semibold text-primary bg-white px-2 py-0.5 rounded border border-border-strong">
                          Expected: {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-foreground">
                          Destination Silo <span className="text-rose-600">*</span>
                        </label>
                        <select
                          value={portionSiloMap[p.id] || ''}
                          onChange={(e) => setPortionSiloMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select target silo</option>
                          {activeSilos.filter((s) => s.is_active).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.silo_code} · {s.silo_name} · {s.provisional_available_liters.toLocaleString()} L free
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Operational Timestamp */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Unloading Start Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={startOpTimestamp}
                    min={selectedReadyVisit.gross_timestamp ? toDatetimeLocalInput(selectedReadyVisit.gross_timestamp) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setStartOpTimestamp(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStartUnloading}
                  className="w-full min-h-[44px] py-3.5 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                >
                  {actionLoading ? <span>Starting Unloading…</span> : <> <Play className="w-4 h-4" /> <span>Start Silo Unloading</span> </>}
                </button>
              </div>
            )
          )}

          {activeTab === 'UNLOADING' && (
            !selectedUnloadingVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a vehicle from the unloading in-progress queue to record completion.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-6 text-foreground">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-strong pb-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Complete Silo Unloading</h3>
                    <p className="text-xs text-slate-700 font-semibold mt-0.5">
                      Vehicle: <strong className="tabular-nums text-foreground">{selectedUnloadingVisit.vehicle_number}</strong> | Started by: <strong className="text-primary">{selectedUnloadingVisit.started_by_name}</strong>
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums font-semibold bg-blue-100 text-primary border border-blue-300 self-start sm:self-auto">
                    Unloading Active
                  </span>
                </div>

                {/* Portion Silo Assignments Read-Only */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-foreground">
                    Assigned Silo Allocation
                  </h4>
                  {selectedUnloadingVisit.portions.filter((p) => p.plant_decision === 'ACCEPTED').map((p) => (
                    <div key={p.id} className="p-4 bg-subtle rounded-xl border border-border flex items-center justify-between text-xs tabular-nums font-semibold">
                      <div>
                        <span className="font-semibold text-foreground block">
                          Portion #{p.portion_number} ({p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? p.dispatch_quantity_value.toLocaleString() : '—'} {p.dispatch_quantity_unit === 'LITER' ? 'L' : 'kg'})
                        </span>
                        <span className="text-slate-600 font-sans text-[11px]">
                          Destination: <strong className="text-primary">{p.unloading_log?.silo_code || p.unloading_log?.silo_number || 'Silo 1'}</strong>
                        </span>
                      </div>
                      <span className="text-emerald-800 text-sm font-semibold">
                        {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Operational Timestamp */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Unloading Completion Time <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={completeOpTimestamp}
                    min={selectedUnloadingVisit.started_at ? toDatetimeLocalInput(selectedUnloadingVisit.started_at) : undefined}
                    max={toDatetimeLocalInput(new Date())}
                    onChange={(e) => setCompleteOpTimestamp(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleCompleteUnloading}
                  className="w-full min-h-[44px] py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                >
                  {actionLoading ? <span>Completing Unloading…</span> : <> <CheckCheck className="w-4 h-4" /> <span>Confirm Unloading Completion</span> </>}
                </button>
              </div>
            )
          )}

          {activeTab === 'SILO_ISSUE' && (
            !selectedIssueSilo ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a silo from the list to record outbound milk issue.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-6 text-foreground">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-strong pb-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Record Outbound Milk Issue</h3>
                      <p className="text-xs text-slate-700 font-semibold mt-0.5">
                        Silo: <strong className="tabular-nums text-foreground">{selectedIssueSilo.silo_code}</strong> ({selectedIssueSilo.silo_name})
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums font-semibold ${
                      selectedIssueSilo.is_active ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}>
                      {selectedIssueSilo.is_active ? 'Active Silo' : 'Inactive Silo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[10px]">Physical Stock</span>
                      <span className="text-base font-semibold text-primary">{selectedIssueSilo.current_stock_liters.toLocaleString()} L</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[10px]">After-Issue Stock Preview</span>
                      <span className={`text-base font-semibold ${isOverIssue ? 'text-rose-600' : 'text-emerald-800'}`}>
                        {previewRemaining.toLocaleString()} L
                      </span>
                    </div>
                  </div>

                  {/* Form Inputs */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        Issue Quantity (Liters) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={issueQuantityLiters}
                        onChange={(e) => setIssueQuantityLiters(e.target.value)}
                        placeholder="e.g. 5000"
                        className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-foreground">
                          Purpose / Destination
                        </label>
                        <input
                          type="text"
                          value={issuePurpose}
                          onChange={(e) => setIssuePurpose(e.target.value)}
                          placeholder="e.g. UHT Milk, Pasteurized Milk"
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-foreground">
                          Flow Meter Reference
                        </label>
                        <input
                          type="text"
                          value={issueFlowMeterRef}
                          onChange={(e) => setIssueFlowMeterRef(e.target.value)}
                          placeholder="e.g. FM-004"
                          className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        Operational Timestamp <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={issueOpTimestamp}
                        max={toDatetimeLocalInput(new Date())}
                        onChange={(e) => setIssueOpTimestamp(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="button"
                    disabled={actionLoading || !issueQuantityLiters || isOverIssue}
                    onClick={handleRecordSiloIssue}
                    className="w-full min-h-[44px] py-3.5 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? <span>Recording Issue…</span> : <> <MinusCircle className="w-4 h-4" /> <span>Record Silo Issue</span> </>}
                  </button>
                </div>

                {/* Compact Recent Issues Card */}
                <div className="p-5 rounded-xl bg-card border border-border shadow-xs space-y-3 text-foreground">
                  <div className="flex items-center justify-between border-b border-border-strong pb-2">
                    <h4 className="text-xs font-semibold text-foreground">
                      Recent Issues: {selectedIssueSilo.silo_code}
                    </h4>
                    <span className="text-[11px] text-slate-500 tabular-nums font-semibold">Last 10 Records</span>
                  </div>

                  {historyLoading ? (
                    <div className="p-4 text-center text-xs text-slate-500 tabular-nums font-semibold">Loading issue history…</div>
                  ) : issueHistory.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 font-semibold">No recent milk issues recorded for this silo.</div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {issueHistory.map((h) => (
                        <div key={h.id} className="p-3 bg-subtle rounded-xl border border-border flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-foreground block">{h.purpose}</span>
                            <span className="text-[11px] text-slate-500 tabular-nums font-semibold">
                              {h.time_formatted} | {h.operator_name} {h.flow_meter_reference ? `| ${h.flow_meter_reference}` : ''}
                            </span>
                          </div>
                          <span className="tabular-nums font-semibold text-rose-700 text-sm">
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
