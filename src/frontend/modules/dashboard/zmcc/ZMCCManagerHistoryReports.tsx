'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';
import {
  HistoryLifecycleFilter,
  HistoryQAFilter,
  HistoryReceiptFilter,
} from './zmccManagerTypes';
import {
  buildVehicleVisitGroups,
  deriveHistoryTransactionItems,
  filterHistoryTransactionItems,
  generateHistoryCsv,
} from './zmccManagerHelpers';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  History,
  Search,
  AlertTriangle,
  Download,
  Printer,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { SkeletonTable } from '@/components/ui/loaders';
import { ErrorPopup } from '@/components/ui/error-popup';

interface ZMCCManagerHistoryReportsProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  currentFromDate?: string;
  currentToDate?: string;
  onDateFilterChange?: (from: string | null, to: string | null) => void;
}

export const ZMCCManagerHistoryReports: React.FC<ZMCCManagerHistoryReportsProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  currentFromDate = '',
  currentToDate = '',
  onDateFilterChange,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lifecycleFilter, setLifecycleFilter] = useState<HistoryLifecycleFilter>('ALL');
  const [qaFilter, setQaFilter] = useState<HistoryQAFilter>('ALL');
  const [receiptFilter, setReceiptFilter] = useState<HistoryReceiptFilter>('ALL');
  const [page, setPage] = useState(1);

  // Build groups and derive history items
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const items = useMemo(() => deriveHistoryTransactionItems(groups), [groups]);

  // Filter items by search, lifecycle, QA, receipt, and Business Date range
  const filteredItems = useMemo(
    () =>
      filterHistoryTransactionItems(
        items,
        searchQuery,
        lifecycleFilter,
        qaFilter,
        receiptFilter,
        currentFromDate,
        currentToDate
      ),
    [items, searchQuery, lifecycleFilter, qaFilter, receiptFilter, currentFromDate, currentToDate]
  );

  // Client-side CSV export handler
  const handleExportCsv = useCallback(() => {
    if (filteredItems.length === 0) return;
    const csvData = generateHistoryCsv(filteredItems, assignedSourceName);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `zmcc_history_${assignedSourceName.replace(/\s+/g, '_').toLowerCase()}_${
      currentFromDate || 'all'
    }_to_${currentToDate || 'all'}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredItems, assignedSourceName, currentFromDate, currentToDate]);

  // Client-side Print handler
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  type HistoryItem = (typeof items)[number];
  const columns: DataColumn<HistoryItem>[] = [
    {
      key: 'businessDate',
      header: 'Business Date',
      label: 'Business date',
      primary: true,
      cell: (item) => <span className="tabular-nums font-semibold text-foreground">{item.businessDate || 'Pending plant completion'}</span>,
    },
    { key: 'vehicle', header: 'Vehicle #', label: 'Vehicle #', cell: (item) => <span className="tabular-nums font-semibold text-foreground">{item.vehicleNumber}</span> },
    { key: 'token', header: 'Token #', label: 'Token #', cell: (item) => <span className="tabular-nums text-secondary-foreground">{item.tokenNumber || '—'}</span> },
    {
      key: 'stage',
      header: 'Current Stage',
      label: 'Current stage',
      cell: (item) => (
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold  ${
            item.isComplete
              ? 'bg-emerald-100 text-emerald-800'
              : item.hasRejection
              ? 'bg-rose-100 text-rose-800'
              : item.hasHold
              ? 'bg-amber-100 text-amber-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {item.lifecycleStageLabel}
        </span>
      ),
    },
    {
      key: 'portionQa',
      header: 'Portion QA',
      label: 'Portion QA',
      cell: (item) => <span className="font-semibold text-secondary-foreground">{item.portionQASummaryText || `${item.portionCount} portions`}</span>,
    },
    {
      key: 'dispatchGross',
      header: 'Dispatch Gross',
      label: 'Dispatch gross',
      cell: (item) => <span className="tabular-nums font-semibold text-foreground">{item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}</span>,
    },
    {
      key: 'dispatch13',
      header: 'Dispatch @13TS',
      label: 'Dispatch @13TS',
      cell: (item) => <span className="tabular-nums font-semibold text-blue-900">{item.dispatch13TsLiters != null ? `${item.dispatch13TsLiters.toLocaleString()} L` : '—'}</span>,
    },
    {
      key: 'firstWeight',
      header: 'First Weight (Loaded Vehicle)',
      label: 'First weight',
      cell: (item) => <span className="tabular-nums text-secondary-foreground">{item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}</span>,
    },
    {
      key: 'secondWeight',
      header: 'Second Weight (After Unloading)',
      label: 'Second weight',
      cell: (item) => <span className="tabular-nums text-secondary-foreground">{item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}</span>,
    },
    {
      key: 'netWeight',
      header: 'Net weight',
      label: 'Net milk weight',
      cell: (item) => <span className="tabular-nums font-semibold text-primary">{item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}</span>,
    },
    {
      key: 'received',
      header: 'Physical Received',
      label: 'Physical received',
      cell: (item) => <span className="tabular-nums font-semibold text-emerald-800">{item.physicalReceivedLiters != null ? `${item.physicalReceivedLiters.toLocaleString()} L` : '—'}</span>,
    },
    {
      key: 'received13',
      header: 'Received @13TS',
      label: 'Received @13TS',
      cell: (item) => <span className="tabular-nums font-semibold text-emerald-900">{item.plant13TsLiters != null ? `${item.plant13TsLiters.toLocaleString()} L` : '—'}</span>,
    },
    { key: 'silo', header: 'Silo', label: 'Silo', cell: (item) => <span className="font-semibold text-foreground">{item.destinationSilo || '—'}</span> },
    {
      key: 'finalReceipt',
      header: 'Final receipt',
      label: 'Final receipt',
      cell: (item) => <span className="font-sans text-secondary-foreground">{item.finalReceiptTimestamp ? formatOperationalDatetime(item.finalReceiptTimestamp) : '—'}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (item) => (
        <button
          onClick={() => onInspectDetails(item.group.primaryLog)}
          className="inline-flex items-center space-x-1 px-3 py-1 rounded bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-blue-50 hover:border-blue-200 transition-[color,background-color,border-color,box-shadow,opacity,transform] min-h-11 min-w-11"
        >
          <span>View</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header & Quick Actions */}
      <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Plant history
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportCsv}
              disabled={isLoading || error != null || filteredItems.length === 0}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-blue-50 hover:border-blue-200 transition-[color,background-color,border-color,box-shadow,opacity,transform] disabled:opacity-50 min-h-11"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={isLoading || error != null || filteredItems.length === 0}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-action-soft transition-[color,background-color,border-color,box-shadow,opacity,transform] disabled:opacity-50 min-h-11"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print View</span>
            </button>

            {onRetry && (
              <button
                onClick={onRetry}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-action/10 transition-[color,background-color,border-color,box-shadow,opacity,transform] disabled:opacity-50 min-h-11"
              >
                <span>{isLoading ? 'Syncing…' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Record Count Badge */}
        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {isLoading || error != null ? (
              <span>—</span>
            ) : (
              <>
                <strong>{filteredItems.length}</strong> / <strong>{items.length}</strong>
              </>
            )}
          </span>
          {!isLoading && !error && (currentFromDate || currentToDate) ? (
            <span className="text-xs font-semibold text-primary">
              {currentFromDate || 'Start'} to {currentToDate || 'End'}
            </span>
          ) : null}
        </div>
      </div>

      {/* 2. Filters & Search Bar */}
      <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden min-h-11"
            />
          </div>

          {/* Business Date Range Filter */}
          {onDateFilterChange && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-semibold text-secondary-foreground text-xs">From date:</span>
              <input
                type="date"
                value={currentFromDate}
                onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                className="px-3 py-1 text-xs tabular-nums font-semibold rounded-lg bg-subtle border border-border/80 text-foreground min-h-11"
              />
              <span className="font-semibold text-secondary-foreground text-xs">To:</span>
              <input
                type="date"
                value={currentToDate}
                onChange={(e) => onDateFilterChange(currentFromDate || null, e.target.value || null)}
                className="px-3 py-1 text-xs tabular-nums font-semibold rounded-lg bg-subtle border border-border/80 text-foreground min-h-11"
              />
              {(currentFromDate || currentToDate) && (
                <button
                  onClick={() => onDateFilterChange(null, null)}
                  className="px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded min-h-11 min-w-11"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Filter Dropdowns / Chips */}
        <div className="flex items-center gap-3 overflow-x-auto pt-2 border-t border-border/60 text-xs flex-wrap">
          {/* Lifecycle Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Stage:</span>
            <select
              value={lifecycleFilter}
              onChange={(e) => setLifecycleFilter(e.target.value as HistoryLifecycleFilter)}
              className="px-2 py-1 text-xs font-semibold rounded bg-subtle border border-border text-secondary-foreground outline-hidden min-h-11"
            >
              <option value="ALL">All stages</option>
              <option value="IN_TRANSIT">In transit</option>
              <option value="IN_PLANT">In plant</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="HOLD">On hold</option>
            </select>
          </div>

          {/* QA Decision Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">QA Decision:</span>
            <select
              value={qaFilter}
              onChange={(e) => setQaFilter(e.target.value as HistoryQAFilter)}
              className="px-2 py-1 text-xs font-semibold rounded bg-subtle border border-border text-secondary-foreground outline-hidden min-h-11"
            >
              <option value="ALL">All QA</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED">Rejected</option>
              <option value="HOLD">Hold</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          {/* Receipt Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Receipt:</span>
            <select
              value={receiptFilter}
              onChange={(e) => setReceiptFilter(e.target.value as HistoryReceiptFilter)}
              className="px-2 py-1 text-xs font-semibold rounded bg-subtle border border-border text-secondary-foreground outline-hidden min-h-11"
            >
              <option value="ALL">All receipts</option>
              <option value="FINAL_RECEIPT_EXISTS">Receipt done</option>
              <option value="RECEIPT_PENDING">Receipt pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Error Banner */}
      <ErrorPopup message={error} onRetry={onRetry} />

      {/* 4. Loading State */}
      {isLoading && (
        <SkeletonTable rows={5} />
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-card rounded-xl border border-border/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold text-foreground">No records</h3>
          {onRetry && (
            <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center rounded-lg border border-action/30 bg-action-soft px-4 text-xs font-semibold text-action hover:bg-action-soft">
              Refresh
            </button>
          )}
        </div>
      )}

      {/* 6. Historical Transactions Table */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <DataTable
          columns={columns}
          rows={paginate(filteredItems, Math.min(page, pageCount(filteredItems.length)))}
          getRowId={(item) => String(item.visitId)}
          tableFrom="lg"
          footer={<Pager page={Math.min(page, pageCount(filteredItems.length))} totalPages={pageCount(filteredItems.length)} total={filteredItems.length} onPageChange={setPage} />}
        />
      )}
    </div>
  );
};
