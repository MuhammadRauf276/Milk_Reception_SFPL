import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { User } from '@core/types';
import { Search, CheckCircle2, Clock, Loader2 } from 'lucide-react';

import { formatAcceptedQuantitySummary } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

export type WeighbridgeTab = 'FIRST_WEIGHT' | 'SECOND_WEIGHT';

interface WeighbridgeWorkspaceProps {
  currentUser?: User | null;
  activeTab?: WeighbridgeTab;
  onTabChange?: (tab: WeighbridgeTab) => void;
}

interface FirstWeightPortion {
  id: string;
  portion_number: number;
  dispatch_quantity_value: number | null;
  dispatch_quantity_unit: string | null;
  dispatch_quantity_basis: string | null;
  plant_decision: string;
  plant_rejection_reason: string | null;
}

interface FirstWeightVisit {
  id: string;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string;
  current_status: string;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_quantity_basis?: string | null;
  portions?: FirstWeightPortion[];
  waiting_minutes: number;
  plant_decision_summary: string;
  min_allowed_timestamp: string;
}

function formatAcceptedQuantity(v: FirstWeightVisit): string {
  return formatAcceptedQuantitySummary(
    v.portions,
    v.vehicle_dispatch_quantity_value,
    v.vehicle_dispatch_quantity_unit
  );
}

interface SecondWeightVisit {
  id: string;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string;
  current_status: string;
  portion_count: number;
  ticket_number: string | null;
  gross_weight_kg: number;
  gross_timestamp: string | null;
  gross_recorded_by_name: string;
  waiting_minutes: number;
  min_allowed_timestamp: string;
  destination_silo_text?: string;
  is_multi_silo_different?: boolean;
}

import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { PageHeader } from '@/components/ui/page-header';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';

// Helper to format Date instance or string into "YYYY-MM-DDTHH:mm" for datetime-local input
function toLocalDatetimeInput(dateInput?: Date | string | number | null): string {
  return toDatetimeLocalInput(dateInput);
}

