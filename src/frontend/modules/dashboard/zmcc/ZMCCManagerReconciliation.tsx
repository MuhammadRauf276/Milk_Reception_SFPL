'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
} from './zmccManagerHelpers';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { SupplyChainLossCard } from '@/frontend/modules/dashboard/components/SupplyChainLossCard';
import {
  ArrowRightLeft,
  Search,
  AlertTriangle,
  FlaskConical,
  ExternalLink,
  ChevronDown,
  Warehouse,
} from 'lucide-react';

export type ReconciliationFilter =
  | 'ALL'
  | 'COMPLETED'
  | 'RECEIPT_PENDING'
  | 'HAS_QUANTITY_DIFF'
  | 'HAS_TS_DIFF'
  | 'HAS_REJECTION';

interface ZMCCManagerReconciliationProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pagination?: {
    page: number;
    totalPages: number;
    totalRecords: number;
    hasMore: boolean;
  };
}

const FILTER_OPTIONS: { id: ReconciliationFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'RECEIPT_PENDING', label: 'Pending' },
  { id: 'HAS_QUANTITY_DIFF', label: 'Qty diff' },
  { id: 'HAS_TS_DIFF', label: 'TS diff' },
  { id: 'HAS_REJECTION', label: 'QA Rejected' },
];

