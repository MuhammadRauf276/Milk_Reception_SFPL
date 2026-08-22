'use client';

import React, { useState, useEffect } from 'react';
import { ShieldCheck, KeyRound, CheckCircle2, Truck, Clock, ShieldAlert, Search, Radio, LogOut, ArrowRight } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';

interface DispatchedVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  operational_date: string | null;
  current_status: string;
  portion_count: number;
  total_declared_kg: number;
  dispatch_timestamp: string | null;
  zonal_contractor_name: string;
}

interface ActiveInPlantVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  entry_timestamp: string | null;
  portion_count: number;
  total_declared_kg: number;
  current_status: string;
  plant_decision_summary: string;
}

interface ReadyForExitVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  entry_timestamp: string | null;
  portion_count: number;
  current_status: string;
  exit_reason: string;
  is_all_rejected: boolean;
  gross_weight_kg: number | null;
  tare_weight_kg: number | null;
  net_weight_kg: number | null;
}

interface SecurityGatewayWorkspaceProps {
  logs?: any[];
  currentUser?: User | null;
  onIssueToken?: (logId: number, tokenNumber: string, igpDate: string, igpTime: string) => Promise<void>;
  onLogGateOut?: (logId: number, outTime: string) => Promise<void>;
}

export const SecurityGatewayWorkspace: React.FC<SecurityGatewayWorkspaceProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'WAITING_ENTRY' | 'INSIDE_PLANT' | 'READY_EXIT'>('WAITING_ENTRY');

  // Search Queries
  const [entrySearchQuery, setEntrySearchQuery] = useState('');
  const [exitSearchQuery, setExitSearchQuery] = useState('');

  // Data lists
  const [dispatchedVisits, setDispatchedVisits] = useState<DispatchedVisit[]>([]);
  const [activeVisits, setActiveVisits] = useState<ActiveInPlantVisit[]>([]);
  const [readyExitVisits, setReadyExitVisits] = useState<ReadyForExitVisit[]>([]);

  // Selected visit for Entry or Exit panel
  const [selectedEntryVisitId, setSelectedEntryVisitId] = useState<string | null>(null);
  const [selectedExitVisitId, setSelectedExitVisitId] = useState<string | null>(null);

  // Entry & Exit Form state
  const [tokenNumber, setTokenNumber] = useState(`TK-${Math.floor(1000 + Math.random() * 9000)}`);
  const [entryOpTimestamp, setEntryOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));
  const [exitOpTimestamp, setExitOpTimestamp] = useState<string>(toDatetimeLocalInput(new Date()));

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const fetchSecurityData = async () => {
    setIsLoading(true);
    setMsg(null);
    try {
      const [dispRes, actRes, exitRes] = await Promise.all([
        fetch(`/api/security/dispatched-visits?q=${encodeURIComponent(entrySearchQuery)}`),
        fetch('/api/security/active-visits'),
        fetch(`/api/security/ready-for-exit?q=${encodeURIComponent(exitSearchQuery)}`),
      ]);

      const dispData = await dispRes.json();
      const actData = await actRes.json();
      const exitData = await exitRes.json();

      if (dispData.visits) {
        setDispatchedVisits(dispData.visits);
        if (dispData.visits.length > 0 && !selectedEntryVisitId) {
          setSelectedEntryVisitId(dispData.visits[0].id);
        }
      }
      if (actData.visits) {
        setActiveVisits(actData.visits);
      }
      if (exitData.visits) {
        setReadyExitVisits(exitData.visits);
        if (exitData.visits.length > 0 && !selectedExitVisitId) {
          setSelectedExitVisitId(exitData.visits[0].id);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch security data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEntrySearch = (val: string) => {
    setEntrySearchQuery(val);
    fetch(`/api/security/dispatched-visits?q=${encodeURIComponent(val)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.visits) setDispatchedVisits(data.visits);
      });
  };

  const handleExitSearch = (val: string) => {
    setExitSearchQuery(val);
    fetch(`/api/security/ready-for-exit?q=${encodeURIComponent(val)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.visits) setReadyExitVisits(data.visits);
      });
  };

  const selectedEntryVisit = dispatchedVisits.find((v) => v.id === selectedEntryVisitId) || dispatchedVisits[0] || null;
  const selectedExitVisit = readyExitVisits.find((v) => v.id === selectedExitVisitId) || readyExitVisits[0] || null;

  const toast = useToast();

  const handleConfirmEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntryVisit) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch('/api/security/gate-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: selectedEntryVisit.id,
          tokenNumber: tokenNumber.trim().toUpperCase(),
          entryTimestamp: datetimeLocalToIso(entryOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record gate entry');

      const successMsgText = `Gate Entry recorded. Token ${data.visit?.token_number || tokenNumber} issued successfully.`;
      toast.showSuccess(successMsgText, 'Gate Entry Recorded');
      setTokenNumber(`TK-${Math.floor(1000 + Math.random() * 9000)}`);
      setSelectedEntryVisitId(null);
      fetchSecurityData();
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
      toast.showError(err.message || 'Failed to record gate entry', 'Gate Entry Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmExit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExitVisit) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch('/api/security/gate-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: selectedExitVisit.id,
          exitTimestamp: datetimeLocalToIso(exitOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record gate exit');

      const successMsgText = `Gate Exit completed successfully for vehicle ${selectedExitVisit.vehicle_number}.`;
      toast.showSuccess(successMsgText, 'Gate Exit Completed');
      setSelectedExitVisitId(null);
      setExitOpTimestamp('');
      fetchSecurityData();
    } catch (err: any) {
      setMsg({ text: err.message, isError: true });
      toast.showError(err.message || 'Failed to record gate exit', 'Gate Exit Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatFriendlyStage = (status: string) => {
    switch (status) {
      case 'TOKEN_ISSUED':
      case 'PLANT_QA':
        return 'Plant QA';
      case 'READY_FOR_GROSS':
        return 'Ready for First Weight';
      case 'GROSS_WEIGHED':
      case 'READY_FOR_UNLOADING':
      case 'UNLOADING':
        return 'Unloading';
      case 'READY_FOR_TARE':
      case 'TARE_WEIGHED':
        return 'Ready for Second Weight';
      case 'READY_FOR_GATE_EXIT':
        return 'Ready for Gate Exit';
      default:
        return status;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-[#111311]">
      {/* Page-Level Three Tabs Navigation */}
      <div className="flex items-center justify-between p-1.5 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm">
        <div className="flex items-center space-x-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('WAITING_ENTRY')}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${
              activeTab === 'WAITING_ENTRY'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Waiting for Entry</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'WAITING_ENTRY' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {dispatchedVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('INSIDE_PLANT')}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${
              activeTab === 'INSIDE_PLANT'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Inside Plant</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'INSIDE_PLANT' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {activeVisits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('READY_EXIT')}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 ${
              activeTab === 'READY_EXIT'
                ? 'bg-[#1E3A8A] text-white shadow-sm'
                : 'text-[#334155] hover:bg-amber-100/50'
            }`}
          >
            <LogOut className="w-4 h-4" />
            <span>Ready for Exit</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'READY_EXIT' ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-slate-700'}`}>
              {readyExitVisits.length}
            </span>
          </button>
        </div>

        <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200">
          <Radio className="w-3 h-3 animate-pulse text-emerald-600" />
          <span>Live</span>
        </div>
      </div>

      {/* TAB 1: WAITING FOR ENTRY */}
      {activeTab === 'WAITING_ENTRY' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT (5/12): WAITING FOR ENTRY QUEUE */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-extrabold text-[#111311]">Waiting for Entry</h3>
              <span className="text-xs font-mono font-bold text-slate-500">{dispatchedVisits.length} vehicles</span>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={entrySearchQuery}
                onChange={(e) => handleEntrySearch(e.target.value)}
                placeholder="Search vehicle number..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
              />
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {dispatchedVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No vehicles currently waiting for entry.
                </div>
              ) : (
                dispatchedVisits.map((v) => {
                  const isSelected = selectedEntryVisit?.id === v.id;
                  return (
                    <div
                      key={`waiting-entry-${String(v.id)}`}
                      onClick={() => setSelectedEntryVisitId(v.id)}
                      className={`p-3.5 rounded-xl border transition cursor-pointer space-y-1 ${
                        isSelected
                          ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                          : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-black font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'}`}>
                          Waiting for Gate Entry
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-[11px] font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                        <span>Portions: {v.portion_count} ({v.total_declared_kg.toLocaleString()} KG)</span>
                        <span>{v.zonal_contractor_name}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT (7/12): GATE ENTRY PANEL */}
          <div className="lg:col-span-7">
            {!selectedEntryVisit ? (
              <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                Select a waiting vehicle from the queue to process gate entry.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                <div className="pb-3 border-b border-[#C4B9A3]">
                  <h3 className="text-base font-extrabold text-[#111311]">Gate Entry</h3>
                  <p className="text-xs text-[#334155] font-semibold mt-0.5">
                    Vehicle: <strong className="font-mono text-[#111311]">{selectedEntryVisit.vehicle_number}</strong> | Contractor: <strong className="font-mono text-[#1E3A8A]">{selectedEntryVisit.zonal_contractor_name}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Declared Volume</span>
                    <span>{selectedEntryVisit.total_declared_kg.toLocaleString()} KG ({selectedEntryVisit.portion_count} Portion{selectedEntryVisit.portion_count > 1 ? 's' : ''})</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Operational Date</span>
                    <span>{selectedEntryVisit.operational_date || 'Today'}</span>
                  </div>
                </div>

                <form onSubmit={handleConfirmEntry} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold mb-1.5 text-[#111311]">
                      Assign Security Token # *
                    </label>
                    <input
                      type="text"
                      value={tokenNumber}
                      onChange={(e) => setTokenNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. TK-9025"
                      className="w-full px-4 py-2.5 text-sm font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold mb-1 text-[#111311] flex items-center justify-between">
                      <span>Gate Entry Time *</span>
                      <Clock className="w-3.5 h-3.5 text-[#1E3A8A]" />
                    </label>
                    <input
                      type="datetime-local"
                      value={entryOpTimestamp}
                      min={toDatetimeLocalInput(selectedEntryVisit.dispatch_timestamp)}
                      max={toDatetimeLocalInput(new Date())}
                      onChange={(e) => setEntryOpTimestamp(e.target.value)}
                      className="w-full px-4 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-800 text-white font-extrabold text-sm shadow-md transition disabled:opacity-50 mt-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>{isSubmitting ? 'Confirming Entry...' : 'Confirm Entry'}</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: INSIDE PLANT */}
      {activeTab === 'INSIDE_PLANT' && (
        <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#C4B9A3]">
            <h3 className="text-sm font-extrabold text-[#111311]">
              Inside Plant ({activeVisits.length} Vehicles)
            </h3>
            <span className="text-xs font-mono font-bold text-slate-500">
              Physically inside gate
            </span>
          </div>

          {activeVisits.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-xl bg-[#F4EFE3] text-xs font-bold text-slate-500">
              No vehicles currently inside the plant.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-medium">
                <thead className="bg-[#F4EFE3] text-slate-700 font-extrabold uppercase text-[10px] tracking-wider border-b border-[#C4B9A3]">
                  <tr>
                    <th className="py-3 px-4">Token #</th>
                    <th className="py-3 px-4">Vehicle #</th>
                    <th className="py-3 px-4">Entry Time</th>
                    <th className="py-3 px-4">Portions</th>
                    <th className="py-3 px-4">Current Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C4B9A3] text-[#111311]">
                  {activeVisits.map((v) => (
                    <tr key={`inside-${String(v.id)}`} className="hover:bg-[#F4EFE3]/80 transition">
                      <td className="py-3 px-4 font-mono font-black text-[#1E3A8A]">
                        {v.token_number || '-'}
                      </td>
                      <td className="py-3 px-4 font-bold text-[#111311]">
                        {v.vehicle_number}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {v.entry_timestamp ? new Date(v.entry_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {v.portion_count} ({v.total_declared_kg.toLocaleString()} KG)
                      </td>
                      <td className="py-3 px-4 font-bold">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-mono bg-blue-100 text-[#1E3A8A] border border-blue-300">
                          {formatFriendlyStage(v.current_status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: READY FOR EXIT */}
      {activeTab === 'READY_EXIT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT (5/12): READY FOR EXIT QUEUE */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-extrabold text-[#111311]">Ready for Exit</h3>
              <span className="text-xs font-mono font-bold text-slate-500">{readyExitVisits.length} ready</span>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={exitSearchQuery}
                onChange={(e) => handleExitSearch(e.target.value)}
                placeholder="Search token or vehicle number..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
              />
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {readyExitVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                  No vehicles currently waiting for gate exit.
                </div>
              ) : (
                readyExitVisits.map((v) => {
                  const isSelected = selectedExitVisit?.id === v.id;
                  return (
                    <div
                      key={`ready-exit-${String(v.id)}`}
                      onClick={() => setSelectedExitVisitId(v.id)}
                      className={`p-3.5 rounded-xl border transition cursor-pointer space-y-1 ${
                        isSelected
                          ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                          : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                          <span className="font-mono text-xs font-bold text-blue-200">({v.token_number})</span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[9.5px] font-extrabold ${
                            v.is_all_rejected ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {v.exit_reason}
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-[11px] font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                        <span>Portions: {v.portion_count}</span>
                        <span>Net: {v.net_weight_kg ? `${v.net_weight_kg.toLocaleString()} KG` : '—'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT (7/12): PROCESS EXIT PANEL */}
          <div className="lg:col-span-7">
            {!selectedExitVisit ? (
              <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                Select a ready vehicle from the left queue to process gate exit.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
                <div className="pb-3 border-b border-[#C4B9A3]">
                  <h3 className="text-base font-extrabold text-[#111311]">Gate Exit</h3>
                  <p className="text-xs text-[#334155] font-semibold mt-0.5">
                    Vehicle: <strong className="font-mono text-[#111311]">{selectedExitVisit.vehicle_number}</strong> | Token: <strong className="font-mono text-[#1E40AF]">{selectedExitVisit.token_number}</strong> | Entry: <strong className="font-mono text-[#1E3A8A]">{selectedExitVisit.entry_timestamp ? new Date(selectedExitVisit.entry_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Exit Reason</span>
                    <span className={selectedExitVisit.is_all_rejected ? 'text-rose-700' : 'text-emerald-700'}>
                      {selectedExitVisit.exit_reason}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 font-sans block text-[9px]">Net Milk Received</span>
                    <span>{selectedExitVisit.net_weight_kg ? `${selectedExitVisit.net_weight_kg.toLocaleString()} KG` : '—'}</span>
                  </div>
                </div>

                {!selectedExitVisit.is_all_rejected && (
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9px]">Gross Weight</span>
                      <span>{selectedExitVisit.gross_weight_kg ? `${selectedExitVisit.gross_weight_kg.toLocaleString()} KG` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9px]">Second Weight</span>
                      <span>{selectedExitVisit.tare_weight_kg ? `${selectedExitVisit.tare_weight_kg.toLocaleString()} KG` : '—'}</span>
                    </div>
                  </div>
                )}

                {selectedExitVisit.is_all_rejected && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                    ⚠️ QA Result: Rejected. All portions failed laboratory testing. Direct return exit authorised without weighment.
                  </div>
                )}

                <form onSubmit={handleConfirmExit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-[#111311] flex items-center justify-between">
                      <span>Gate Exit Time <span className="text-rose-600">*</span></span>
                      <Clock className="w-3.5 h-3.5 text-[#1E3A8A]" />
                    </label>
                    <input
                      type="datetime-local"
                      value={exitOpTimestamp}
                      max={toDatetimeLocalInput(new Date())}
                      onChange={(e) => setExitOpTimestamp(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-sm shadow-md transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>{isSubmitting ? 'Confirming Exit...' : 'Confirm Exit'}</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
