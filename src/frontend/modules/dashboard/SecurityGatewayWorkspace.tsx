'use client';

import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { apiClient } from '@/frontend/lib/apiClient';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { Clock, Search, ShieldAlert, ArrowLeft } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { User } from '@core/types';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { EmptyAction } from './components/EmptyAction';
import { DataTable } from '@/components/ui/data-table';
import { SkeletonList } from '@/components/ui/loaders';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import { formatTime } from '@/lib/format';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';
import { serverNow } from '@/lib/serverClock';

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
  currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<SecurityTab>('WAITING_ENTRY');
  const activeTab = controlledTab || internalTab;

  const handleTabChange = (tab: SecurityTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };


  // Search Queries
  const [entrySearchQuery, setEntrySearchQuery] = useState('');
  const [exitSearchQuery, setExitSearchQuery] = useState('');

  // Data lists

  // Selected visit for Entry or Exit panel
  const [selectedEntryVisitId, setSelectedEntryVisitId] = useState<string | null>(null);
  const [selectedExitVisitId, setSelectedExitVisitId] = useState<string | null>(null);
  const [tankerWashed, setTankerWashed] = useState<boolean | null>(null);

  // Entry & Exit Form state
  const [tokenNumber, setTokenNumber] = useState(suggestTokenNumber);
  const [entryOpTimestamp, setEntryOpTimestamp] = useState<string>(() => toDatetimeLocalInput(serverNow()));
  const [exitOpTimestamp, setExitOpTimestamp] = useState<string>(() => toDatetimeLocalInput(serverNow()));

  const [isSubmitting, setIsSubmitting] = useState(false);

  // What was typed stays on this device until the entry or exit is recorded.
  const entryDraft = useLocalFormDraft({
    formKey: selectedEntryVisitId ? `gate-entry:${selectedEntryVisitId}` : null,
    values: { token: tokenNumber, time: entryOpTimestamp },
    onRestore: (fields) => {
      if (fields.token !== undefined) setTokenNumber(fields.token);
      if (fields.time !== undefined) setEntryOpTimestamp(fields.time);
    },
  });
  const exitDraft = useLocalFormDraft({
    formKey: selectedExitVisitId ? `gate-exit:${selectedExitVisitId}` : null,
    values: { washed: tankerWashed === null ? '' : String(tankerWashed), time: exitOpTimestamp },
    onRestore: (fields) => {
      if (fields.washed === 'true' || fields.washed === 'false') setTankerWashed(fields.washed === 'true');
      if (fields.time !== undefined) setExitOpTimestamp(fields.time);
    },
  });
  const activeEntryOpIdRef = useRef<string | null>(null);
  const activeExitOpIdRef = useRef<string | null>(null);
  const [_msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // Keep operational timestamps current when selecting visits so idle screen stays don't submit stale times
  useEffect(() => {
    if (selectedEntryVisitId) {
      setEntryOpTimestamp(toDatetimeLocalInput(serverNow()));
    }
  }, [selectedEntryVisitId]);

  useEffect(() => {
    if (selectedExitVisitId) {
      setExitOpTimestamp(toDatetimeLocalInput(serverNow()));
    }
  }, [selectedExitVisitId]);

  const queryClient = useQueryClient();
  const debouncedEntry = useDebouncedValue(entrySearchQuery);
  const debouncedExit = useDebouncedValue(exitSearchQuery);

  const facilityId = currentUser?.procurement_source_id || currentUser?.procurement_source?.id || null;

  const dispatchedQuery = useQuery({
    queryKey: stationQueryKeys.security.queue(facilityId, 'dispatched', debouncedEntry),
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: DispatchedVisit[] }>(`/api/security/dispatched-visits?q=${encodeURIComponent(debouncedEntry)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: activeTab === 'WAITING_ENTRY',
    refetchInterval: activeTab === 'WAITING_ENTRY' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const activeQuery = useQuery({
    queryKey: stationQueryKeys.security.queue(facilityId, 'active'),
    queryFn: ({ signal }) => fetchJson<{ visits?: ActiveInPlantVisit[] }>('/api/security/active-visits', { signal }),
    enabled: activeTab === 'INSIDE_PLANT',
    refetchInterval: activeTab === 'INSIDE_PLANT' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const exitQuery = useQuery({
    queryKey: stationQueryKeys.security.queue(facilityId, 'exit', debouncedExit),
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: ReadyForExitVisit[] }>(`/api/security/ready-for-exit?q=${encodeURIComponent(debouncedExit)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: activeTab === 'READY_EXIT',
    refetchInterval: activeTab === 'READY_EXIT' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const dispatchedVisits = useMemo(() => dispatchedQuery.data?.visits ?? [], [dispatchedQuery.data]);
  const activeVisits = useMemo(() => activeQuery.data?.visits ?? [], [activeQuery.data]);
  const readyExitVisits = useMemo(() => exitQuery.data?.visits ?? [], [exitQuery.data]);
  const pagedEntryVisits = usePagedRows(dispatchedVisits, (v) => v.id);
  const pagedExitVisits = usePagedRows(readyExitVisits, (v) => v.id);
  const isLoading = (activeTab === 'WAITING_ENTRY' && dispatchedQuery.isPending) ||
    (activeTab === 'INSIDE_PLANT' && activeQuery.isPending) ||
    (activeTab === 'READY_EXIT' && exitQuery.isPending);

  const fetchSecurityData = () => {
    setMsg(null);
    return queryClient.invalidateQueries({ queryKey: stationQueryKeys.security.all(facilityId) });
  };

  const handleEntrySearch = (val: string) => setEntrySearchQuery(val);
  const handleExitSearch = (val: string) => setExitSearchQuery(val);

  const selectedEntryVisit = dispatchedVisits.find((v) => v.id === selectedEntryVisitId) || dispatchedVisits[0] || null;
  const selectedExitVisit = readyExitVisits.find((v) => v.id === selectedExitVisitId) || readyExitVisits[0] || null;

  const toast = useToast();

  const handleConfirmEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntryVisit) return;

    setIsSubmitting(true);
    setMsg(null);

    try {
      if (!activeEntryOpIdRef.current) {
        activeEntryOpIdRef.current = `gate-entry-${selectedEntryVisit.id}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const opId = activeEntryOpIdRef.current;

      const data = await apiClient.post<{ visit?: { token_number?: string } }>(
        '/api/security/gate-entry',
        {
          visitId: selectedEntryVisit.id,
          tokenNumber: tokenNumber.trim().toUpperCase(),
          entryTimestamp: datetimeLocalToIso(entryOpTimestamp) || undefined,
          clientOperationId: opId,
        },
        {
          dedupKey: `gate-entry-${selectedEntryVisit.id}`,
          idempotencyKey: opId,
        }
      );

      activeEntryOpIdRef.current = null;
      const successMsgText = `Entry recorded. Token ${data.visit?.token_number || tokenNumber}.`;
      entryDraft.clear();
      toast.showSuccess(successMsgText, 'Entry recorded');
      setTokenNumber(suggestTokenNumber());
      setSelectedEntryVisitId(null);
      fetchSecurityData();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
      toast.showError(getErrorMessage(err) || 'Could not record entry', 'Entry failed');
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
      if (!activeExitOpIdRef.current) {
        activeExitOpIdRef.current = `gate-exit-${selectedExitVisit.id}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const opId = activeExitOpIdRef.current;

      await apiClient.post(
        '/api/security/gate-exit',
        {
          visitId: selectedExitVisit.id,
          exitTimestamp: datetimeLocalToIso(exitOpTimestamp) || undefined,
          tanker_washed: selectedExitVisit.is_all_rejected ? false : tankerWashed,
          clientOperationId: opId,
        },
        {
          dedupKey: `gate-exit-${selectedExitVisit.id}`,
          idempotencyKey: opId,
        }
      );

      activeExitOpIdRef.current = null;
      const successMsgText = `Exit recorded for ${selectedExitVisit.vehicle_number}.`;
      exitDraft.clear();
      toast.showSuccess(successMsgText, 'Exit recorded');
      setSelectedExitVisitId(null);
      setTankerWashed(null);
      setExitOpTimestamp(toDatetimeLocalInput(serverNow()));
      fetchSecurityData();
    } catch (err) {
      setMsg({ text: getErrorMessage(err), isError: true });
      toast.showError(getErrorMessage(err) || 'Could not record exit', 'Exit failed');
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
        return 'Ready for Gross Weighment';
      case 'GROSS_WEIGHED':
      case 'READY_FOR_UNLOADING':
      case 'UNLOADING':
        return 'Unloading';
      case 'READY_FOR_TARE':
      case 'TARE_WEIGHED':
        return 'Ready for Tare Weighment';
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
      />


      {activeTab === 'WAITING_ENTRY' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Waiting for entry</h3>
              <span className="text-xs tabular-nums font-semibold text-muted-foreground">{dispatchedVisits.length} vehicles</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={entrySearchQuery}
                onChange={(e) => handleEntrySearch(e.target.value)}
                placeholder="Search vehicle…"
                className="w-full min-h-11 pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-130 overflow-y-auto pr-1">
              {isLoading ? (
                <SkeletonList count={3} />
              ) : dispatchedVisits.length === 0 ? (
                <EmptyAction message="No vehicles" onRefresh={() => queryClient.invalidateQueries()} />
              ) : (
                pagedEntryVisits.pageRows.map((v) => {
                  const isSelected = selectedEntryVisit?.id === v.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`waiting-entry-${String(v.id)}`}
                      onClick={() => setSelectedEntryVisitId(v.id)}
                      className={`p-4 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="font-mono tabular-nums font-semibold text-sm min-w-0">{v.vehicle_number}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-muted text-foreground border border-border-strong shrink-0`}>
                          Waiting entry
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-semibold text-muted-foreground gap-2 min-w-0`}>
                        <span className="shrink-0">
                          {v.portion_count} Portion{v.portion_count > 1 ? 's' : ''}
                        </span>
                        <span className="min-w-0 text-right">{v.zonal_contractor_name}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pagedEntryVisits.totalPages > 1 && (
              <Pagination
                page={pagedEntryVisits.page}
                totalPages={pagedEntryVisits.totalPages}
                totalRecords={pagedEntryVisits.totalRecords}
                pageSize={pagedEntryVisits.pageSize}
                noun="vehicles"
                onPageChange={pagedEntryVisits.setPage}
                className="bg-card rounded-xl border border-border p-2 text-xs"
              />
            )}
          </div>

          <div className="lg:col-span-7">
            {!selectedEntryVisit ? (
              dispatchedVisits.length === 0 ? null : <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a vehicle
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-card border border-border space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <div className="lg:hidden flex items-center justify-between pb-2 mb-2 border-b border-border">
                    <button
                      type="button"
                      onClick={() => setSelectedEntryVisitId(null)}
                      className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-primary hover:underline"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to vehicle queue
                    </button>
                    <span className="text-xs font-semibold text-muted-foreground">Vehicle selected</span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Entry</h3>
                  <p className="text-xs text-secondary-foreground font-semibold mt-0.5">
                    Vehicle: <strong className="font-mono tabular-nums text-foreground">{selectedEntryVisit.vehicle_number}</strong> | Contractor: <strong className="text-foreground">{selectedEntryVisit.zonal_contractor_name}</strong>
                  </p>
                </div>

                <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-muted-foreground font-sans block text-xs">Portions</span>
                    <span>{selectedEntryVisit.portion_count} Portion{selectedEntryVisit.portion_count > 1 ? 's' : ''}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-sans block text-xs">Date</span>
                    <span>{selectedEntryVisit.operational_date || 'Today'}</span>
                  </div>
                </div>

                <form onSubmit={handleConfirmEntry} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      Gate token *
                    </label>
                    <input
                      type="text"
                      value={tokenNumber}
                      onChange={(e) => setTokenNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. TK-9025"
                      className="w-full min-h-11 px-4 py-2 font-mono text-base sm:text-sm tabular-nums font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Entry time *</span>
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    </label>
                    <input
                      type="datetime-local"
                      value={entryOpTimestamp}
                      min={selectedEntryVisit.dispatch_timestamp ? toDatetimeLocalInput(selectedEntryVisit.dispatch_timestamp) : undefined}
                      max={toDatetimeLocalInput(serverNow())}
                      onChange={(e) => setEntryOpTimestamp(e.target.value)}
                      className="w-full min-h-11 px-4 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full min-h-11 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs transition-colors disabled:opacity-50 mt-2"
                  >
                    
                    <span>{isSubmitting ? 'Confirming entry…' : 'Confirm entry'}</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'INSIDE_PLANT' && (
        <div className="p-6 rounded-2xl bg-card border border-border space-y-4 animate-panel-in">
          <div className="flex items-center justify-between pb-2 border-b border-border-strong">
            <h3 className="text-sm font-semibold text-foreground">
              Vehicles inside plant ({activeVisits.length})
            </h3>
          </div>

          {activeVisits.length === 0 ? (
            <EmptyAction message="No vehicles" onRefresh={() => queryClient.invalidateQueries()} />
          ) : (
            <DataTable<ActiveInPlantVisit>
              rows={activeVisits}
              getRowId={(v) => String(v.id)}
              columns={[
                { key: 'token', header: 'Token', label: 'Token', cell: (v) => <span className="font-mono tabular-nums font-semibold">{v.token_number || '-'}</span> },
                { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', primary: true, cell: (v) => <span className="font-mono font-semibold text-foreground">{v.vehicle_number}</span> },
                { key: 'entry', header: 'Entry time', label: 'Entry time', cell: (v) => <span className="tabular-nums text-secondary-foreground">{formatTime(v.entry_timestamp)}</span> },
                { key: 'portions', header: 'Portions', label: 'Portions', cell: (v) => <span className="tabular-nums">{v.portion_count} ({formatDispatchQuantity(v.vehicle_dispatch_quantity_value, v.vehicle_dispatch_quantity_unit)})</span> },
                { key: 'stage', header: 'Current stage', label: 'Current stage', cell: (v) => (
                  <span className="px-3 py-1 rounded-md text-xs bg-muted text-foreground border border-border">
                    {formatFriendlyStage(v.current_status)}
                  </span>
                ) },
              ]}
            />
          )}
        </div>
      )}

      {activeTab === 'READY_EXIT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-panel-in">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">Ready for exit</h3>
              <span className="text-xs tabular-nums font-semibold text-muted-foreground">{readyExitVisits.length} ready</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={exitSearchQuery}
                onChange={(e) => handleExitSearch(e.target.value)}
                placeholder="Search token or vehicle number…"
                className="w-full min-h-11 pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <div className="space-y-2.5 max-h-130 overflow-y-auto pr-1">
              {readyExitVisits.length === 0 ? (
                <EmptyAction message="No vehicles" onRefresh={() => queryClient.invalidateQueries()} />
              ) : (
                pagedExitVisits.pageRows.map((v) => {
                  const isSelected = selectedExitVisit?.id === v.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={onActivateKey}
                      key={`ready-exit-${String(v.id)}`}
                      onClick={() => { setSelectedExitVisitId(v.id); setTankerWashed(null); }}
                      className={`p-4 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary'
                          : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 min-w-0">
                          <span className="font-mono tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                          <span className={`font-mono tabular-nums text-xs text-muted-foreground shrink-0`}>
                            ({v.token_number || 'NO-TOKEN'})
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${
                            v.is_all_rejected ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {v.exit_reason}
                        </span>
                      </div>

                      <div className={`flex items-center justify-between text-xs font-semibold text-secondary-foreground`}>
                        <span>Portions: {v.portion_count}</span>
                        <span className="font-mono tabular-nums">Net: {v.net_weight_kg ? `${v.net_weight_kg.toLocaleString()} kg` : '—'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pagedExitVisits.totalPages > 1 && (
              <Pagination
                page={pagedExitVisits.page}
                totalPages={pagedExitVisits.totalPages}
                totalRecords={pagedExitVisits.totalRecords}
                pageSize={pagedExitVisits.pageSize}
                noun="vehicles"
                onPageChange={pagedExitVisits.setPage}
                className="bg-card rounded-xl border border-border p-2 text-xs"
              />
            )}
          </div>

          <div className="lg:col-span-7">
            {!selectedExitVisit ? (
              readyExitVisits.length === 0 ? null : <div className="p-12 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground">
                Select a vehicle
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-card border border-border space-y-5 text-foreground">
                <div className="pb-3 border-b border-border-strong">
                  <div className="lg:hidden flex items-center justify-between pb-2 mb-2 border-b border-border">
                    <button
                      type="button"
                      onClick={() => { setSelectedExitVisitId(null); setTankerWashed(null); }}
                      className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-primary hover:underline"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to exit queue
                    </button>
                    <span className="text-xs font-semibold text-muted-foreground">Vehicle Selected</span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Exit clearance</h3>
                  <p className="text-xs text-secondary-foreground font-semibold mt-0.5">
                    Vehicle: <strong className="font-mono tabular-nums text-foreground">{selectedExitVisit.vehicle_number}</strong> | Token: <strong className="font-mono tabular-nums text-foreground">{selectedExitVisit.token_number || 'NO-TOKEN'}</strong> | Entry: <strong className="tabular-nums text-foreground">{selectedExitVisit.entry_timestamp ? formatTime(selectedExitVisit.entry_timestamp) : '-'}</strong>
                  </p>
                </div>

                <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
                  <div>
                    <span className="text-muted-foreground font-sans block text-xs">Exit reason</span>
                    <span className={selectedExitVisit.is_all_rejected ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {selectedExitVisit.exit_reason}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground font-sans block text-xs">Net milk received</span>
                    <span className="font-mono text-base tabular-nums">{selectedExitVisit.net_weight_kg ? `${selectedExitVisit.net_weight_kg.toLocaleString()} kg` : '—'}</span>
                  </div>
                </div>

                {!selectedExitVisit.is_all_rejected && (
                  <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
                    <div>
                      <span className="text-muted-foreground font-sans block text-xs">Gross weight</span>
                      <span className="font-mono text-base tabular-nums">{selectedExitVisit.gross_weight_kg ? `${selectedExitVisit.gross_weight_kg.toLocaleString()} kg` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-sans block text-xs">Second (tare) weight</span>
                      <span className="font-mono text-base tabular-nums">{selectedExitVisit.tare_weight_kg ? `${selectedExitVisit.tare_weight_kg.toLocaleString()} kg` : '—'}</span>
                    </div>
                  </div>
                )}

                {selectedExitVisit.is_all_rejected && (
                  <div className="bg-card border-border p-4 rounded-2xl border text-rose-800 text-xs font-semibold flex items-center space-x-2">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                    <p>All rejected. Return exit.</p>
                  </div>
                )}

                {/* Tanker Washed Check (Phase 4d Stage 4) - only for vehicles that unloaded milk */}
                {!selectedExitVisit.is_all_rejected && (
                <div className="bg-card border-border p-4 rounded-2xl border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Tanker wash check *</span>
                    {tankerWashed === true ? (
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Clean and washed
                      </span>
                    ) : tankerWashed === false ? (
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                        Sent to wash bay
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                        Inspection needed
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTankerWashed(true)}
                      className={`min-h-11 px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 border ${
                        tankerWashed === true
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-card text-secondary-foreground border-border-strong hover:bg-subtle'
                      }`}
                    >
                      
                      <span>Tanker clean and washed</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTankerWashed(false)}
                      className={`min-h-11 px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 border ${
                        tankerWashed === false
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-card text-secondary-foreground border-border-strong hover:bg-subtle'
                      }`}
                    >
                      
                      <span>Send to Wash</span>
                    </button>
                  </div>

                  {tankerWashed === false && (
                    <p className="text-xs font-semibold text-rose-700">
                      Wash required before exit.
                    </p>
                  )}
                </div>

                )}

                <form onSubmit={handleConfirmExit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Gate exit time <span className="text-rose-600">*</span></span>
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    </label>
                    <input
                      type="datetime-local"
                      value={exitOpTimestamp}
                      max={toDatetimeLocalInput(serverNow())}
                      onChange={(e) => setExitOpTimestamp(e.target.value)}
                      className="w-full min-h-11 px-4 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || (!selectedExitVisit.is_all_rejected && tankerWashed !== true)}
                    className="w-full min-h-11 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    
                    <span>{isSubmitting ? 'Confirming exit…' : 'Confirm gate exit'}</span>
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
