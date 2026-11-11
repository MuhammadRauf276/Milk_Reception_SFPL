'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  X,
  XCircle,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import type { UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { SkeletonList } from '@/components/ui/loaders';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { Pager, pageCount, paginate } from '../dashboard/components/Pager';
import { STAGE_LABELS, cleanEntityTitle, formatWaitingLabel } from './approvalInboxShared';
import { BriefText } from '@/components/ui/brief-text';
import { InfoTip } from '@/components/ui/info-tip';

export function filterApprovalItems(
  items: UnifiedApprovalItem[] | null | undefined,
  searchQuery: string
): UnifiedApprovalItem[] {
  if (!items || !Array.isArray(items)) return [];
  if (!searchQuery.trim()) return items;
  const q = searchQuery.toLowerCase();
  return items.filter(
    (item) =>
      (item.referenceNumber && item.referenceNumber.toLowerCase().includes(q)) ||
      (item.submittedBy?.name && item.submittedBy.name.toLowerCase().includes(q)) ||
      (item.sourceName && item.sourceName.toLowerCase().includes(q)) ||
      (item.details?.entityTitle && item.details.entityTitle.toLowerCase().includes(q)) ||
      (item.details?.vehicleNumber && item.details.vehicleNumber.toLowerCase().includes(q)) ||
      (item.decision?.decidedBy && item.decision.decidedBy.toLowerCase().includes(q))
  );
}

export interface ApprovalQueueListProps {
  items: UnifiedApprovalItem[];
  selectedItemId: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  statusFilter: 'PENDING' | 'DECIDED';
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function ApprovalQueueList({
  items,
  selectedItemId,
  loading,
  refreshing,
  error,
  statusFilter,
  onSelect,
  onRetry,
}: ApprovalQueueListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const [page, setPage] = useState(1);

  const filteredItems = useMemo(
    () => filterApprovalItems(items, debouncedSearch),
    [items, debouncedSearch]
  );
  const totalPages = pageCount(filteredItems.length);
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => paginate(filteredItems, currentPage),
    [filteredItems, currentPage]
  );

  return (
    <div className="flex-1 flex flex-col bg-subtle/50 w-full overflow-hidden">
      {/* Search Bar */}
      <div className="p-3 sm:p-4 bg-card border-b border-border flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder={
              statusFilter === 'PENDING'
                ? 'Search pending reference, shop, tanker…'
                : 'Search audit history by reference, approver, shop…'
            }
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full min-h-11 pl-9 pr-9 py-2 text-xs bg-subtle hover:bg-muted/70 focus:bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary transition"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchQuery('');
                setPage(1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-secondary-foreground rounded min-h-11 min-w-11"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="text-xs text-muted-foreground font-semibold shrink-0">
          {filteredItems.length} {filteredItems.length === 1 ? 'record' : 'records'}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {loading && !refreshing ? (
          <SkeletonList count={4} />
        ) : error ? (
          <ErrorState title="Approvals did not load" description={error} onRetry={onRetry} />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title={statusFilter === 'PENDING' ? 'No pending approvals' : 'No history found'}
            description={
              statusFilter === 'PENDING'
                ? 'Nothing is waiting in your queue.'
                : 'No decided approval records match your current filter.'
            }
            className="mx-auto max-w-md"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pageItems.map((item) => {
              const stageMeta = STAGE_LABELS[item.stage];
              const isSelected = item.id === selectedItemId;
              const isPending = statusFilter === 'PENDING';

              return (
                <div
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'bg-card rounded-2xl border p-4 shadow-2xs hover:shadow-xs transition flex flex-col justify-between gap-3 cursor-pointer group',
                    isSelected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-border-strong'
                  )}
                >
                  {/* Top Line: Reference, Stage, Status */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm text-foreground break-words min-w-0 transition-colors">
                          {item.referenceNumber}
                        </span>
                        <span className={'px-2 py-0.5 rounded text-xs font-semibold border border-border bg-subtle text-secondary-foreground shrink-0'}>
                          {stageMeta.badge}
                        </span>
                      </div>

                      {isPending ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border shrink-0',
                            item.slaStatus === 'BREACHED'
                              ? 'bg-rose-50 text-rose-800 border-rose-300'
                              : item.slaStatus === 'WARNING'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : 'bg-muted text-secondary-foreground border-border'
                          )}
                        >
                          {item.slaStatus === 'BREACHED' ? (
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground" />
                          )}
                          {formatWaitingLabel(item.waitingMinutes)}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-3 py-0.5 rounded-md text-xs font-semibold border shrink-0',
                            item.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-rose-50 text-rose-800 border-rose-300'
                          )}
                        >
                          {item.status === 'APPROVED' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <XCircle className="w-3 h-3 text-rose-600" />
                          )}
                          {item.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-foreground break-words">{cleanEntityTitle(item.details.entityTitle)}</p>
                    <p className="text-xs text-muted-foreground">
                      Source: <strong className="text-secondary-foreground">{item.sourceName || 'ZMCC Area'}</strong>
                    </p>
                  </div>

                  {/* Middle Line: Submitter or Decision info */}
                  <div className="text-xs text-secondary-foreground pt-2 border-t border-border space-y-1">
                    {isPending ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Submitted by: <strong className="text-secondary-foreground">{item.submittedBy.name}</strong></span>
                        <span>({getRoleLabel(item.submittedBy.role)})</span>
                        {item.submittedBy.isDelegated && (
                          <span className="px-2 py-0.2 rounded text-xs font-semibold bg-subtle text-secondary-foreground border border-border">
                            Delegated
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        <span>Decided by: <strong className="text-secondary-foreground">{item.decision?.decidedBy || 'Supervisor'}</strong></span>
                        {item.decision?.decidedAt && (
                          <span className="ml-2 text-muted-foreground">· {formatDateTime(item.decision.decidedAt)}</span>
                        )}
                        {item.decision?.remarks && (
                          <p className="text-secondary-foreground mt-1 break-words">
                            <BriefText text={item.decision.remarks} label="Decision remarks" />
                          </p>
                        )}
                      </div>
                    )}

                    {/* Chips for exceptions */}
                    {item.reasonChips && item.reasonChips.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        {item.reasonChips.slice(0, 3).map((chip, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md text-xs font-semibold bg-subtle text-secondary-foreground border border-border"
                          >
                            {chip}
                          </span>
                        ))}
                        {item.details.reasons && item.details.reasons.length > 0 && (
                          <InfoTip label="Why it was sent" text={<ul className="list-disc space-y-1 pl-4">{item.details.reasons.map((r) => <li key={r}>{r}</li>)}</ul>} />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bottom Line: Clean Action Trigger */}
                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      {isPending ? (
                        item.canDecide ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Actionable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-secondary-foreground font-medium bg-muted px-2 py-0.5 rounded-md border border-border">
                            {item.disabledReason?.includes('You submitted') ? (
                              'Submitted by you'
                            ) : (
                              <BriefText text={item.disabledReason || 'Pending review'} label="In review" />
                            )}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Archived</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(item.id);
                      }}
                      className={cn(
                        'min-h-11 px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 border border-input bg-card text-foreground hover:bg-muted'
                      )}
                    >
                      <span>{isPending ? (item.canDecide ? 'Review & decide' : 'View details') : 'View details'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="p-3 bg-card border-t border-border shrink-0">
        <Pager
          page={currentPage}
          totalPages={totalPages}
          total={filteredItems.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
