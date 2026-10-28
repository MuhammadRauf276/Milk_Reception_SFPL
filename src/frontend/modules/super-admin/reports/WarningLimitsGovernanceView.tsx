'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Settings, ShieldAlert, CheckCircle2, X, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';

interface WarningItem {
  id: string;
  procurementSourceId: string;
  procurementSource: {
    code: string;
    name: string;
    sourceType: string;
  };
  visitId: string | null;
  portionId: string | null;
  labTest: { code: string; name: string } | null;
  reason: string;
  status: string;
  createdAt: string;
  createdBy: string;
  acknowledgedBy: string | null;
}

interface MonthlySummaryItem {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceType: string;
  activeWarningCount: number;
}

interface ApiResponse {
  threshold?: number;
  warnings?: WarningItem[];
  monthlySummary?: MonthlySummaryItem[];
}

export function WarningLimitsGovernanceView() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editThresholdValue, setEditThresholdValue] = useState<number>(4);
  const [reason, setReason] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ['super-admin', 'qa-warnings-full'],
    queryFn: () =>
      fetchJson<ApiResponse>('/api/super-admin/qa-warnings', { cache: 'no-store' }),
  });

  const threshold = data?.threshold ?? 4;
  const warnings = data?.warnings ?? [];
  const summary = data?.monthlySummary ?? [];

  const updateThresholdMutation = useMutation({
    mutationFn: ({ threshold, reason }: { threshold: number; reason: string }) =>
      fetchJson('/api/super-admin/qa-warnings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold, reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'qa-warnings-full'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'qa-warnings-threshold'] });
      setIsModalOpen(false);
      setReason('');
      toast.success('Warning threshold limit updated successfully.');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err) || 'Failed to update threshold');
    },
  });

  return (
    <div className="space-y-4">
      {/* Top Banner Card: Plant Reception Warning Limit Setting */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Plant Reception Warning Limit Policy</h2>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                  {threshold} Vehicles / Month
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
                Controls the Month-to-Date (MTD) warning acceptance quota per procurement source.
                If a vehicle from a supplier exceeds <strong>{threshold} warnings</strong> in a calendar month,
                acceptance authority automatically escalates to the <strong>AVP Reception Lab / QA Head</strong>.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Loader2 className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEditThresholdValue(threshold);
                setReason('');
                setIsModalOpen(true);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50"
            >
              <Settings className="h-3.5 w-3.5 text-slate-500" />
              <span>Change Limit</span>
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getErrorMessage(error) || 'Failed to load warning limit governance data'}</span>
        </div>
      )}

      {/* Monthly Summary Per Procurement Source */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Current Month Warning Accumulation by Procurement Source
          </h3>
          <span className="text-xs text-slate-400">Deduplicated per vehicle per source</span>
        </div>

        {summary.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">No warning accumulations recorded for this month.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {summary.map((s) => {
              const isOverLimit = s.activeWarningCount >= threshold;
              return (
                <div
                  key={s.sourceId}
                  className={`rounded-xl border p-3 flex justify-between items-center transition ${
                    isOverLimit
                      ? 'border-rose-300 bg-rose-50/50'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-900">{s.sourceName}</div>
                    <div className="text-[10px] text-slate-500">
                      {s.sourceCode} · {s.sourceType}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${
                        isOverLimit
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {s.activeWarningCount} / {threshold}
                    </span>
                    {isOverLimit && (
                      <span className="block text-[9px] font-bold text-rose-600 mt-0.5">
                        AVP Escalated
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Warning Event Records Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Plant QA Warning Event Log
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs font-medium text-slate-800">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Procurement Source</th>
                <th className="p-3">Lab Test</th>
                <th className="p-3">Warning Reason</th>
                <th className="p-3">Evaluated By</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Loading warning log…
                  </td>
                </tr>
              ) : warnings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
                    No QA warning events recorded.
                  </td>
                </tr>
              ) : (
                warnings.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/70 transition">
                    <td className="p-3 tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(w.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 font-semibold text-slate-900">
                      {w.procurementSource.name}
                      <span className="block text-[10px] text-slate-400 font-normal">
                        {w.procurementSource.code}
                      </span>
                    </td>
                    <td className="p-3 text-slate-800">{w.labTest?.name || 'Quality Parameter'}</td>
                    <td className="p-3 text-amber-900 font-medium">{w.reason}</td>
                    <td className="p-3 text-slate-600">{w.createdBy}</td>
                    <td className="p-3 text-center">
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                        {w.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Threshold Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Configure Plant Reception Warning Limit</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Monthly Warning Threshold (Vehicles per Source)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={editThresholdValue}
                onChange={(e) => setEditThresholdValue(parseInt(e.target.value, 10) || 1)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-900 focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Default standard: 4 vehicles/month. Any source exceeding this limit requires AVP-QA approval.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Reason for Change (Audit Requirement)
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Approved by Head of QA for seasonal winter flush transition."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updateThresholdMutation.isPending}
                onClick={() => {
                  updateThresholdMutation.mutate({
                    threshold: editThresholdValue,
                    reason: reason || 'Super Admin changed warning threshold',
                  });
                }}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {updateThresholdMutation.isPending ? 'Saving…' : 'Save Limit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