// Human-readable duration formatter
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export const WeighbridgeWorkspace: React.FC<WeighbridgeWorkspaceProps> = ({
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<WeighbridgeTab>('FIRST_WEIGHT');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: WeighbridgeTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
  
  // Queues
  const [firstWeightVisits, setFirstWeightVisits] = useState<FirstWeightVisit[]>([]);
  const [secondWeightVisits, setSecondWeightVisits] = useState<SecondWeightVisit[]>([]);
  
  // Tab-Scoped Selections
  const [selectedFirstVisitId, setSelectedFirstVisitId] = useState<string | null>(null);
  const [selectedSecondVisitId, setSelectedSecondVisitId] = useState<string | null>(null);

  // Search Queries
  const [firstSearchQuery, setFirstSearchQuery] = useState('');
  const [secondSearchQuery, setSecondSearchQuery] = useState('');

  // Form Inputs
  const [grossInputKg, setGrossInputKg] = useState<string>('');
  const [grossDateTimeInput, setGrossDateTimeInput] = useState<string>(toLocalDatetimeInput(new Date()));

  const [tareInputKg, setTareInputKg] = useState<string>('');
  const [tareDateTimeInput, setTareDateTimeInput] = useState<string>(toLocalDatetimeInput(new Date()));

  // Loading & Error States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch First Weight Queue with Auto-Selection & Stale Repair
  const fetchFirstWeightQueue = useCallback(
    (query: string = '') =>
      fetch(`/api/scale/ready-for-gross?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const visits: FirstWeightVisit[] = data.visits || [];
            setFirstWeightVisits(visits);
            
            // Auto-selection & Stale queue repair rule
            if (visits.length > 0) {
              setSelectedFirstVisitId((currentId) => {
                if (!currentId || !visits.some((v) => v.id === currentId)) {
                  return visits[0].id;
                }
                return currentId;
              });
            } else {
              setSelectedFirstVisitId(null);
              setGrossInputKg('');
            }
          }
        })
        .catch(() => {
          // Handled silently
        }),
    []
  );

  // Fetch Second Weight Queue with Auto-Selection & Stale Repair
  const fetchSecondWeightQueue = useCallback(
    (query: string = '') =>
      fetch(`/api/scale/ready-for-tare?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const visits: SecondWeightVisit[] = data.visits || [];
            setSecondWeightVisits(visits);

            // Auto-selection & Stale queue repair rule
            if (visits.length > 0) {
              setSelectedSecondVisitId((currentId) => {
                if (!currentId || !visits.some((v) => v.id === currentId)) {
                  return visits[0].id;
                }
                return currentId;
              });
            } else {
              setSelectedSecondVisitId(null);
              setTareInputKg('');
            }
          }
        })
        .catch(() => {
          // Handled silently
        }),
    []
  );

  // Refresh both queues
  const refreshAllQueues = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([
      fetchFirstWeightQueue(firstSearchQuery),
      fetchSecondWeightQueue(secondSearchQuery),
    ]);
    setIsLoading(false);
  }, [fetchFirstWeightQueue, fetchSecondWeightQueue, firstSearchQuery, secondSearchQuery]);

  // Initial fetch and 5s periodic polling
  useEffect(() => {
    Promise.all([
      fetchFirstWeightQueue(firstSearchQuery),
      fetchSecondWeightQueue(secondSearchQuery),
    ]).finally(() => setIsLoading(false));
    const interval = setInterval(() => {
      fetchFirstWeightQueue(firstSearchQuery);
      fetchSecondWeightQueue(secondSearchQuery);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchFirstWeightQueue, fetchSecondWeightQueue, firstSearchQuery, secondSearchQuery]);

  // Selected visit objects
  const selectedFirstVisit = firstWeightVisits.find((v) => v.id === selectedFirstVisitId) || null;
  const selectedSecondVisit = secondWeightVisits.find((v) => v.id === selectedSecondVisitId) || null;

  const toast = useToast();

  // Handle Record First Weight (Gross)
  const handleRecordFirstWeight = async () => {
    if (!selectedFirstVisit) return;
    const grossVal = Number(grossInputKg);
    if (isNaN(grossVal) || grossVal <= 0) {
      const errText = 'Please enter a valid first weight greater than 0 kg.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Invalid First Weight');
      return;
    }

    if (!grossDateTimeInput) {
      const errText = 'Please select a valid operational date & time for the first weight.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Missing Timestamp');
      return;
    }

    const isoGrossTs = datetimeLocalToIso(grossDateTimeInput);
    if (!isoGrossTs) {
      const errText = 'Please select a valid operational date & time for the first weight.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Invalid Timestamp');
      return;
    }

    const selectedOpDate = new Date(isoGrossTs);
    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      const errText = 'First weight operational timestamp cannot be in the future.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Timestamp Error');
      return;
    }

    if (selectedFirstVisit.min_allowed_timestamp) {
      const minAllowed = new Date(selectedFirstVisit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        const errText = `First weight timestamp cannot be earlier than QA approval (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`;
        setStatusMsg({ type: 'error', text: errText });
        toast.showError(errText, 'Chronology Error');
        return;
      }
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/scale/gross-weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: selectedFirstVisit.id,
          grossWeightKg: grossVal,
          grossTimestamp: isoGrossTs,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record first weight');
      }

      toast.showSuccess(
        `First weight (${grossVal.toLocaleString()} kg) recorded for vehicle ${selectedFirstVisit.vehicle_number}. Vehicle ready for unloading!`,
        'First Weight Recorded'
      );
      setGrossInputKg('');
      await refreshAllQueues();
    } catch (err) {
      setStatusMsg({ type: 'error', text: getErrorMessage(err) || 'Failed to record first weight.' });
      toast.showError(getErrorMessage(err) || 'Failed to record first weight', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Record Second Weight (Tare)
  const handleRecordSecondWeight = async () => {
    if (!selectedSecondVisit) return;
    const tareVal = Number(tareInputKg);
    if (isNaN(tareVal) || tareVal <= 0) {
      const errText = 'Please enter a valid second weight greater than 0 kg.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Invalid Second Weight');
      return;
    }

    if (tareVal >= selectedSecondVisit.gross_weight_kg) {
      const errText = `Second weight (${tareVal.toLocaleString()} kg) must be strictly less than First weight (${selectedSecondVisit.gross_weight_kg.toLocaleString()} kg).`;
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Weight Hierarchy Error');
      return;
    }

    if (!tareDateTimeInput) {
      const errText = 'Please select a valid operational date & time for the second weight.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Missing Timestamp');
      return;
    }

    const isoTareTs = datetimeLocalToIso(tareDateTimeInput);
    if (!isoTareTs) {
      const errText = 'Please select a valid operational date & time for the second weight.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Invalid Timestamp');
      return;
    }

    const selectedOpDate = new Date(isoTareTs);
    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      const errText = 'Second weight operational timestamp cannot be in the future.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Timestamp Error');
      return;
    }

    if (selectedSecondVisit.min_allowed_timestamp) {
      const minAllowed = new Date(selectedSecondVisit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        const errText = `Second weight timestamp cannot be earlier than First weight or unloading completion (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`;
        setStatusMsg({ type: 'error', text: errText });
        toast.showError(errText, 'Chronology Error');
        return;
      }
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/scale/tare-weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: selectedSecondVisit.id,
          tareWeightKg: tareVal,
          tareTimestamp: isoTareTs,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record second weight');
      }

      if (data.pendingInventoryReceipt) {
        const warnText = 'Second weight recorded. Plant LR missing. Silo Receipt pending.';
        toast.showWarning(warnText, 'Silo Receipt Pending');
      } else {
        const successText = `Second weight (${tareVal.toLocaleString()} kg) recorded & Final Silo Receipt posted!`;
        toast.showSuccess(successText, 'Silo Receipt Finalized');
      }

      setTareInputKg('');
      await refreshAllQueues();
    } catch (err) {
      setStatusMsg({ type: 'error', text: getErrorMessage(err) || 'Failed to record second weight.' });
      toast.showError(getErrorMessage(err) || 'Failed to record second weight', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview Net Weight calculation
  const currentTareVal = Number(tareInputKg);
  const previewNetKg = selectedSecondVisit && !isNaN(currentTareVal) && currentTareVal > 0 && currentTareVal < selectedSecondVisit.gross_weight_kg
    ? selectedSecondVisit.gross_weight_kg - currentTareVal
    : null;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title="Weighbridge"
        description="Record first (loaded) and second (empty) weighments."
      />

      {activeTab === 'FIRST_WEIGHT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Ready for First Weight</h3>
              <span className="text-xs tabular-nums font-semibold text-slate-500">
                {firstWeightVisits.length} vehicle{firstWeightVisits.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={firstSearchQuery}
                onChange={(e) => {
                  setFirstSearchQuery(e.target.value);
                  fetchFirstWeightQueue(e.target.value);
                }}
                placeholder="Search vehicle or token…"
                className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {isLoading ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                  Loading weighbridge queue…
                </div>
              ) : firstWeightVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles currently waiting for first weight.
                </div>
              ) : (
                firstWeightVisits.map((v) => {
                  const isSelected = selectedFirstVisitId === v.id;
                  const portionSummaryStr = v.portion_count > 1
                    ? `${v.portion_count} Portions · ${v.accepted_portion_count} Accepted`
                    : `${v.accepted_portion_count} Accepted Portion`;

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`first-weight-${v.id}`}
                      onClick={() => {
                        setSelectedFirstVisitId(v.id);
                        setGrossInputKg('');
                        setStatusMsg(null);
                      }}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                          <span className={`tabular-nums text-xs font-semibold text-primary`}>
                            ({v.token_number || 'No Token'})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-emerald-100 text-emerald-800 border border-emerald-300`}>
                          QA Approved
                        </span>
                      </div>

                      <div className={`text-xs font-semibold text-slate-700`}>
                        <div>{portionSummaryStr}</div>
                        <div className="text-[11px] tabular-nums mt-0.5">Accepted Qty: {formatAcceptedQuantity(v)}</div>
                      </div>

                      <div className={`flex items-center justify-between text-[11px] tabular-nums text-slate-600`}>
                        <span>Date: {v.operational_date}</span>
                        <span>Waiting: {formatDuration(v.waiting_minutes)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            {!selectedFirstVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a ready vehicle from the left queue to record first weight.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <h3 className="text-base font-semibold text-foreground">Record First Weight (Loaded Vehicle)</h3>
                  <p className="text-xs text-slate-700 font-semibold mt-0.5">
                    Vehicle: <strong className="tabular-nums text-foreground">{selectedFirstVisit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary">{selectedFirstVisit.token_number || 'NO-TOKEN'}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Operational Date</span>
                    <span>{selectedFirstVisit.operational_date}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Portions Context</span>
                    <span>{selectedFirstVisit.portion_count} Portions ({selectedFirstVisit.accepted_portion_count} Accepted)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Accepted Quantity</span>
                    <span className="text-primary">{formatAcceptedQuantity(selectedFirstVisit)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Waiting Time</span>
                    <span className="text-amber-800">{formatDuration(selectedFirstVisit.waiting_minutes)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      First Weight (Loaded) (kg) <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="1"
                        value={grossInputKg}
                        onChange={(e) => setGrossInputKg(e.target.value)}
                        placeholder="e.g. 32500"
                        className="w-full min-h-[48px] px-4 py-3 text-lg tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground shadow-inner focus:outline-hidden focus:ring-2 focus:ring-primary"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 tabular-nums font-semibold text-slate-400 text-sm">
                        kg
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>First Weighment Time <span className="text-rose-600">*</span></span>
                      <Clock className="w-3.5 h-3.5 text-primary" />
                    </label>
                    <input
                      type="datetime-local"
                      value={grossDateTimeInput}
                      min={selectedFirstVisit.min_allowed_timestamp ? toLocalDatetimeInput(selectedFirstVisit.min_allowed_timestamp) : undefined}
                      max={toLocalDatetimeInput(new Date())}
                      onChange={(e) => setGrossDateTimeInput(e.target.value)}
                      className="w-full min-h-[48px] px-3.5 py-3 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting || !grossInputKg}
                  onClick={handleRecordFirstWeight}
                  className="w-full min-h-[44px] py-3.5 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition shadow-md flex items-center justify-center space-x-2"
                >
                  {isSubmitting ? (
                    <span>Recording First Weight…</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Record First Weight</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'SECOND_WEIGHT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Ready for Second Weight</h3>
              <span className="text-xs tabular-nums font-semibold text-slate-500">
                {secondWeightVisits.length} vehicle{secondWeightVisits.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={secondSearchQuery}
                onChange={(e) => {
                  setSecondSearchQuery(e.target.value);
                  fetchSecondWeightQueue(e.target.value);
                }}
                placeholder="Search vehicle or token…"
                className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {isLoading ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                  Loading weighbridge queue…
                </div>
              ) : secondWeightVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles currently waiting for second weight.
                </div>
              ) : (
                secondWeightVisits.map((v) => {
                  const isSelected = selectedSecondVisitId === v.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`second-weight-${v.id}`}
                      onClick={() => {
                        setSelectedSecondVisitId(v.id);
                        setTareInputKg('');
                        setStatusMsg(null);
                      }}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                          <span className={`tabular-nums text-xs font-semibold text-primary`}>
                            ({v.token_number || 'No Token'})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-blue-100 text-primary border border-blue-300`}>
                          Unloading Completed
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-semibold text-slate-700`}>
                        <span>First Weight: {v.gross_weight_kg.toLocaleString()} kg</span>
                        <span>Date: {v.operational_date}</span>
                      </div>

                      <div className={`text-[11px] tabular-nums text-slate-600`}>
                        Waiting for second weight
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            {!selectedSecondVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a vehicle from the left queue to record second weight.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <h3 className="text-base font-semibold text-foreground">Record Second Weight (After Unloading)</h3>
                  <p className="text-xs text-slate-700 font-semibold mt-0.5">
                    Vehicle: <strong className="tabular-nums text-foreground">{selectedSecondVisit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary">{selectedSecondVisit.token_number || 'NO-TOKEN'}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">First Weight (Loaded Vehicle)</span>
                    <span className="text-base text-primary font-semibold">{selectedSecondVisit.gross_weight_kg.toLocaleString()} kg</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">First Weight Time</span>
                    <span>{selectedSecondVisit.gross_timestamp ? new Date(selectedSecondVisit.gross_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Recorded By</span>
                    <span>{selectedSecondVisit.gross_recorded_by_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Operational Date</span>
                    <span>{selectedSecondVisit.operational_date}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      Second Weight (Empty) (kg) <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="1"
                        value={tareInputKg}
                        onChange={(e) => setTareInputKg(e.target.value)}
                        placeholder="e.g. 12200"
                        className="w-full min-h-[48px] px-4 py-3 text-lg tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground shadow-inner focus:outline-hidden focus:ring-2 focus:ring-primary"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 tabular-nums font-semibold text-slate-400 text-sm">
                        kg
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Second Weighment Time <span className="text-rose-600">*</span></span>
                      <Clock className="w-3.5 h-3.5 text-primary" />
                    </label>
                    <input
                      type="datetime-local"
                      value={tareDateTimeInput}
                      min={selectedSecondVisit.min_allowed_timestamp ? toLocalDatetimeInput(selectedSecondVisit.min_allowed_timestamp) : undefined}
                      max={toLocalDatetimeInput(new Date())}
                      onChange={(e) => setTareDateTimeInput(e.target.value)}
                      className="w-full min-h-[48px] px-3.5 py-3 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {previewNetKg !== null && (
                  <div className="space-y-2 pt-1">
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between text-emerald-900 tabular-nums font-semibold text-xs">
                      <span>Net Milk Weight:</span>
                      <span className="text-base font-semibold text-emerald-800">{previewNetKg.toLocaleString()} kg</span>
                    </div>

                    {selectedSecondVisit.destination_silo_text && (
                      <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs tabular-nums font-semibold flex items-center justify-between text-blue-950">
                        <span className="font-sans text-[11px] text-slate-600">Destination Silo:</span>
                        <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-900 font-semibold text-[10px]">
                          {selectedSecondVisit.is_multi_silo_different ? 'Multi-Silo Allocation Required' : `Silo: ${selectedSecondVisit.destination_silo_text}`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSubmitting || !tareInputKg}
                  onClick={handleRecordSecondWeight}
                  className="w-full min-h-[44px] py-3.5 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition shadow-md flex items-center justify-center space-x-2"
                >
                  {isSubmitting ? (
                    <span>Recording Second Weight…</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Record Second Weight</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
