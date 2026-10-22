'use client';

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
import type { ExitQueueItem } from '@/backend/services/zmccArrival/zmccExitService';

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'LEFT_BEFORE_UNLOADING', label: 'Left before unloading' },
  { value: 'SENT_BACK', label: 'Sent back' },
  { value: 'TANK_FULL', label: 'Tank full' },
  { value: 'VEHICLE_PROBLEM', label: 'Vehicle problem' },
  { value: 'OTHER', label: 'Other' },
];

const OUTCOME_LABEL: Record<string, string> = {
  RECEIVED: 'All milk received',
  REJECTED: 'All milk rejected',
  PARTLY_RECEIVED: 'Partly received',
  ACCEPTED_NOT_RECEIVED: 'Accepted but not received',
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
          className={`${zmccInputClass} bg-white`}
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
      onDone(kind === 'exit' ? 'Exit recorded.' : 'Request sent to the ZMCC Manager.');
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save. Please try again.');
    }
  };

  return (
    <ZmccDrawer
      open
      onClose={onClose}
      title={kind === 'exit' ? 'Record vehicle exit' : 'Close without unloading'}
      subtitle={`${item.vehicle_number || 'Vehicle'} - ${item.source_type}`}
      icon={<DoorOpen className="mt-0.5 h-5 w-5 text-slate-600" />}
    >
      {kind === 'exit' ? (
        <p className="text-sm text-slate-700">
          Result if the vehicle leaves now: <strong>{OUTCOME_LABEL[item.preview_outcome] ?? item.preview_outcome}</strong>.
          {item.needs_reason && ' Milk was not fully unloaded, so a reason is needed. The ZMCC Manager will be told.'}
        </p>
      ) : (
        <p className="text-sm text-slate-700">
          The accepted milk will not be unloaded. The ZMCC Manager must approve before the visit is closed.
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

  const query = useQuery({
    queryKey: ['zmcc', 'exit', 'queue'],
    queryFn: ({ signal }) => fetchJson<{ items: ExitQueueItem[] }>('/api/zmcc/exit/queue', { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });
  const items = query.data?.items ?? [];
  const error = query.error ? getErrorMessage(query.error) || 'Could not load the list.' : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Vehicle exit</h2>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['zmcc', 'exit'] })}
          className="h-11 min-w-[44px] rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800"
        >
          Refresh
        </button>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      )}
      <ZmccErrorBanner message={error} />
      {query.isFetching && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {!query.isLoading && items.length === 0 && <p className="text-sm text-slate-600">No vehicle is waiting to leave.</p>}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.session_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Truck className="h-5 w-5 text-slate-600" />
                {item.vehicle_number || 'Vehicle'}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{item.source_type}</span>
              </div>
              <span className="text-sm font-semibold text-slate-700">
                {item.unloaded ? 'Unloaded' : 'Not unloaded'} - {OUTCOME_LABEL[item.preview_outcome] ?? item.preview_outcome}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {item.source_name || ''}
              {item.zmcc_token ? ` - Token ${item.zmcc_token}` : ''}
            </p>
            {item.close_requested && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-800">
                <Clock className="h-4 w-4" /> Waiting for the ZMCC Manager to approve closing without unloading.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {item.can_exit && (
                <button type="button" className={zmccPrimaryBtn} onClick={() => setDialog({ kind: 'exit', item })}>
                  Record exit
                </button>
              )}
              {item.can_request_close && (
                <button type="button" className={zmccGhostBtn} onClick={() => setDialog({ kind: 'close', item })}>
                  Close without unloading
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

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
