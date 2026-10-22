'use client';

import { useState } from 'react';

export type ExitOutcomeRow = {
  sessionId: string;
  arrivalLabel: 'MC' | 'HC';
  reference: string;
  vehicleNumber: string | null;
  sourceName: string | null;
  exitOutcome: string | null;
  reasonCode: string | null;
  remarks: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  acceptedNotReceivedKg: number;
  acceptedNotReceivedLiters: number;
};

const REASON_LABELS: Record<string, string> = {
  LEFT_BEFORE_UNLOADING: 'Left before unloading',
  SENT_BACK: 'Sent back',
  TANK_FULL: 'Tank full',
  VEHICLE_PROBLEM: 'Vehicle problem',
  OTHER: 'Other',
};

function qty(row: ExitOutcomeRow) {
  return `${row.acceptedNotReceivedKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg / ${row.acceptedNotReceivedLiters.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`;
}

/** ZMCC manager view: vehicles that left without full unloading, plus pending close-without-unloading requests. */
export function ZmccExitOutcomes({ left, pending, canDecide, busy, onDecide }: {
  left: ExitOutcomeRow[];
  pending: ExitOutcomeRow[];
  canDecide?: boolean;
  busy?: boolean;
  onDecide?: (sessionId: string, decision: 'APPROVE' | 'REJECT', remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  return <div className="grid gap-3 lg:grid-cols-2">
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
      <p className="font-semibold text-slate-900">Pending close-without-unloading requests ({pending.length})</p>
      {pending.length ? pending.map((row) => <div key={row.sessionId} className="mt-2 space-y-1 border-t pt-2">
        <p className="font-medium">{row.arrivalLabel} · {row.reference}{row.vehicleNumber ? ` · ${row.vehicleNumber}` : ''}</p>
        <p className="text-slate-600">Accepted, not received: <strong>{qty(row)}</strong></p>
        <p className="text-slate-600">Requested by {row.requestedBy ?? '—'}{row.requestedAt ? ` · ${new Date(row.requestedAt).toLocaleString()}` : ''}</p>
        {row.reasonCode || row.remarks ? <p className="text-slate-500">{[row.reasonCode ? REASON_LABELS[row.reasonCode] ?? row.reasonCode : null, row.remarks].filter(Boolean).join(' — ')}</p> : null}
        {canDecide ? <div className="space-y-1">
          <input value={remarks[row.sessionId] ?? ''} onChange={(e) => setRemarks((c) => ({ ...c, [row.sessionId]: e.target.value }))} placeholder="Remarks (min 3 letters)" aria-label="Decision remarks" className="min-h-11 w-full rounded border border-slate-300 px-2" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || (remarks[row.sessionId] ?? '').trim().length < 3} onClick={() => onDecide?.(row.sessionId, 'APPROVE', (remarks[row.sessionId] ?? '').trim())} className="min-h-11 rounded bg-emerald-700 px-3 text-white disabled:opacity-50">Approve</button>
            <button type="button" disabled={busy || (remarks[row.sessionId] ?? '').trim().length < 3} onClick={() => onDecide?.(row.sessionId, 'REJECT', (remarks[row.sessionId] ?? '').trim())} className="min-h-11 rounded bg-slate-700 px-3 text-white disabled:opacity-50">Reject</button>
          </div>
        </div> : null}
      </div>) : <p className="mt-2 text-slate-500">No pending requests.</p>}
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
      <p className="font-semibold text-slate-900">Left without full unloading ({left.length})</p>
      {left.length ? left.map((row) => <div key={row.sessionId} className="mt-2 space-y-1 border-t pt-2">
        <p className="font-medium">{row.arrivalLabel} · {row.reference}{row.vehicleNumber ? ` · ${row.vehicleNumber}` : ''}{row.sourceName ? ` · ${row.sourceName}` : ''}</p>
        <p className="text-slate-600">{row.exitOutcome === 'PARTLY_RECEIVED' ? 'Partly received' : 'Accepted, not received'} · accepted not received <strong>{qty(row)}</strong></p>
        <p className="text-slate-600">Reason: {row.reasonCode ? REASON_LABELS[row.reasonCode] ?? row.reasonCode : '—'}{row.remarks ? ` — ${row.remarks}` : ''}</p>
        <p className="text-slate-500">Recorded by {row.recordedBy ?? '—'}{row.recordedAt ? ` · ${new Date(row.recordedAt).toLocaleString()}` : ''}</p>
      </div>) : <p className="mt-2 text-slate-500">None in the last 30 days.</p>}
    </div>
  </div>;
}