export const ZMCCManagerReconciliation: React.FC<ZMCCManagerReconciliationProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  pagination,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<ReconciliationFilter>('ALL');
  const [expandedVisitId, setExpandedVisitId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  // Build groups and derive reconciliation models
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const reconciliationItems = useMemo(() => deriveVehicleReconciliationItems(groups), [groups]);

  // Consume canonical reconciliation values (no React-side recalculation)
  const enrichedItems = useMemo(() => {
    return reconciliationItems.map((item) => {
      const tsDelta = item.at13TsVarianceLiters;
      const tsDeltaText = item.at13TsVarianceText;
      const hasTsDifference = item.hasTsDifference;

      return {
        ...item,
        tsDelta,
        tsDeltaText,
        hasTsDifference,
      };
    });
  }, [reconciliationItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return enrichedItems.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVehicle = item.vehicleNumber.toLowerCase().includes(q);
        const matchToken = item.tokenNumber ? item.tokenNumber.toLowerCase().includes(q) : false;
        if (!matchVehicle && !matchToken) return false;
      }

      // 2. Filter State
      if (filterState === 'ALL') return true;
      if (filterState === 'COMPLETED') return item.isCompletedReceipt;
      if (filterState === 'RECEIPT_PENDING') return item.isReceiptPending;
      if (filterState === 'HAS_QUANTITY_DIFF') return item.hasQuantityDifference;
      if (filterState === 'HAS_TS_DIFF') return item.hasTsDifference;
      if (filterState === 'HAS_REJECTION') return item.hasRejection;

      return true;
    });
  }, [enrichedItems, searchQuery, filterState]);

  // Summary Metrics
  const summary = useMemo(() => {
    const total = enrichedItems.length;
    const completed = enrichedItems.filter((i) => i.isCompletedReceipt).length;
    const pendingReceipt = enrichedItems.filter((i) => i.isReceiptPending).length;
    const qtyDiffCount = enrichedItems.filter((i) => i.hasQuantityDifference).length;
    const tsDiffCount = enrichedItems.filter((i) => i.hasTsDifference).length;
    const rejectedCount = enrichedItems.filter((i) => i.hasRejection).length;
    return { total, completed, pendingReceipt, qtyDiffCount, tsDiffCount, rejectedCount };
  }, [enrichedItems]);

  const showKpiPlaceholders = isLoading || error != null;

  type ReconItem = (typeof enrichedItems)[number];
  const deltaClass = (v: number) => (v === 0 ? 'text-secondary-foreground' : v > 0 ? 'text-emerald-800' : 'text-rose-800');
  const columns: DataColumn<ReconItem>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      primary: true,
      cell: (item) => {
        const isExpanded = expandedVisitId === item.visitId;
        return (
          <div className="flex items-center space-x-1.5 tabular-nums">
            <button
              type="button"
              onClick={() => setExpandedVisitId(isExpanded ? null : item.visitId)}
              className="p-1 rounded hover:bg-muted text-muted-foreground min-h-11 min-w-11"
              title={isExpanded ? 'Collapse row' : 'Expand details'}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            <div>
              <span className="font-semibold text-foreground block">{item.vehicleNumber}</span>
              {item.tokenNumber && <span className="text-xs text-muted-foreground block">Tk: {item.tokenNumber}</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'dispatchGross',
      header: 'Dispatch Gross (L)',
      label: 'Dispatch gross (L)',
      align: 'right',
      cell: (item) => <span className="tabular-nums font-semibold text-foreground">{item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}</span>,
    },
    {
      key: 'plantReceived',
      header: 'Plant Received (L)',
      label: 'Plant received (L)',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.physicalReceivedLiters != null ? (
            <span className="text-emerald-800">{item.physicalReceivedLiters.toLocaleString()} L</span>
          ) : item.isReceiptPending ? (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-sans font-semibold">Receipt Pending</span>
          ) : (
            <span className="text-muted-foreground font-sans text-xs">Pending Reception</span>
          )}
        </span>
      ),
    },
    {
      key: 'grossDelta',
      header: 'Gross Delta',
      label: 'Gross delta',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.grossVarianceLiters != null ? (
            <span className={deltaClass(item.grossVarianceLiters)}>{item.grossVarianceText}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'grossDeltaPct',
      header: 'Gross Delta %',
      label: 'Gross delta %',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.grossVariancePercent != null ? (
            <span className={deltaClass(item.grossVariancePercent)}>{item.grossVariancePercentText}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'dispatch13',
      header: 'Dispatch @13TS',
      label: 'Dispatch @13TS',
      align: 'right',
      cell: (item) => <span className="tabular-nums text-foreground">{item.dispatch13TsLiters != null ? `${item.dispatch13TsLiters.toLocaleString()} L` : 'Unavailable'}</span>,
    },
    {
      key: 'plant13',
      header: 'Plant @13TS',
      label: 'Plant @13TS',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.plant13TsLiters != null ? (
            <span className="text-foreground">{item.plant13TsLiters.toLocaleString()} L</span>
          ) : item.isHistoricalReceiptWithoutCommercialSnapshot ? (
            <span className="text-muted-foreground font-sans text-xs font-semibold">Unavailable</span>
          ) : item.isReceiptPending ? (
            <span className="text-muted-foreground font-sans text-xs">Pending</span>
          ) : (
            <span className="text-muted-foreground font-sans text-xs">Pending</span>
          )}
        </span>
      ),
    },
    {
      key: 'delta13',
      header: '@13TS Delta',
      label: '@13TS delta',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.at13TsVarianceLiters != null ? (
            <span className={deltaClass(item.at13TsVarianceLiters)}>{item.at13TsVarianceText}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'delta13Pct',
      header: '@13TS Delta %',
      label: '@13TS delta %',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-semibold">
          {item.at13TsVariancePercent != null ? (
            <span className={deltaClass(item.at13TsVariancePercent)}>{item.at13TsVariancePercentText}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'qa',
      header: 'QA Summary',
      label: 'QA summary',
      align: 'center',
      cell: (item) => {
        const qaSummary = item.group.lifecycle.portionQA;
        return (
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-sans font-semibold ${
              qaSummary.badgeType === 'ALL_ACCEPTED'
                ? 'bg-emerald-100 text-emerald-800'
                : qaSummary.badgeType === 'ALL_REJECTED' || qaSummary.badgeType === 'MIXED'
                ? 'bg-rose-100 text-rose-800'
                : qaSummary.badgeType === 'HAS_HOLD'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-muted text-secondary-foreground'
            }`}
          >
            {qaSummary.summaryText}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      align: 'center',
      cell: (item) => (
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-sans font-semibold  ${
            item.isCompletedReceipt
              ? 'bg-emerald-100 text-emerald-800'
              : item.isReceiptPending
              ? 'bg-amber-100 text-amber-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {item.isCompletedReceipt ? 'Final Receipt' : item.isReceiptPending ? 'Pending' : item.lifecycleStatus}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      label: 'Action',
      actions: true,
      align: 'center',
      cell: (item) => (
        <button
          type="button"
          onClick={() => onInspectDetails(item.group.primaryLog)}
          className="inline-flex items-center space-x-1 px-3 py-1 rounded bg-subtle border border-border text-xs font-sans font-semibold text-primary hover:bg-blue-50 transition min-h-11 min-w-11"
          title="Inspect full details"
        >
          <span>Inspect</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6" role="region" aria-label="ZMCC Manager Reconciliation">
      {/* 3-Tier Supply Chain Loss Hierarchy Card */}
      <SupplyChainLossCard />

      {/* 1. Header & Summary Banner */}
      <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Reconciliation Ledger: {assignedSourceName}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-action/10 transition-[color,background-color,border-color,box-shadow,opacity,transform] disabled:opacity-50 min-h-11"
              >
                <span>{isLoading ? 'Syncing…' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="bg-card border-border flex items-center justify-between p-3 rounded-xl border text-xs text-amber-800">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Reconciliation metrics, filters, and search below apply to the visible page ({pagination.page} of {pagination.totalPages}). The full query contains {pagination.totalRecords} visits.
              </span>
            </div>
            <span className="text-xs font-semibold text-amber-700">Bounded page metrics</span>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-2 tabular-nums">
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-muted-foreground block font-semibold">Visits on Page</span>
            <span className="text-lg font-semibold text-foreground">
              {showKpiPlaceholders ? '—' : summary.total}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-emerald-700 block font-semibold">Completed on Page</span>
            <span className="text-lg font-semibold text-emerald-900">
              {showKpiPlaceholders ? '—' : summary.completed}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-amber-700 block font-semibold">Pending on Page</span>
            <span className="text-lg font-semibold text-amber-900">
              {showKpiPlaceholders ? '—' : summary.pendingReceipt}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-secondary-foreground block font-semibold">Qty Delta on Page</span>
            <span className="text-lg font-semibold text-foreground">
              {showKpiPlaceholders ? '—' : summary.qtyDiffCount}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-blue-700 block font-semibold">13% TS Delta on Page</span>
            <span className="text-lg font-semibold text-blue-900">
              {showKpiPlaceholders ? '—' : summary.tsDiffCount}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-rose-700 block font-semibold">QA Rejections on Page</span>
            <span className="text-lg font-semibold text-rose-900">
              {showKpiPlaceholders ? '—' : summary.rejectedCount}
            </span>
          </div>
        </div>

        {/* 2. Controls & Filter Pills */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
          {/* Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1.5 max-w-full">
            {FILTER_OPTIONS.map((opt) => {
              const active = filterState === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilterState(opt.id)}
                  className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold shrink-0 transition-[color,background-color,border-color,box-shadow,opacity,transform] ${
                    active
                      ? 'bg-primary text-white shadow-2xs'
                      : 'bg-subtle text-secondary-foreground hover:bg-muted border border-border/80'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search"
              aria-label="Search current page vehicle or token"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-subtle border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary min-h-11"
            />
          </div>
        </div>
      </div>

      {/* 3. Error Alert */}
      {error && (
        <div className="bg-card border-border p-6 rounded-2xl border text-center space-y-2 animate-panel-in" role="alert">
          <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-semibold text-rose-800">Reconciliation did not load</h4>
          <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
        </div>
      )}

      {/* 4. Loading Skeleton */}
      {isLoading && enrichedItems.length === 0 && (
        <div className="p-8 rounded-2xl bg-card border border-border/80 space-y-4 animate-pulse">
          <div className="h-6 bg-muted rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-10 rounded-xl bg-card border border-border/80 text-center space-y-2">
          <ArrowRightLeft className="w-8 h-8 text-neutral-300 mx-auto" />
          <h4 className="text-sm font-semibold text-secondary-foreground">No Reconciliation Records Found</h4>
          <p className="text-xs text-muted-foreground">
            No records
          </p>
        </div>
      )}

      {/* 6. Canonical Reconciliation Table */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <DataTable
          columns={columns}
          rows={paginate(filteredItems, Math.min(page, pageCount(filteredItems.length)))}
          getRowId={(item) => String(item.visitId)}
          tableFrom="lg"
          rowClassName={(item) => (expandedVisitId === item.visitId ? 'bg-blue-50/30' : undefined)}
          renderExpanded={(item) =>
            expandedVisitId === item.visitId ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs animate-panel-in">
                  {/* Scale & Silo Weights */}
                  <div className="bg-card border-border p-3 rounded-lg border space-y-2">
                    <div className="flex items-center space-x-2 font-sans font-semibold text-foreground pb-1 border-b border-border">
                      <Warehouse className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Weighbridge & Destination Silo</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 tabular-nums text-xs">
                      <div>
                        <span className="text-xs text-muted-foreground font-sans block">1st Weight (Gross):</span>
                        <span className="font-semibold text-foreground">
                          {item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground font-sans block">2nd Weight (Tare):</span>
                        <span className="font-semibold text-foreground">
                          {item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground font-sans block">Net Milk Weight:</span>
                        <span className="font-semibold text-blue-900">
                          {item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="pt-1 text-xs">
                      <span className="text-xs text-muted-foreground font-sans">Destination Silo: </span>
                      <span className="font-semibold text-foreground">{item.destinationSilo || '—'}</span>
                    </div>
                  </div>

                  <div className="bg-card border-border p-3 rounded-lg border space-y-2">
                    <div className="flex items-center space-x-2 font-sans font-semibold text-foreground pb-1 border-b border-border">
                      <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Portion QA Breakdown ({item.portions.length} Portions)</span>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {item.portions.map((p, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between py-1 px-2 rounded bg-subtle text-xs"
                        >
                          <span className="font-semibold text-secondary-foreground">{p.portionNumber}</span>
                          <span className="text-secondary-foreground">
                            {`Fat: ${p.dispatchFat ?? '—'}% / ${p.plantFat ?? '—'}% · LR: ${p.dispatchLr ?? '—'} / ${p.plantLr ?? '—'}`}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-sans font-semibold ${
                              p.qaDecision === 'ACCEPTED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.qaDecision === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-muted text-secondary-foreground'
                            }`}
                          >
                            {p.qaDecision}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
            ) : null
          }
          footer={<Pager page={Math.min(page, pageCount(filteredItems.length))} totalPages={pageCount(filteredItems.length)} total={filteredItems.length} onPageChange={setPage} />}
        />
      )}
    </div>
  );
};
