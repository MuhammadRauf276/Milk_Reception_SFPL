'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Settings, ShieldAlert, X, Loader2 } from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { formatDateTime } from '@/lib/format';

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

const warningColumns: DataColumn<WarningItem>[] = [
  { key: 'when', header: 'Timestamp', label: 'Timestamp', cell: (w) => <span className="tabular-nums text-muted-foreground">{formatDateTime(w.createdAt)}</span> },
  {
    key: 'source',
    header: 'Procurement source',
    label: 'Procurement source',
    primary: true,
    cell: (w) => (
      <div className="min-w-0 font-semibold text-foreground">
        {w.procurementSource.name}
        <span className="block break-all font-mono text-xs font-normal text-muted-foreground">{w.procurementSource.code}</span>
      </div>
    ),
  },
  { key: 'test', header: 'Lab test', label: 'Lab test', cell: (w) => <span className="text-foreground">{w.labTest?.name || 'Quality parameter'}</span> },
  { key: 'reason', header: 'Warning reason', label: 'Warning reason', cell: (w) => <span className="font-medium text-amber-900">{w.reason}</span> },
  { key: 'by', header: 'Evaluated by', label: 'Evaluated by', cell: (w) => <span className="text-secondary-foreground">{w.createdBy}</span> },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    align: 'center',
    cell: (w) => <span className="rounded-md bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-800">{w.status}</span>,
  },
];

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
    <div className="min-w-0 space-y-4">
      {/* Top Banner Card: Plant Reception Warning Limit Setting */}
      <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Plant reception warning limit policy</h2>
                <span className="rounded-md bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900">
                  {threshold} vehicles / month
                </span>
              </div>
              <p className="mt-1 text-xs text-secondary-foreground max-w-2xl leading-relaxed">
                When a source reaches <strong>{threshold} warning vehicles</strong> in a month, accepting another needs <strong>AVP QA</strong> approval.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <Loader2 className={isFetching ? 'animate-spin' : 'text-muted-foreground'} />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditThresholdValue(threshold);
                setReason('');
                setIsModalOpen(true);
              }}
            >
              <Settings className="text-muted-foreground" />
              Change limit
            </Button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getErrorMessage(error) || 'Failed to load warning limit governance data'}</span>
        </div>
      )}

      {/* Monthly Summary Per Procurement Source */}
      <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Current month warnings by procurement source
          </h3>
          <span className="text-xs text-muted-foreground">Deduplicated per vehicle per source</span>
        </div>

        {summary.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No warning accumulations recorded for this month.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 text-xs">
            {summary.map((s) => {
              const isOverLimit = s.activeWarningCount >= threshold;
              return (
                <div
                  key={s.sourceId}
                  className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${
                    isOverLimit
                      ? 'border-rose-300 bg-rose-50/50'
                      : 'border-border bg-subtle/60'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-foreground">{s.sourceName}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.sourceCode} · {s.sourceType}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                        isOverLimit
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {s.activeWarningCount} / {threshold}
                    </span>
                    {isOverLimit && (
                      <span className="block text-xs font-semibold text-rose-600 mt-0.5">
                        AVP escalated
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
      <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Plant QA warning event log
        </h3>

        <DataTable
          columns={warningColumns}
          rows={warnings}
          getRowId={(w) => w.id}
          loading={isLoading}
          emptyTitle="No QA warning events"
          tableFrom="lg"
        />
      </div>

      {/* Edit Threshold Modal */}
      {isModalOpen && (
        <Modal
          onClose={() => !updateThresholdMutation.isPending && setIsModalOpen(false)}
          preventClose={updateThresholdMutation.isPending}
          title="Warning limit for plant reception"
          showHeader={false}
          className="max-w-md space-y-4 p-5"
        >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-semibold text-foreground">Warning limit for plant reception</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-secondary-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Monthly warning limit (vehicles per source)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={editThresholdValue}
                onChange={(e) => setEditThresholdValue(parseInt(e.target.value, 10) || 1)}
                className="min-h-11 w-full rounded-lg border border-border-strong px-3 text-sm font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Default: 4 vehicles a month
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Reason for change (needed for the audit trail)
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Approved by Head of QA for seasonal winter flush transition."
                className="w-full rounded-lg border border-border-strong p-3 text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={updateThresholdMutation.isPending}
                onClick={() => {
                  updateThresholdMutation.mutate({
                    threshold: editThresholdValue,
                    reason: reason || 'Super Admin changed warning threshold',
                  });
                }}
              >
                {updateThresholdMutation.isPending ? 'Saving…' : 'Save limit'}
              </Button>
            </div>
        </Modal>
      )}
    </div>
  );
}
