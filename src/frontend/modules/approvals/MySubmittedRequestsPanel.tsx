'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SubmitterRequestItem } from '@/backend/services/approvals/submitterRequestService';

interface MySubmittedRequestsPanelProps {
  onClose?: () => void;
  className?: string;
}

export function MySubmittedRequestsPanel({ onClose, className }: MySubmittedRequestsPanelProps) {
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-submitted-requests'],
    queryFn: async () => {
      const res = await fetchJson<{ items: SubmitterRequestItem[] }>('/api/approvals/my-requests');
      return res.items || [];
    },
    refetchInterval: 15_000,
  });

  const items = data || [];
  const filtered = items.filter((item) => {
    if (filterStatus === 'PENDING') return item.status === 'PENDING';
    if (filterStatus === 'RESOLVED') return item.status !== 'PENDING';
    return true;
  });

  return (
    <div className={`space-y-4 ${className || ''}`}>
      {/* Header and Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-base font-bold text-foreground">My Submitted Requests</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time status tracking for exceptions, quality overrides, and clearance requests sent to management
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/50 border border-border rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setFilterStatus('ALL')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filterStatus === 'ALL'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('PENDING')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filterStatus === 'PENDING'
                  ? 'bg-amber-100 text-amber-900 shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pending ({items.filter((x) => x.status === 'PENDING').length})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('RESOLVED')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filterStatus === 'RESOLVED'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Decided ({items.filter((x) => x.status !== 'PENDING').length})
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-8 text-xs font-semibold"
          >
            Refresh
          </Button>

          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 text-xs font-semibold"
            >
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="flex items-center justify-center p-12 text-xs font-semibold text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> Loading submitted requests…
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs font-semibold text-destructive">
          Could not load your submitted requests. Please try again.
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-1">
          <p className="text-sm font-semibold text-foreground">No requests found</p>
          <p className="text-xs text-muted-foreground">
            {filterStatus === 'PENDING'
              ? 'You have no pending requests waiting for manager review.'
              : 'You have not submitted any exceptions or approval requests yet.'}
          </p>
        </div>
      )}

      {/* Requests List */}
      <div className="space-y-2.5">
        {filtered.map((item) => {
          let badgeClass = 'bg-slate-100 text-slate-800 border-slate-200';
          if (item.status === 'PENDING') {
            badgeClass = 'bg-amber-50 text-amber-900 border-amber-300';
          } else if (item.status === 'APPROVED') {
            badgeClass = 'bg-emerald-50 text-emerald-900 border-emerald-300';
          } else if (item.status === 'REJECTED' || item.status === 'RETURNED') {
            badgeClass = 'bg-rose-50 text-rose-900 border-rose-300';
          }

          return (
            <div
              key={item.id}
              className="rounded-xl border border-border bg-card p-3.5 shadow-2xs space-y-2.5 transition hover:border-border/80"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {item.categoryLabel}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {item.referenceNumber}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.summary}</p>
                </div>

                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeClass}`}
                >
                  {item.statusLabel}
                </span>
              </div>

              {/* Reviewer / Decision Details */}
              <div className="rounded-lg bg-muted/40 p-2.5 text-xs space-y-1 border border-border/50">
                <div className="flex flex-wrap items-center justify-between text-muted-foreground gap-1 text-[11px]">
                  <span>
                    Sent: <strong className="text-foreground">{new Date(item.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> on {new Date(item.submittedAt).toLocaleDateString()}
                  </span>
                  <span>
                    Approver: <strong className="text-foreground">{item.reviewerRole}</strong>
                    {item.reviewerName ? ` (${item.reviewerName})` : ''}
                  </span>
                </div>

                {item.reviewedAt && (
                  <div className="pt-1 border-t border-border/50 text-[11px] text-muted-foreground">
                    Decided on {new Date(item.reviewedAt).toLocaleDateString()} at {new Date(item.reviewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}

                {item.reviewRemarks && (
                  <div className="text-xs font-medium text-foreground pt-0.5">
                    Manager Remarks: <span className="italic font-normal text-muted-foreground">"{item.reviewRemarks}"</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
