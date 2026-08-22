import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { User } from '@core/types';
import { Search, Scale, RefreshCw, CheckCircle2, Clock } from 'lucide-react';

interface WeighbridgeWorkspaceProps {
  currentUser?: User | null;
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
  accepted_declared_kg: number;
  waiting_minutes: number;
  plant_decision_summary: string;
  min_allowed_timestamp: string;
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

export const WeighbridgeWorkspace: React.FC<WeighbridgeWorkspaceProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'FIRST_WEIGHT' | 'SECOND_WEIGHT'>('FIRST_WEIGHT');
  
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
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch First Weight Queue with Auto-Selection & Stale Repair
  const fetchFirstWeightQueue = useCallback(async (query: string = '') => {
    try {
      const res = await fetch(`/api/scale/ready-for-gross?q=${encodeURIComponent(query)}`);
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
    } catch (_err) {
      // Handled silently
    }
  }, []);

  // Fetch Second Weight Queue with Auto-Selection & Stale Repair
  const fetchSecondWeightQueue = useCallback(async (query: string = '') => {
    try {
      const res = await fetch(`/api/scale/ready-for-tare?q=${encodeURIComponent(query)}`);
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
    } catch (_err) {
      // Handled silently
    }
  }, []);

  const refreshAllQueues = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([
      fetchFirstWeightQueue(firstSearchQuery),
      fetchSecondWeightQueue(secondSearchQuery),
    ]);
    setIsLoading(false);
  }, [fetchFirstWeightQueue, fetchSecondWeightQueue, firstSearchQuery, secondSearchQuery]);

  useEffect(() => {
    refreshAllQueues();

    const interval = setInterval(() => {
      fetchFirstWeightQueue(firstSearchQuery);
      fetchSecondWeightQueue(secondSearchQuery);
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshAllQueues, fetchFirstWeightQueue, fetchSecondWeightQueue, firstSearchQuery, secondSearchQuery]);

  // Selected Visit Objects
  const selectedFirstVisit = firstWeightVisits.find((v) => v.id === selectedFirstVisitId) || null;
  const selectedSecondVisit = secondWeightVisits.find((v) => v.id === selectedSecondVisitId) || null;

  // Sync datetime-local inputs when selection changes
  useEffect(() => {
    if (selectedFirstVisit) {
      setGrossDateTimeInput(toLocalDatetimeInput(new Date()));
    }
  }, [selectedFirstVisitId]);

  useEffect(() => {
    if (selectedSecondVisit) {
      setTareDateTimeInput(toLocalDatetimeInput(new Date()));
    }
  }, [selectedSecondVisitId]);

  const toast = useToast();

  // Handle Record First Weight (Gross)
  const handleRecordFirstWeight = async () => {
    if (!selectedFirstVisit) return;
    const grossVal = Number(grossInputKg);
    if (isNaN(grossVal) || grossVal <= 0) {
      const errText = 'Please enter a valid gross weight greater than 0 kg.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Validation Error');
      return;
    }

    const isoGrossTs = datetimeLocalToIso(grossDateTimeInput);
    if (!isoGrossTs) {
      toast.showError('Please enter a valid operational date and time.', 'Validation Error');
      return;
    }
    const selectedOpDate = new Date(isoGrossTs);

    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      const errText = 'Gross weight operational timestamp cannot be in the future.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Timestamp Error');
      return;
    }

    if (selectedFirstVisit.min_allowed_timestamp) {
      const minAllowed = new Date(selectedFirstVisit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        const errText = `Gross timestamp cannot be earlier than previous workflow event (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`;
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
          grossTimestamp: selectedOpDate.toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record first weight');
      }

      const successText = data.message || `First weight (${grossVal.toLocaleString()} kg) recorded successfully!`;
      toast.showSuccess(successText, 'First Weight Recorded');
      setGrossInputKg('');
      await refreshAllQueues();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to record first weight.' });
      toast.showError(err.message || 'Failed to record first weight', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Record Second Weight (Tare)
  const handleRecordSecondWeight = async () => {
    if (!selectedSecondVisit) return;
    const tareVal = Number(tareInputKg);
    if (isNaN(tareVal) || tareVal <= 0) {
      const errText = 'Please enter a valid tare weight greater than 0 kg.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Validation Error');
      return;
    }

    if (tareVal >= selectedSecondVisit.gross_weight_kg) {
      const errText = `Tare weight (${tareVal.toLocaleString()} kg) must be less than Gross weight (${selectedSecondVisit.gross_weight_kg.toLocaleString()} kg).`;
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Validation Error');
      return;
    }

    const isoTareTs = datetimeLocalToIso(tareDateTimeInput);
    if (!isoTareTs) {
      toast.showError('Please enter a valid operational date and time.', 'Validation Error');
      return;
    }
    const selectedOpDate = new Date(isoTareTs);

    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      const errText = 'Tare weight operational timestamp cannot be in the future.';
      setStatusMsg({ type: 'error', text: errText });
      toast.showError(errText, 'Timestamp Error');
      return;
    }

    if (selectedSecondVisit.min_allowed_timestamp) {
      const minAllowed = new Date(selectedSecondVisit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        const errText = `Tare timestamp cannot be earlier than Gross weight or unloading completion (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`;
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
          tareTimestamp: selectedOpDate.toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record second weight');
      }

      if (data.pendingInventoryReceipt) {
        const warnText = 'Tare recorded. Plant LR missing — Silo Receipt pending.';
        toast.showWarning(warnText, 'Silo Receipt Pending');
      } else {
        const successText = `Second weight (${tareVal.toLocaleString()} kg) recorded & Final Silo Receipt posted!`;
        toast.showSuccess(successText, 'Silo Receipt Finalized');
      }

      setTareInputKg('');
      await refreshAllQueues();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to record second weight.' });
      toast.showError(err.message || 'Failed to record second weight', 'Weighbridge Error');
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
    <div className="space-y-6 font-sans">
      {/* Top Header & Page-Level Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[#1E3A8A] text-white rounded-xl shadow-sm">
              <Scale className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#111311]">Weighbridge</h1>
          </div>
          <p className="text-xs text-[#334155] font-semibold mt-1">
            Record first and second vehicle weights.
          </p>
        </div>

        {/* Page-Level Workspace Tabs & Subtle Live Status */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 border border-emerald-300 text-[11px] font-extrabold text-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>Live</span>
          </div>

          <div className="flex items-center space-x-1.5 p-1 bg-[#F4EFE3] rounded-xl border border-[#C4B9A3]">
            <button
              type="button"
              onClick={() => {
                setActiveTab('FIRST_WEIGHT');
                setStatusMsg(null);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-black transition flex items-center space-x-1.5 ${
                activeTab === 'FIRST_WEIGHT'
                  ? 'bg-[#1E3A8A] text-white shadow-sm'
                  : 'text-[#334155] hover:bg-amber-100/60'
              }`}
            >
              <span>First Weight</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                {firstWeightVisits.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('SECOND_WEIGHT');
                setStatusMsg(null);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-black transition flex items-center space-x-1.5 ${
                activeTab === 'SECOND_WEIGHT'
                  ? 'bg-[#1E3A8A] text-white shadow-sm'
                  : 'text-[#334155] hover:bg-amber-100/60'
              }`}
            >
              <span>Second Weight</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                {secondWeightVisits.length}
              </span>
            </button>
          </div>
        </div>
      </div>



      {/* TAB 1: FIRST WEIGHT (GROSS) */}
      {activeTab === 'FIRST_WEIGHT' && (
        firstWeightVisits.length === 0 && !isLoading ? (
          <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
            No vehicles are ready for first weight.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT (5/12): FIRST WEIGHT QUEUE */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-extrabold text-[#111311]">Ready for First Weight</h3>
                <span className="text-xs font-mono font-bold text-slate-500">
                  {firstWeightVisits.length} vehicle{firstWeightVisits.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={firstSearchQuery}
                  onChange={(e) => {
                    setFirstSearchQuery(e.target.value);
                    fetchFirstWeightQueue(e.target.value);
                  }}
                  placeholder="Search vehicle or token..."
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
                />
              </div>

              {/* Queue Cards */}
              <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                {isLoading ? (
                  <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                    Loading weighbridge queue...
                  </div>
                ) : (
                  firstWeightVisits.map((v) => {
                    const isSelected = selectedFirstVisitId === v.id;
                    const portionSummaryStr = v.portion_count > 1
                      ? `${v.portion_count} Portions • ${v.accepted_portion_count} Accepted`
                      : `${v.accepted_portion_count} Accepted Portion`;

                    return (
                      <div
                        key={`first-weight-${v.id}`}
                        onClick={() => {
                          setSelectedFirstVisitId(v.id);
                          setGrossInputKg('');
                          setStatusMsg(null);
                        }}
                        className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                          isSelected
                            ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                            : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                            <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                              ({v.token_number || 'No Token'})
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'}`}>
                            QA Approved
                          </span>
                        </div>

                        <div className={`text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                          <div>{portionSummaryStr}</div>
                          <div className="text-[11px] font-mono mt-0.5">Accepted Qty: {v.accepted_declared_kg.toLocaleString()} kg</div>
                        </div>

                        <div className={`flex items-center justify-between text-[11px] font-mono ${isSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                          <span>Date: {v.operational_date}</span>
                          <span>Waiting: {formatDuration(v.waiting_minutes)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT (7/12): FIRST WEIGHT RECORDING PANEL */}
            <div className="lg:col-span-7">
              {selectedFirstVisit && (
                <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                  <div className="pb-3 border-b border-[#C4B9A3]">
                    <h3 className="text-base font-extrabold text-[#111311]">Record First Weight (Gross)</h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedFirstVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E3A8A]">{selectedFirstVisit.token_number || 'NO-TOKEN'}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Operational Date</span>
                      <span>{selectedFirstVisit.operational_date}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Portions Context</span>
                      <span>{selectedFirstVisit.portion_count} Portions ({selectedFirstVisit.accepted_portion_count} Accepted)</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Accepted Volume</span>
                      <span className="text-[#1E3A8A]">{selectedFirstVisit.accepted_declared_kg.toLocaleString()} kg</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Waiting Time</span>
                      <span className="text-amber-800">{formatDuration(selectedFirstVisit.waiting_minutes)}</span>
                    </div>
                  </div>

                  {/* Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                        Gross Weight (kg) <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          value={grossInputKg}
                          onChange={(e) => setGrossInputKg(e.target.value)}
                          placeholder="e.g. 32500"
                          className="w-full px-4 py-3 text-lg font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm">
                          kg
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311] flex items-center justify-between">
                        <span>Gross Weighment Time <span className="text-rose-600">*</span></span>
                        <Clock className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      </label>
                      <input
                        type="datetime-local"
                        value={grossDateTimeInput}
                        min={selectedFirstVisit.min_allowed_timestamp ? toLocalDatetimeInput(selectedFirstVisit.min_allowed_timestamp) : undefined}
                        max={toLocalDatetimeInput(new Date())}
                        onChange={(e) => setGrossDateTimeInput(e.target.value)}
                        className="w-full px-3 py-3 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting || !grossInputKg}
                    onClick={handleRecordFirstWeight}
                    className="w-full py-3.5 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 disabled:opacity-50 text-white font-black text-sm transition shadow-md flex items-center justify-center space-x-2"
                  >
                    {isSubmitting ? (
                      <span>Recording First Weight...</span>
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
        )
      )}

      {/* TAB 2: SECOND WEIGHT (TARE) */}
      {activeTab === 'SECOND_WEIGHT' && (
        secondWeightVisits.length === 0 && !isLoading ? (
          <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
            No vehicles are ready for second weight.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT (5/12): SECOND WEIGHT QUEUE */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-extrabold text-[#111311]">Ready for Second Weight</h3>
                <span className="text-xs font-mono font-bold text-slate-500">
                  {secondWeightVisits.length} vehicle{secondWeightVisits.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={secondSearchQuery}
                  onChange={(e) => {
                    setSecondSearchQuery(e.target.value);
                    fetchSecondWeightQueue(e.target.value);
                  }}
                  placeholder="Search vehicle or token..."
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
                />
              </div>

              {/* Queue Cards */}
              <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                {isLoading ? (
                  <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                    Loading weighbridge queue...
                  </div>
                ) : (
                  secondWeightVisits.map((v) => {
                    const isSelected = selectedSecondVisitId === v.id;
                    return (
                      <div
                        key={`second-weight-${v.id}`}
                        onClick={() => {
                          setSelectedSecondVisitId(v.id);
                          setTareInputKg('');
                          setStatusMsg(null);
                        }}
                        className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                          isSelected
                            ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                            : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                            <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                              ({v.token_number || 'No Token'})
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-[#1E3A8A] border border-blue-300'}`}>
                            Unloading Completed
                          </span>
                        </div>

                        <div className={`flex items-center justify-between text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                          <span>Gross: {v.gross_weight_kg.toLocaleString()} kg</span>
                          <span>Date: {v.operational_date}</span>
                        </div>

                        <div className={`text-[11px] font-mono ${isSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                          Waiting for second weight
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT (7/12): SECOND WEIGHT RECORDING PANEL */}
            <div className="lg:col-span-7">
              {selectedSecondVisit && (
                <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                  <div className="pb-3 border-b border-[#C4B9A3]">
                    <h3 className="text-base font-extrabold text-[#111311]">Record Second Weight (Tare)</h3>
                    <p className="text-xs text-[#334155] font-semibold mt-0.5">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedSecondVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E3A8A]">{selectedSecondVisit.token_number || 'NO-TOKEN'}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Gross Weight (First Weight)</span>
                      <span className="text-lg text-[#1E3A8A] font-black">{selectedSecondVisit.gross_weight_kg.toLocaleString()} kg</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Gross Time</span>
                      <span>{selectedSecondVisit.gross_timestamp ? new Date(selectedSecondVisit.gross_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Recorded By (Gross)</span>
                      <span>{selectedSecondVisit.gross_recorded_by_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Operational Date</span>
                      <span>{selectedSecondVisit.operational_date}</span>
                    </div>
                  </div>

                  {/* Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311]">
                        Second Weight (kg) <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          value={tareInputKg}
                          onChange={(e) => setTareInputKg(e.target.value)}
                          placeholder="e.g. 12200"
                          className="w-full px-4 py-3 text-lg font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm">
                          kg
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-[#111311] flex items-center justify-between">
                        <span>Second Weighment Time <span className="text-rose-600">*</span></span>
                        <Clock className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      </label>
                      <input
                        type="datetime-local"
                        value={tareDateTimeInput}
                        min={selectedSecondVisit.min_allowed_timestamp ? toLocalDatetimeInput(selectedSecondVisit.min_allowed_timestamp) : undefined}
                        max={toLocalDatetimeInput(new Date())}
                        onChange={(e) => setTareDateTimeInput(e.target.value)}
                        className="w-full px-3 py-3 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  {/* Calculated Net Weight */}
                  {previewNetKg !== null && (
                    <div className="space-y-2 pt-1">
                      <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between text-emerald-900 font-mono font-bold text-xs">
                        <span>Net Milk Received:</span>
                        <span className="text-base font-black text-emerald-800">{previewNetKg.toLocaleString()} kg</span>
                      </div>

                      {selectedSecondVisit.destination_silo_text && (
                        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs font-mono font-bold flex items-center justify-between text-blue-950">
                          <span className="font-sans text-[11px] text-slate-600">Destination Silo:</span>
                          <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-900 font-extrabold text-[10px]">
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
                    className="w-full py-3.5 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 disabled:opacity-50 text-white font-black text-sm transition shadow-md flex items-center justify-center space-x-2"
                  >
                    {isSubmitting ? (
                      <span>Recording Second Weight...</span>
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
        )
      )}
    </div>
  );
};
