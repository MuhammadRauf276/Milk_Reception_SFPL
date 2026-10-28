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
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { Pager, pageCount, paginate } from '../dashboard/components/Pager';
import { STAGE_LABELS, cleanEntityTitle, formatWaitingLabel } from './approvalInboxShared';

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
    <div className="flex-1 flex flex-col bg-slate-50/50 w-full overflow-hidden">
      {/* Search Bar */}
      <div className="p-3 sm:p-4 bg-white border-b border-border flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
            className="w-full min-h-11 pl-9 pr-9 py-2 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary transition"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchQuery('');
                setPage(1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded min-h-11 min-w-11"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500 font-semibold shrink-0">
          {filteredItems.length} {filteredItems.length === 1 ? 'record' : 'records'}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {loading && !refreshing ? (
          <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
            <Spinner className="w-6 h-6 text-primary" />
            <p className="text-xs text-slate-500 font-medium">Loading approvals…</p>
          </div>
        ) : error ? (
          <div className="bg-card border-border p-6 max-w-md mx-auto text-center space-y-2 rounded-2xl border text-rose-700 text-xs shadow-xs">
            <AlertTriangle className="w-6 h-6 mx-auto text-rose-500" />
            <p className="font-bold text-sm">Failed to Load Approvals</p>
            <p className="text-slate-600">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 min-h-11 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs shadow-xs transition"
            >
              Try Again
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-card border-border p-12 max-w-md mx-auto text-center space-y-3 rounded-2xl border shadow-2xs">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-foreground">
              {statusFilter === 'PENDING' ? 'All clear' : 'No history'}
            </h3>
          </div>
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
                    'bg-card rounded-xl border p-4 shadow-2xs hover:shadow-xs transition flex flex-col justify-between gap-3 cursor-pointer group',
                    isSelected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-slate-300'
                  )}
                >
                  {/* Top Line: Reference, Stage, Status */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-sm text-foreground truncate group-hover:text-primary transition">
                          {item.referenceNumber}
                        </span>
                        <span className={'px-2 py-0.5 rounded text-[10px] font-bold border border-border bg-subtle text-slate-600 shrink-0'}>
                          {stageMeta.badge}
                        </span>
                      </div>

                      {isPending ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border shrink-0',
                            item.slaStatus === 'BREACHED'
                              ? 'bg-rose-50 text-rose-800 border-rose-300 animate-pulse'
                              : item.slaStatus === 'WARNING'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          )}
                        >
                          {item.slaStatus === 'BREACHED' ? (
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                          ) : (
                            <Clock className="w-3 h-3 text-slate-500" />
                          )}
                          {formatWaitingLabel(item.waitingMinutes)}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0',
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

                    <p className="text-xs font-semibold text-slate-800 line-clamp-1">{cleanEntityTitle(item.details.entityTitle)}</p>
                    <p className="text-[11px] text-slate-500">
                      Source: <strong className="text-slate-700">{item.sourceName || 'ZMCC Area'}</strong>
                    </p>
                  </div>

                  {/* Middle Line: Submitter or Decision info */}
                  <div className="text-xs text-slate-600 pt-2 border-t border-slate-100 space-y-1">
                    {isPending ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>Submitted by: <strong className="text-slate-700">{item.submittedBy.name}</strong></span>
                        <span>({getRoleLabel(item.submittedBy.role)})</span>
                        {item.submittedBy.isDelegated && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-subtle text-slate-600 border border-border">
                            Delegated
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">
                        <span>Decided by: <strong className="text-slate-700">{item.decision?.decidedBy || 'Supervisor'}</strong></span>
                        {item.decision?.decidedAt && (
                          <span className="ml-1.5 text-slate-400">· {new Date(item.decision.decidedAt).toLocaleString()}</span>
                        )}
                        {item.decision?.remarks && (
                          <p className="text-slate-700 italic mt-1 line-clamp-1">&ldquo;{item.decision.remarks}&rdquo;</p>
                        )}
                      </div>
                    )}

                    {/* Chips for exceptions */}
                    {item.reasonChips && item.reasonChips.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        {item.reasonChips.slice(0, 3).map((chip, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-subtle text-slate-600 border border-border"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bottom Line: Clean Action Trigger */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div className="text-[11px] text-slate-400">
                      {isPending
                        ? item.canDecide
                          ? 'Actionable'
                          : 'Audit only'
                        : 'Audit trail archived'}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(item.id);
                      }}
                      className={cn(
                        'min-h-11 px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs',
                        isPending && item.canDecide
                          ? 'bg-primary text-white hover:bg-primary/90'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      )}
                    >
                      <span>{isPending ? (item.canDecide ? 'Review' : 'View') : 'View'}</span>
                      
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="p-3 bg-white border-t border-border shrink-0">
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
