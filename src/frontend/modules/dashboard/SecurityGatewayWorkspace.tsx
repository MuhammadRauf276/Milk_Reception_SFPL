'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Truck, Clock, Search, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { PageHeader } from '@/components/ui/page-header';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';

interface DispatchedVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  operational_date: string | null;
  current_status: string;
  portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
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
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
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

export type SecurityTab = 'WAITING_ENTRY' | 'INSIDE_PLANT' | 'READY_EXIT';

interface SecurityGatewayWorkspaceProps {
  currentUser?: User | null;
  activeTab?: SecurityTab;
  onTabChange?: (tab: SecurityTab) => void;
  onIssueToken?: (logId: number, tokenNumber: string, igpDate: string, igpTime: string) => Promise<void>;
  onLogGateOut?: (logId: number, outTime: string) => Promise<void>;
}

/** Suggested gate token for the next entry; the guard can overwrite it. */
function suggestTokenNumber() {
  return `TK-${Math.floor(1000 + Math.random() * 9000)}`;
}

export const SecurityGatewayWorkspace: React.FC<SecurityGatewayWorkspaceProps> = ({
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<SecurityTab>('WAITING_ENTRY');
  const activeTab = controlledTab || internalTab;

  const setActiveTab = (tab: SecurityTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

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
  const [tokenNumber, setTokenNumber] = useState(suggestTokenNumber);
  const [entryOpTimestamp, setEntryOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [exitOpTimestamp, setExitOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const loadSecurityData = useCallback(
    (entryQuery: string, exitQuery: string) =>
      Promise.all([
        fetch(`/api/security/dispatched-visits?q=${encodeURIComponent(entryQuery)}`),
        fetch('/api/security/active-visits'),
        fetch(`/api/security/ready-for-exit?q=${encodeURIComponent(exitQuery)}`),
      ])
        .then(async ([dispRes, actRes, exitRes]) => {
          const dispData = await dispRes.json();
          const actData = await actRes.json();
          const exitData = await exitRes.json();

          if (dispData.visits) {
            setDispatchedVisits(dispData.visits);
            if (dispData.visits.length > 0) {
              setSelectedEntryVisitId((current) => current ?? dispData.visits[0].id);
            }
          }
          if (actData.visits) {
            setActiveVisits(actData.visits);
          }
          if (exitData.visits) {
            setReadyExitVisits(exitData.visits);
            if (exitData.visits.length > 0) {
              setSelectedExitVisitId((current) => current ?? exitData.visits[0].id);
            }
          }
        })
        .catch((err) => {
          console.error('Failed to fetch security data', err);
        })
        .finally(() => {
          setIsLoading(false);
        }),
    []
  );

  const fetchSecurityData = () => {
    setIsLoading(true);
    setMsg(null);
    return loadSecurityData(entrySearchQuery, exitSearchQuery);
  };

  // Initial load (search boxes start empty).
  useEffect(() => {
    loadSecurityData('', '');
  }, [loadSecurityData]);

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
      setTokenNumber(suggestTokenNumber());
      setSelectedEntryVisitId(null);
      fetchSecurityData();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
      toast.showError(getErrorMessage(err) || 'Failed to record gate entry', 'Gate Entry Error');
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
      setExitOpTimestamp(toDatetimeLocalInput(new Date()));
      fetchSecurityData();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
      toast.showError(getErrorMessage(err) || 'Failed to record gate exit', 'Gate Exit Error');
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
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title="Gate entry & exit"
        description="Log vehicle gate entry, security checks and gate exit passes."
      />

      {activeTab === 'WAITING_ENTRY' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Waiting for Entry</h3>
              <span className="text-xs tabular-nums font-semibold text-slate-500">{dispatchedVisits.length} vehicles</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={entrySearchQuery}
                onChange={(e) => handleEntrySearch(e.target.value)}
                placeholder="Search vehicle number…"
                className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {isLoading ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  Loading vehicles…
                </div>
              ) : dispatchedVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles currently waiting for entry.
                </div>
              ) : (
                dispatchedVisits.map((v) => {
                  const isSelected = selectedEntryVisit?.id === v.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`waiting-entry-${String(v.id)}`}
                      onClick={() => setSelectedEntryVisitId(v.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-muted text-foreground border border-border-strong`}>
                          Waiting Entry
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-semibold text-slate-700`}>
                        <span>
                          {v.portion_count} Portion{v.portion_count > 1 ? 's' : ''} ({formatDispatchQuantity(v.vehicle_dispatch_quantity_value, v.vehicle_dispatch_quantity_unit)})
                        </span>
                        <span className="truncate max-w-[150px]">{v.zonal_contractor_name}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            {!selectedEntryVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a waiting vehicle from the queue to process gate entry.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <h3 className="text-base font-semibold text-foreground">Gate Entry Processing</h3>
                  <p className="text-xs text-slate-700 font-semibold mt-0.5">
                    Vehicle: <strong className="tabular-nums text-foreground">{selectedEntryVisit.vehicle_number}</strong> | Contractor: <strong className="text-primary">{selectedEntryVisit.zonal_contractor_name}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Declared Volume</span>
                    <span>{formatDispatchQuantity(selectedEntryVisit.vehicle_dispatch_quantity_value, selectedEntryVisit.vehicle_dispatch_quantity_unit)} ({selectedEntryVisit.portion_count} Portion{selectedEntryVisit.portion_count > 1 ? 's' : ''})</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Operational Date</span>
                    <span>{selectedEntryVisit.operational_date || 'Today'}</span>
                  </div>
                </div>

                <form onSubmit={handleConfirmEntry} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      Assign Security Token # *
                    </label>
                    <input
                      type="text"
                      value={tokenNumber}
                      onChange={(e) => setTokenNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. TK-9025"
                      className="w-full min-h-[44px] px-4 py-2.5 text-sm tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Gate Entry Time *</span>
                      <Clock className="w-3.5 h-3.5 text-primary" />
                    </label>
                    <input
                      type="datetime-local"
                      value={entryOpTimestamp}
                      min={selectedEntryVisit.dispatch_timestamp ? toDatetimeLocalInput(selectedEntryVisit.dispatch_timestamp) : undefined}
                      max={toDatetimeLocalInput(new Date())}
                      onChange={(e) => setEntryOpTimestamp(e.target.value)}
                      className="w-full min-h-[44px] px-4 py-2.5 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full min-h-[44px] flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-md transition disabled:opacity-50 mt-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>{isSubmitting ? 'Confirming Entry…' : 'Confirm Gate Entry'}</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'INSIDE_PLANT' && (
        <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-4 animate-panel-in">
          <div className="flex items-center justify-between pb-2 border-b border-border-strong">
            <h3 className="text-sm font-semibold text-foreground">
              Vehicles Inside Plant ({activeVisits.length})
            </h3>
          </div>

          {activeVisits.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
              No vehicles currently inside the plant.
            </div>
          ) : (
            <div className="overflow-x-auto max-w-full">
              <table className="w-full text-left text-xs font-medium min-w-[600px]">
                <thead className="bg-muted text-slate-700 font-semibold uppercase text-[10px] tracking-wider border-b border-border-strong">
                  <tr>
                    <th className="py-3 px-4">Token #</th>
                    <th className="py-3 px-4">Vehicle #</th>
                    <th className="py-3 px-4">Entry Time</th>
                    <th className="py-3 px-4">Portions</th>
                    <th className="py-3 px-4">Current Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-strong text-foreground">
                  {activeVisits.map((v) => (
                    <tr key={`inside-${String(v.id)}`} className="hover:bg-muted/80 transition">
                      <td className="py-3 px-4 tabular-nums font-semibold text-primary">
                        {v.token_number || '-'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-foreground">
                        {v.vehicle_number}
                      </td>
                      <td className="py-3 px-4 tabular-nums text-slate-600">
                        {v.entry_timestamp ? new Date(v.entry_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-3 px-4 tabular-nums">
                        {v.portion_count} ({formatDispatchQuantity(v.vehicle_dispatch_quantity_value, v.vehicle_dispatch_quantity_unit)})
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums bg-blue-100 text-primary border border-blue-300">
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

      {activeTab === 'READY_EXIT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Ready for Exit</h3>
              <span className="text-xs tabular-nums font-semibold text-slate-500">{readyExitVisits.length} ready</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={exitSearchQuery}
                onChange={(e) => handleExitSearch(e.target.value)}
                placeholder="Search token or vehicle number…"
                className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {readyExitVisits.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                  No vehicles currently waiting for gate exit.
                </div>
              ) : (
                readyExitVisits.map((v) => {
                  const isSelected = selectedExitVisit?.id === v.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`ready-exit-${String(v.id)}`}
                      onClick={() => setSelectedExitVisitId(v.id)}
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
                            ({v.token_number || 'NO-TOKEN'})
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            v.is_all_rejected ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {v.exit_reason}
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-semibold text-slate-700`}>
                        <span>Portions: {v.portion_count}</span>
                        <span>Net: {v.net_weight_kg ? `${v.net_weight_kg.toLocaleString()} KG` : '—'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            {!selectedExitVisit ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a ready vehicle from the left queue to process gate exit.
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-card border border-border shadow-xs space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <h3 className="text-base font-semibold text-foreground">Gate Exit Clearance</h3>
                  <p className="text-xs text-slate-700 font-semibold mt-0.5">
                    Vehicle: <strong className="tabular-nums text-foreground">{selectedExitVisit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary-hover">{selectedExitVisit.token_number || 'NO-TOKEN'}</strong> | Entry: <strong className="tabular-nums text-primary">{selectedExitVisit.entry_timestamp ? new Date(selectedExitVisit.entry_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Exit Reason</span>
                    <span className={selectedExitVisit.is_all_rejected ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {selectedExitVisit.exit_reason}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 font-sans block text-[10px]">Net Milk Received</span>
                    <span>{selectedExitVisit.net_weight_kg ? `${selectedExitVisit.net_weight_kg.toLocaleString()} KG` : '—'}</span>
                  </div>
                </div>

                {!selectedExitVisit.is_all_rejected && (
                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-subtle border border-border text-xs tabular-nums font-semibold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[10px]">Gross Weight</span>
                      <span>{selectedExitVisit.gross_weight_kg ? `${selectedExitVisit.gross_weight_kg.toLocaleString()} KG` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[10px]">Second (Tare) Weight</span>
                      <span>{selectedExitVisit.tare_weight_kg ? `${selectedExitVisit.tare_weight_kg.toLocaleString()} KG` : '—'}</span>
                    </div>
                  </div>
                )}

                {selectedExitVisit.is_all_rejected && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center space-x-2">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                    <p>QA Result: Rejected. All portions failed laboratory testing. Direct return exit authorized without weighment.</p>
                  </div>
                )}

                <form onSubmit={handleConfirmExit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Gate Exit Time <span className="text-rose-600">*</span></span>
                      <Clock className="w-3.5 h-3.5 text-primary" />
                    </label>
                    <input
                      type="datetime-local"
                      value={exitOpTimestamp}
                      max={toDatetimeLocalInput(new Date())}
                      onChange={(e) => setExitOpTimestamp(e.target.value)}
                      className="w-full min-h-[44px] px-4 py-2.5 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full min-h-[44px] flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-md transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>{isSubmitting ? 'Confirming Exit…' : 'Confirm Gate Exit Clearance'}</span>
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
