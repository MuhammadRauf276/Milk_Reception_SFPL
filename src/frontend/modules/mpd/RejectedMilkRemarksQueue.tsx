'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import type { RejectedMilkQueueItem } from '@/backend/services/rejectedMilkDispositionService';

type QueueItem = RejectedMilkQueueItem;

interface RejectedMilkRemarksQueueProps {
  /** Only the MPD Head (and Super Admin) can write remarks; others see the list. */
  canWrite?: boolean;
}

export const RejectedMilkRemarksQueue: React.FC<RejectedMilkRemarksQueueProps> = ({ canWrite = true }) => {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['mpd', 'rejected-milk', showDone ? 'all' : 'pending'],
    queryFn: ({ signal }) =>
      fetchJson<{ items?: QueueItem[]; can_add_remarks?: boolean }>(`/api/mpd/rejected-milk?status=${showDone ? 'all' : 'pending'}`, {
        cache: 'no-store',
        signal,
      }),
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];
  const allowWrite = canWrite && query.data?.can_add_remarks !== false;
  const loading = query.isPending;
  const error = actionError || (query.error ? getErrorMessage(query.error) || 'Could not load rejected milk.' : null);
  const load = () => queryClient.invalidateQueries({ queryKey: ['mpd', 'rejected-milk'] });

  const save = async (item: QueueItem) => {
    const remarks = (drafts[item.entity_id] || '').trim();
    if (!remarks) {
      setActionError('Please write your remarks first.');
      return;
    }
    setSavingId(item.entity_id);
    setActionError(null);
    try {
      await fetchJson('/api/mpd/rejected-milk/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: item.entity_type, entity_id: item.entity_id, remarks }),
      });
      setDrafts((d) => ({ ...d, [item.entity_id]: '' }));
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err) || 'Could not save remarks.');
    } finally {
      setSavingId(null);
    }
  };

  const waiting = items.filter((i) => !i.remarks).length;

  return (
    <section className="bg-card border border-border rounded-xl shadow-2xs overflow-hidden mb-6">
      <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <h2 className="text-base font-semibold text-foreground">Rejected milk: your remarks</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            {waiting} waiting
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="px-4 min-h-[44px] rounded-lg text-sm font-semibold border border-border bg-card text-foreground hover:bg-muted"
          >
            {showDone ? 'Show only waiting' : 'Show done too'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-card border-border m-4 p-3 border text-rose-800 text-sm font-semibold rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {items.length === 0 && !loading ? (
        <div className="p-6 text-center text-sm font-medium text-slate-500">No pending remarks</div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.entity_id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                  item.entity_type === 'PLANT_PORTION' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}>
                  {item.entity_type === 'PLANT_PORTION' ? 'Plant Reception' : 'ZMCC'}
                </span>
                <strong className="text-foreground">{item.zmcc_name}</strong>
                {item.zmcc_token && <span className="font-mono">{item.zmcc_token}</span>}
                <span>Portion {item.portion_number}</span>
                {item.gross_liters && <span>{item.gross_liters} L</span>}
                {item.rejected_at && <span>{new Date(item.rejected_at).toLocaleDateString()}</span>}
              </div>
              {item.reject_reason && (
                <div className="flex items-center gap-1 text-sm text-slate-600">
                  <span>Reason</span>
                  <InfoTip text={item.reject_reason} />
                </div>
              )}

              {item.remarks ? (
                <div className="bg-card border-border p-3 rounded-xl border text-sm text-emerald-900 flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Done: {item.remarks}</div>
                    <div className="text-xs text-emerald-800">
                      {item.remarks_by} {item.remarks_at ? `on ${new Date(item.remarks_at).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                </div>
              ) : allowWrite ? (
                <div className="space-y-2">
                  <textarea
                    value={drafts[item.entity_id] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.entity_id]: e.target.value }))}
                    placeholder="Remarks"
                    className="w-full text-sm font-medium border border-border rounded-xl p-3 bg-subtle text-foreground focus:ring-2 focus:ring-primary min-h-[90px] min-h-11"
                  />
                  <button
                    type="button"
                    disabled={savingId === item.entity_id || !(drafts[item.entity_id] || '').trim()}
                    onClick={() => save(item)}
                    className="w-full sm:w-auto px-6 min-h-[56px] rounded-xl text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 inline-flex items-center justify-center gap-2 min-h-11"
                  >
                    {savingId === item.entity_id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Save remarks</span>
                  </button>
                </div>
              ) : (
                <div className="text-sm font-semibold text-amber-700">Waiting for MPD Head remarks.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
