'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';

type Units = 'KG' | 'LITER' | 'BOTH';
interface Policy {
  manual_entry_enabled: boolean;
  allowed_units: Units;
  version: number;
}

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
  const [notice, setNotice] = useState<string | null>(null);
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
    }
  }, [policy]);

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ policy: Policy }>('/api/super-admin/weighing-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_entry_enabled: enabled, allowed_units: units }),
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

  const dirty = !!policy && (policy.manual_entry_enabled !== enabled || policy.allowed_units !== units);
  const error = actionError || (query.error ? getErrorMessage(query.error) || 'Failed to load the setting.' : null);

  return (
    <div className="w-full max-w-xl space-y-4">
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-2xs sm:p-5">
        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
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
              <label htmlFor="weighing-units" className="mb-1 block text-xs font-semibold text-slate-700">
                Manual units
              </label>
              <select
                id="weighing-units"
                value={units}
                disabled={!canEdit || !enabled || save.isPending}
                onChange={(e) => setUnits(e.target.value as Units)}
                className="min-h-[44px] w-full rounded-xl border bg-card px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-hidden disabled:opacity-60"
              >
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {canEdit ? (
              <button
                type="button"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setNotice(null);
                  setActionError(null);
                  save.mutate();
                }}
                className="min-h-[44px] rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save setting'}
              </button>
            ) : (
              <p className="text-xs text-slate-500">Only the Super Admin can change this setting.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WeighingPolicyPanel;
