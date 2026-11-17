'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import { SkeletonList } from '@/components/ui/loaders';
import { InfoTip } from '@/components/ui/info-tip';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { ErrorPopup } from '@/components/ui/error-popup';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { formatOperationalDatetime } from '@/lib/datetime-utils';

type Units = 'KG' | 'LITER' | 'BOTH';
interface Policy {
  manual_entry_enabled: boolean;
  allowed_units: Units;
  mot_allowed_units: Units;
  tank_variance_percent: number;
  version: number;
}

interface VarianceWatch {
  days: number;
  overBook: Array<{ zmcc: string; vehicle: string; at: string; dispatchAt13ts: number; dispatchGross: number; bookAfterAt13ts: number }>;
  blocked: Array<{ zmcc: string; vehicle: string; at: string; dispatchAt13ts: number | null; bookAt13ts: number | null; limitAt13ts: number | null; variancePercent: number | null }>;
}

const litres = (v: number | null) => (v == null ? '-' : `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} L`);

const UNIT_OPTIONS: Array<{ value: Units; label: string }> = [
  { value: 'KG', label: 'Kilograms only' },
  { value: 'LITER', label: 'Litres only' },
  { value: 'BOTH', label: 'Kilograms or litres' },
];

/** Global ZMCC weighing setting: may MDO / PHE Operator type the net quantity instead of weighing. */
export const WeighingPolicyPanel: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [units, setUnits] = useState<Units>('BOTH');
  const [motUnits, setMotUnits] = useState<Units>('LITER');
  const [variance, setVariance] = useState('0.5');
  const [notice, setNotice] = useState<string | null>(null);
  useAutoClearMessage(notice, setNotice);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['super-admin', 'weighing-policy'],
    queryFn: ({ signal }) => fetchJson<{ policy: Policy }>('/api/super-admin/weighing-policy', { signal }),
  });
  const policy = query.data?.policy;

  useEffect(() => {
    if (policy) {
      setEnabled(policy.manual_entry_enabled);
      setUnits(policy.allowed_units);
      setMotUnits(policy.mot_allowed_units);
      setVariance(String(policy.tank_variance_percent));
    }
  }, [policy]);

  const watch = useQuery({
    queryKey: ['super-admin', 'tank-variance-watch'],
    queryFn: ({ signal }) => fetchJson<VarianceWatch>('/api/super-admin/weighing-policy/tank-variance?days=30', { signal }),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ policy: Policy }>('/api/super-admin/weighing-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_entry_enabled: enabled, allowed_units: units, mot_allowed_units: motUnits, tank_variance_percent: Number(variance) }),
      }),
    onSuccess: () => {
      setActionError(null);
      setNotice('Weighing setting saved.');
      void queryClient.invalidateQueries({ queryKey: ['super-admin', 'weighing-policy'] });
    },
    onError: (err) => {
      setNotice(null);
      setActionError(getErrorMessage(err) || 'Could not save.');
    },
  });

  const varianceValue = Number(variance);
  const varianceOk = variance.trim() !== '' && Number.isFinite(varianceValue) && varianceValue >= 0 && varianceValue <= 5;
  const dirty =
    !!policy &&
    (policy.manual_entry_enabled !== enabled ||
      policy.allowed_units !== units ||
      policy.mot_allowed_units !== motUnits ||
      (varianceOk && policy.tank_variance_percent !== varianceValue));
  const error = actionError || (query.error ? getErrorMessage(query.error) || 'Failed to load the setting.' : null);

  return (
    <div className="w-full max-w-xl space-y-4">
      <ErrorPopup message={error} />
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs sm:p-5">
        {query.isPending ? (
          <SkeletonList count={2} />
        ) : (
          <>
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={enabled}
                disabled={!canEdit || save.isPending}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                <span className="flex items-center text-sm font-semibold text-foreground">
                  Allow direct portion net entry
                  <InfoTip text="When enabled, ZMCC operators can type each portion's net quantity directly. When disabled (recommended), operators are restricted to physical stepwise scale weights (N+1)." />
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="weighing-units" className="mb-1 block text-xs font-semibold text-secondary-foreground">
                Manual units
              </label>
              <select
                id="weighing-units"
                value={units}
                disabled={!canEdit || !enabled || save.isPending}
                onChange={(e) => setUnits(e.target.value as Units)}
                className="min-h-11 w-full rounded-xl border bg-card px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-hidden disabled:opacity-60"
              >
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="mot-units" className="mb-1 block text-xs font-semibold text-secondary-foreground">
                Mobile Tester shop form units
              </label>
              <select
                id="mot-units"
                value={motUnits}
                disabled={!canEdit || save.isPending}
                onChange={(e) => setMotUnits(e.target.value as Units)}
                className="min-h-11 w-full rounded-xl border bg-card px-3 py-2 text-sm focus:ring-2 focus:ring-ring"
              >
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Phones update on next shop form load.</p>
            </div>

            <div>
              <label htmlFor="tank-variance" className="mb-1 flex items-center text-xs font-semibold text-secondary-foreground">
                Tank variance (% at 13 TS)
                <InfoTip text="ZMCC dispatch is checked against the tank's @13 TS stock, not gross litres, because pipe-flush water raises gross but not milk solids. A dispatch may go above the @13 TS stock by this percent of its own @13 TS litres, to allow for normal Fat and LR test differences. 0 to 5." />
              </label>
              <input
                id="tank-variance"
                type="number"
                inputMode="decimal"
                min={0}
                max={5}
                step={0.1}
                value={variance}
                disabled={!canEdit || save.isPending}
                onChange={(e) => setVariance(e.target.value)}
                className="min-h-11 w-full rounded-xl border bg-card px-3 py-2 text-sm focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              {!varianceOk && <p className="mt-1 text-xs font-semibold text-rose-800">Enter 0 to 5.</p>}
            </div>

            {canEdit ? (
              <button
                type="button"
                disabled={!dirty || !varianceOk || save.isPending}
                onClick={() => {
                  setNotice(null);
                  setActionError(null);
                  save.mutate();
                }}
                className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save setting'}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">Super Admin only.</p>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center text-sm font-semibold text-foreground">
            Tank variance watch
            <InfoTip text="Last 30 days. Over book: dispatches that took a tank's @13 TS stock below zero, allowed by the variance. Blocked: dispatches refused because they were more than the stock plus the variance. Many rows here mean the conflict is real and a tank close-out may be needed." />
          </h3>
          {watch.data && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {watch.data.overBook.length} over book · {watch.data.blocked.length} blocked
            </span>
          )}
        </div>
        <ErrorPopup message={watch.error ? getErrorMessage(watch.error) || 'Could not load the watch.' : null} onRetry={() => void watch.refetch()} />
        {watch.isPending ? (
          <SkeletonList count={2} />
        ) : watch.data && watch.data.overBook.length === 0 && watch.data.blocked.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conflicts in the last 30 days.</p>
        ) : (
          watch.data && (
            <>
              {watch.data.overBook.length > 0 && (
                <TableWrapper className="rounded-lg border border-border/60">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-2 py-2 font-semibold">Over book</th>
                        <th className="px-2 py-2 font-semibold">Vehicle</th>
                        <th className="px-2 py-2 font-semibold text-right">Dispatch @13 TS</th>
                        <th className="px-2 py-2 font-semibold text-right">Book after</th>
                        <th className="px-2 py-2 font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {watch.data.overBook.map((r, i) => (
                        <tr key={`o-${i}`}>
                          <td className="px-2 py-2">{r.zmcc}</td>
                          <td className="px-2 py-2 font-semibold">{r.vehicle || '-'}</td>
                          <td className="px-2 py-2 text-right">{litres(r.dispatchAt13ts)}</td>
                          <td className="px-2 py-2 text-right font-semibold text-rose-700">{litres(r.bookAfterAt13ts)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatOperationalDatetime(r.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrapper>
              )}
              {watch.data.blocked.length > 0 && (
                <TableWrapper className="rounded-lg border border-border/60">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-2 py-2 font-semibold">Blocked</th>
                        <th className="px-2 py-2 font-semibold">Vehicle</th>
                        <th className="px-2 py-2 font-semibold text-right">Dispatch @13 TS</th>
                        <th className="px-2 py-2 font-semibold text-right">Book</th>
                        <th className="px-2 py-2 font-semibold text-right">Limit</th>
                        <th className="px-2 py-2 font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {watch.data.blocked.map((r, i) => (
                        <tr key={`b-${i}`}>
                          <td className="px-2 py-2">{r.zmcc}</td>
                          <td className="px-2 py-2 font-semibold">{r.vehicle || '-'}</td>
                          <td className="px-2 py-2 text-right">{litres(r.dispatchAt13ts)}</td>
                          <td className="px-2 py-2 text-right">{litres(r.bookAt13ts)}</td>
                          <td className="px-2 py-2 text-right">{litres(r.limitAt13ts)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatOperationalDatetime(r.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrapper>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
};

export default WeighingPolicyPanel;
