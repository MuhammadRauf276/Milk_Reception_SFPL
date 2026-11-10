'use client';

import { SkeletonList } from '@/components/ui/loaders';
import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { MinusCircle, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { fetchJson } from '@/lib/query/fetchJson';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { newClientRequestId, type SiloIssueHistoryDef, type SiloOption } from './productionTypes';

/** Bottom sheet: record an outbound milk issue from a silo and review its recent issues. */
export const ProductionSiloIssueDrawer: React.FC<{
  silo: SiloOption;
  onClose: () => void;
  onRecorded: () => void;
}> = ({ silo, onClose, onRecorded }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issueQuantityLiters, setIssueQuantityLiters] = useState<string>('');
  const [issuePurpose, setIssuePurpose] = useState<string>('UHT Milk');
  const [issueFlowMeterRef, setIssueFlowMeterRef] = useState<string>('');
  const [issueOpTimestamp, setIssueOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [actionLoading, setActionLoading] = useState(false);

  // What was typed stays on this device until the issue is recorded.
  const issueDraft = useLocalFormDraft({
    formKey: `silo-issue:${silo.silo_code}`,
    values: { quantity: issueQuantityLiters, purpose: issuePurpose, flowMeter: issueFlowMeterRef, time: issueOpTimestamp },
    onRestore: (fields) => {
      if (fields.quantity !== undefined) setIssueQuantityLiters(fields.quantity);
      if (fields.purpose !== undefined) setIssuePurpose(fields.purpose);
      if (fields.flowMeter !== undefined) setIssueFlowMeterRef(fields.flowMeter);
      if (fields.time !== undefined) setIssueOpTimestamp(fields.time);
    },
  });

  const historyQuery = useQuery({
    queryKey: ['production', 'silo-issue-history', silo.id],
    queryFn: ({ signal }) =>
      fetchJson<{ history?: SiloIssueHistoryDef[] }>(`/api/production/silo-issue/history?siloId=${silo.id}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const issueHistory = useMemo(() => historyQuery.data?.history ?? [], [historyQuery.data]);
  const historyLoading = historyQuery.isPending;

  const parsedIssueLiters = Number(issueQuantityLiters) || 0;
  const currentStock = silo.current_stock_liters ?? 0;
  const previewRemaining = currentStock - parsedIssueLiters;
  const isOverIssue = parsedIssueLiters > currentStock;

  const handleRecordSiloIssue = async () => {
    const quantityNum = Number(issueQuantityLiters);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      toast.showError('Issue quantity must be a positive number greater than 0 Liters.', 'Validation Error');
      return;
    }

    if (silo.current_stock_liters !== null && quantityNum > silo.current_stock_liters) {
      toast.showError(
        `Issue quantity (${quantityNum.toLocaleString()} L) exceeds available physical stock (${silo.current_stock_liters.toLocaleString()} L).`,
        'Stock Error'
      );
      return;
    }

    setActionLoading(true);
    try {
      const clientRequestId = newClientRequestId();
      const res = await fetch('/api/production/silo-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siloId: silo.id,
          quantityLiters: quantityNum,
          operationalTimestamp: datetimeLocalToIso(issueOpTimestamp) || undefined,
          purpose: issuePurpose,
          flowMeterReference: issueFlowMeterRef,
          clientRequestId,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.showSuccess(
          `Milk issue of ${quantityNum.toLocaleString()} L recorded from ${silo.silo_code}.`,
          'Silo Issue Recorded'
        );
        issueDraft.clear();
        setIssueQuantityLiters('');
        setIssueFlowMeterRef('');
        queryClient.invalidateQueries({ queryKey: ['production', 'silo-issue-history'] });
        onRecorded();
      } else {
        toast.showError(data.error || 'Failed to record silo milk issue', 'Silo Issue Error');
      }
    } catch (_err) {
      toast.showError('Network error recording silo milk issue', 'Network Error');
    } finally {
      setActionLoading(false);
    }
  };

  const inputClass =
    'w-full min-h-11 px-4 py-2 text-xs font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary';

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent showClose={false}>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-6 text-foreground">
          <DrawerTitle className="sr-only">Record Outbound Milk Issue</DrawerTitle>
          <div className="flex items-start justify-between gap-2 border-b border-border-strong pb-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">Record Outbound Milk Issue</h3>
              <p className="text-xs text-secondary-foreground font-semibold mt-0.5">
                Silo: <strong className="tabular-nums text-foreground">{silo.silo_code}</strong> ({silo.silo_name})
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`hidden sm:inline px-3 py-1 rounded-md text-xs tabular-nums font-semibold ${
                  silo.is_active ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {silo.is_active ? 'Active Silo' : 'Inactive Silo'}
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-secondary-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="bg-card border-border grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Physical Stock</span>
              <span className="text-base font-semibold text-primary">
                {silo.current_stock_liters !== null ? `${silo.current_stock_liters.toLocaleString()} L` : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">After-Issue Stock Preview</span>
              <span className={`text-base font-semibold ${isOverIssue ? 'text-rose-600' : 'text-emerald-800'}`}>
                {previewRemaining.toLocaleString()} L
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                Issue Quantity (Liters) <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                step="1"
                value={issueQuantityLiters}
                onChange={(e) => setIssueQuantityLiters(e.target.value)}
                placeholder="e.g. 5000"
                className={`${inputClass} tabular-nums`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-foreground">Purpose / Destination</label>
                <input
                  type="text"
                  value={issuePurpose}
                  onChange={(e) => setIssuePurpose(e.target.value)}
                  placeholder="e.g. UHT Milk, Pasteurized Milk"
                  className={inputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-foreground">Flow Meter Reference</label>
                <input
                  type="text"
                  value={issueFlowMeterRef}
                  onChange={(e) => setIssueFlowMeterRef(e.target.value)}
                  placeholder="e.g. FM-004"
                  className={`${inputClass} tabular-nums`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                Time <span className="text-rose-600">*</span>
              </label>
              <input
                type="datetime-local"
                value={issueOpTimestamp}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setIssueOpTimestamp(e.target.value)}
                className={`${inputClass} tabular-nums`}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={actionLoading || !issueQuantityLiters || isOverIssue}
            onClick={handleRecordSiloIssue}
            className="w-full min-h-11 py-4 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center space-x-2"
          >
            {actionLoading ? <span>Recording issue…</span> : <> <MinusCircle className="w-4 h-4" /> <span>Record silo issue</span> </>}
          </button>

          {/* Compact Recent Issues (collapsible) */}
          <details className="group rounded-xl bg-card border border-border" open>
            <summary className="min-h-11 flex cursor-pointer select-none items-center justify-between px-4 text-xs font-semibold text-foreground">
              <span>Recent issues: {silo.silo_code}</span>
              <span className="text-xs text-muted-foreground tabular-nums">Last 10</span>
            </summary>
            <div className="border-t border-border-strong p-4">
              {historyLoading ? (
                <SkeletonList count={2} />
              ) : issueHistory.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground font-semibold">No issues</div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {issueHistory.map((h) => (
                    <div key={h.id} className="bg-card border-border p-3 rounded-xl border flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-foreground block">{h.purpose}</span>
                        <span className="text-xs text-muted-foreground tabular-nums font-semibold">
                          {h.time_formatted} | {h.operator_name} {h.flow_meter_reference ? `| ${h.flow_meter_reference}` : ''}
                        </span>
                      </div>
                      <span className="tabular-nums font-semibold text-rose-700 text-sm">
                        -{h.quantity_liters.toLocaleString()} L
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
