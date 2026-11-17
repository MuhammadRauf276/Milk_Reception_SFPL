'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, DoorOpen, Loader2, Truck } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import {
  ZmccDrawer,
  ZmccErrorBanner,
  zmccGhostBtn,
  zmccInputClass,
  zmccLabelClass,
  zmccPrimaryBtn,
} from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { InfoTip } from '@/components/ui/info-tip';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import type { ExitQueueItem } from '@/backend/services/zmccArrival/zmccExitService';

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'LEFT_BEFORE_UNLOADING', label: 'Left before unloading' },
  { value: 'SENT_BACK', label: 'Sent back' },
  { value: 'TANK_FULL', label: 'Tank full' },
  { value: 'VEHICLE_PROBLEM', label: 'Vehicle problem' },
  { value: 'OTHER', label: 'Other' },
];

const OUTCOME_LABEL: Record<string, string> = {
  RECEIVED: 'Fully Unloaded',
  REJECTED: 'Rejected by Lab',
  PARTLY_RECEIVED: 'Partly Unloaded',
  ACCEPTED_NOT_RECEIVED: 'Lab Passed (Not Unloaded)',
};

type Dialog = { kind: 'exit' | 'close'; item: ExitQueueItem } | null;

const ReasonFields: React.FC<{
  code: string;
  remarks: string;
  required: boolean;
  disabled: boolean;
  onCode: (v: string) => void;
  onRemarks: (v: string) => void;
}> = ({ code, remarks, required, disabled, onCode, onRemarks }) => (
  <>
    {required && (
      <div>
        <label className={zmccLabelClass} htmlFor="exit-reason">
          Reason
        </label>
        <select
          id="exit-reason"
          value={code}
          disabled={disabled}
          onChange={(e) => onCode(e.target.value)}
          className={`${zmccInputClass} bg-card`}
        >
          <option value="">Choose a reason</option>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
    )}
    <div>
      <label className={zmccLabelClass} htmlFor="exit-remarks">
        Remarks{required ? '' : ' (optional)'}
      </label>
      <textarea
        id="exit-remarks"
        rows={3}
        value={remarks}
        disabled={disabled}
        onChange={(e) => onRemarks(e.target.value)}
        className={zmccInputClass}
      />
    </div>
  </>
);

const ExitDrawer: React.FC<{ kind: 'exit' | 'close'; item: ExitQueueItem; onClose: () => void; onDone: (m: string) => void }> = ({
  kind,
  item,
  onClose,
  onDone,
}) => {
  const [code, setCode] = useState('');
  const [remarks, setRemarks] = useState('');
  const formDraft = useLocalFormDraft({
    formKey: `zmcc-exit:${kind}:${item.session_id}`,
    values: { code, remarks },
    onRestore: (fields) => {
      if (fields.code !== undefined) setCode(fields.code);
      if (fields.remarks !== undefined) setRemarks(fields.remarks);
    },
  });
  const [error, setError] = useState<string | null>(null);
  const reasonRequired = kind === 'close' || item.needs_reason;

  const mutation = useMutation({
    mutationFn: () =>
      kind === 'exit'
        ? fetchJson(`/api/zmcc/arrivals/hc/${item.hc_arrival_id}/exit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_event_id: `hc-exit-${item.session_id}-${Date.now()}`,
              exit_reason_code: reasonRequired ? code : undefined,
              exit_remarks: remarks,
            }),
          })
        : fetchJson(`/api/zmcc/lab/sessions/${item.session_id}/close-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason_code: code, remarks }),
          }),
  });

  const canSubmit = !reasonRequired || (code !== '' && remarks.trim().length >= 3);

  const submit = async () => {
    setError(null);
    try {
      await mutation.mutateAsync();
      formDraft.clear();
      onDone(kind === 'exit' ? 'Exit recorded.' : 'Request sent to the ZMCC Manager.');
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save. Try again.');
    }
  };

  return (
    <ZmccDrawer
      open
      onClose={onClose}
      title={kind === 'exit' ? 'Record vehicle exit' : 'Close without unloading'}
      subtitle={`${item.vehicle_number || 'Vehicle'}${item.zmcc_token ? ` · Token ${item.zmcc_token}` : ''} - ${item.source_type}`}
      icon={<DoorOpen className="mt-0.5 h-5 w-5 text-secondary-foreground" />}
    >
      {kind === 'exit' ? (
        <p className="text-sm text-secondary-foreground">
          Outcome: <strong>{OUTCOME_LABEL[item.preview_outcome] ?? item.preview_outcome}</strong>
          {item.needs_reason && (
            <InfoTip text="Milk was not unloaded into the tank. An exit reason is required, and the ZMCC Manager will be notified." />
          )}
        </p>
      ) : (
        <p className="text-sm text-secondary-foreground">
          Manager approval needed.
        </p>
      )}
      <ReasonFields
        code={code}
        remarks={remarks}
        required={reasonRequired}
        disabled={mutation.isPending}
        onCode={setCode}
        onRemarks={setRemarks}
      />
      <ZmccErrorBanner message={error} />
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" className={zmccPrimaryBtn} disabled={mutation.isPending || !canSubmit} onClick={() => void submit()}>
          {mutation.isPending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
          {kind === 'exit' ? 'Record exit' : 'Send request'}
        </button>
        <button type="button" className={zmccGhostBtn} onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </button>
      </div>
    </ZmccDrawer>
  );
};

