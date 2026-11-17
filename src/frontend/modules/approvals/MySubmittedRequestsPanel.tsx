'use client';

import { getRoleLabel } from '@core/roles/labels';
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Send } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { SubmitterRequestItem } from '@/backend/services/approvals/submitterRequestService';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { formatDateTime } from '@/lib/format';
import { InfoTip } from '@/components/ui/info-tip';

interface MySubmittedRequestsPanelProps {
  onClose?: () => void;
  className?: string;
  /** Inside another screen that already has a title: a smaller heading and no Close button. */
  embedded?: boolean;
}

type StatusFilter = 'ALL' | 'PENDING' | 'RESOLVED';

function badgeClass(status: SubmitterRequestItem['status']): string {
  if (status === 'PENDING') return 'bg-amber-50 text-amber-900 border-amber-300';
  if (status === 'APPROVED') return 'bg-emerald-50 text-emerald-900 border-emerald-300';
  if (status === 'REJECTED' || status === 'RETURNED') return 'bg-rose-50 text-rose-900 border-rose-300';
  return 'bg-muted text-foreground border-border';
}

function StatusBadge({ item }: { item: SubmitterRequestItem }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${badgeClass(item.status)}`}>{item.statusLabel}</span>;
}

function vehicleOf(item: SubmitterRequestItem): string | null {
  const v = item.metadata?.vehicleNumber;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Exception and approval requests the signed-in person sent, as a table. The full request opens with Inspect. */
export function MySubmittedRequestsPanel({ onClose, className, embedded = false }: MySubmittedRequestsPanelProps) {
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('ALL');
  const [open, setOpen] = useState<SubmitterRequestItem | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-submitted-requests'],
    queryFn: async () => {
      const res = await fetchJson<{ items: SubmitterRequestItem[] }>('/api/approvals/my-requests');
      return res.items || [];
    },
    refetchInterval: 30_000,
  });

  const items = useMemo(() => data || [], [data]);
  const pending = useMemo(() => items.filter((x) => x.status === 'PENDING').length, [items]);
  const filtered = useMemo(
    () => items.filter((item) => (filterStatus === 'PENDING' ? item.status === 'PENDING' : filterStatus === 'RESOLVED' ? item.status !== 'PENDING' : true)),
    [items, filterStatus]
  );

  const columns = useMemo<DataColumn<SubmitterRequestItem>[]>(
    () => [
      {
        key: 'reference',
        header: 'Number',
        label: 'Number',
        primary: true,
        cell: (item) => (
          <span className="font-semibold text-foreground break-words">
            {item.referenceNumber}
            {vehicleOf(item) ? <span className="font-normal text-secondary-foreground"> · {vehicleOf(item)}</span> : null}
          </span>
        ),
      },
      { key: 'sent', header: 'Sent', label: 'Sent', cardAlways: true, cell: (item) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(item.submittedAt)}</span> },
      { key: 'type', header: 'Type', label: 'Type', cell: (item) => item.categoryLabel },
      { key: 'approver', header: 'Approver', label: 'Approver', cell: (item) => getRoleLabel(item.reviewerRole) },
      { key: 'status', header: 'Status', label: 'Status', cardAlways: true, cell: (item) => <StatusBadge item={item} /> },
      {
        key: 'actions',
        header: '',
        label: 'Inspect',
        actions: true,
        align: 'right',
        cell: (item) => (
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setOpen(item)}>
            <Eye aria-hidden />
            Inspect
          </Button>
        ),
      },
    ],
    []
  );

  const filterButton = (value: StatusFilter, label: string) => (
    <Button
      type="button"
      size="sm"
      variant={filterStatus === value ? 'default' : 'outline'}
      aria-pressed={filterStatus === value}
      className="min-h-11 text-xs font-semibold"
      onClick={() => setFilterStatus(value)}
    >
      {label}
    </Button>
  );

  return (
    <div className={`space-y-3 ${className || ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {embedded ? (
            <h2 className="text-sm font-semibold text-foreground">Sent for approval</h2>
          ) : (
            <h3 className="text-base font-semibold text-foreground">My requests</h3>
          )}
          <InfoTip label="About sent requests" className="-my-2" text="Vehicle and quality exception requests sent to your upper head." />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          {filterButton('ALL', `All (${items.length})`)}
          {filterButton('PENDING', `Pending (${pending})`)}
          {filterButton('RESOLVED', `Decided (${items.length - pending})`)}
          <Button variant="outline" size="sm" onClick={() => refetch()} className="min-h-11 text-xs font-semibold">
            Refresh
          </Button>
          {onClose && !embedded && (
            <Button variant="ghost" size="sm" onClick={onClose} className="min-h-11 text-xs font-semibold">
              Close
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(item) => String(item.id)}
        loading={isLoading}
        error={isError ? 'Could not load requests. Try again.' : null}
        onRetry={() => void refetch()}
        noun="requests"
        emptyTitle="No requests found"
        emptyDescription={
          filterStatus === 'PENDING'
            ? 'You have no pending requests waiting for manager review.'
            : 'You have not submitted any exceptions or approval requests yet.'
        }
      />

      <ZmccDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.referenceNumber ?? 'Request'}
        subtitle={open ? `${open.categoryLabel}${vehicleOf(open) ? ` · Vehicle ${vehicleOf(open)}` : ''}` : undefined}
        icon={<Send className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />}
      >
        {open && (
          <div className="space-y-3 text-sm">
            <StatusBadge item={open} />
            <p className="break-words text-foreground">{open.summary}</p>
            {open.reasons?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground">Why it was sent</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-secondary-foreground">
                  {open.reasons.map((r) => (
                    <li key={r} className="break-words">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2 border-t border-border pt-3">
              <div>
                <dt className="text-xs text-muted-foreground">Sent</dt>
                <dd className="font-medium tabular-nums">{formatDateTime(open.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Approver</dt>
                <dd className="font-medium break-words">
                  {getRoleLabel(open.reviewerRole)}
                  {open.reviewerName ? ` (${open.reviewerName})` : ''}
                </dd>
              </div>
              {open.reviewedAt && (
                <div>
                  <dt className="text-xs text-muted-foreground">Decided</dt>
                  <dd className="font-medium tabular-nums">{formatDateTime(open.reviewedAt)}</dd>
                </div>
              )}
            </dl>
            {open.reviewRemarks && (
              <p className="break-words">
                <span className="text-muted-foreground">Manager remarks: </span>
                {open.reviewRemarks}
              </p>
            )}
          </div>
        )}
      </ZmccDrawer>
    </div>
  );
}