/** PHE Operator: HC gate exit (last step) and "Close without unloading" requests (MC and HC). */
export const ZmccExitWorkspace: React.FC = () => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useAutoClearMessage(notice, setNotice);

  const query = useQuery({
    queryKey: ['zmcc', 'exit', 'queue'],
    queryFn: ({ signal }) => fetchJson<{ items: ExitQueueItem[] }>('/api/zmcc/exit/queue', { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });
  const items = query.data?.items ?? [];
  const paged = usePagedRows(items, (item) => String(item.session_id));
  const error = query.error ? getErrorMessage(query.error) || 'Could not load the list.' : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Vehicle exit</h2>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['zmcc', 'exit'] })}
          className="h-11 min-w-11 rounded-lg border border-border-strong px-4 text-sm font-semibold text-foreground"
        >
          Refresh
        </button>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      )}
      <ZmccErrorBanner message={error} />
      {query.isFetching && (
        <p className="flex items-center gap-2 text-sm text-secondary-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {!query.isLoading && items.length === 0 && <p className="text-sm text-secondary-foreground">No vehicles waiting.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paged.pageRows.map((item) => (
          <div
            key={item.session_id}
            className="bg-card border-border rounded-2xl border p-4 shadow-2xs flex flex-col justify-between space-y-3"
          >
            <div>
              {/* Header row: Vehicle with Truck icon + Source Type badge + Status badge */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Truck className="h-4 w-4 text-secondary-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground tabular-nums leading-tight">
                      {item.vehicle_number || 'Vehicle'}
                    </div>
                    <span
                      className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-semibold tracking-wider ${
                        item.source_type === 'MC' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.source_type}
                    </span>
                  </div>
                </div>

                <span
                  className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    item.unloaded
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-muted text-secondary-foreground'
                  }`}
                >
                  {item.unloaded && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {item.unloaded ? 'Unloaded' : (OUTCOME_LABEL[item.preview_outcome] ?? item.preview_outcome)}
                </span>
              </div>

              {/* Source Name & Token */}
              <div className="mt-3 space-y-1.5">
                <div className="text-sm font-semibold text-foreground line-clamp-1" title={item.source_name || ''}>
                  {item.source_name || (item.source_type === 'MC' ? 'Route Milk' : 'Direct Supplier')}
                </div>
                {item.zmcc_token && (
                  <span className="inline-block font-mono text-xs font-medium px-2 py-0.5 rounded bg-muted text-secondary-foreground border border-border">
                    Token: {item.zmcc_token}
                  </span>
                )}
              </div>

              {item.close_requested && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                  <Clock className="h-4 w-4 shrink-0 text-amber-700" />
                  <span>Awaiting manager approval</span>
                  <InfoTip text="The ZMCC Manager must approve closing this visit without unloading." />
                </div>
              )}
            </div>

            {/* Actions at bottom of card */}
            <div className="pt-3 border-t border-border flex flex-col gap-2">
              {item.can_exit && (
                <button
                  type="button"
                  className={`${zmccPrimaryBtn} w-full justify-center text-xs min-h-11`}
                  onClick={() => setDialog({ kind: 'exit', item })}
                >
                  Record exit
                </button>
              )}
              {item.can_request_close && (
                <button
                  type="button"
                  className={`${zmccGhostBtn} w-full justify-center text-xs min-h-11`}
                  onClick={() => setDialog({ kind: 'close', item })}
                >
                  Close visit without unloading
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {paged.totalRecords > 0 && (
        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          totalRecords={paged.totalRecords}
          pageSize={paged.pageSize}
          noun="vehicles"
          onPageChange={paged.setPage}
        />
      )}

      {dialog && (
        <ExitDrawer
          key={`${dialog.kind}-${dialog.item.session_id}`}
          kind={dialog.kind}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setNotice(m);
            setDialog(null);
            void queryClient.invalidateQueries({ queryKey: ['zmcc', 'exit'] });
          }}
        />
      )}
    </div>
  );
};

export default ZmccExitWorkspace;
