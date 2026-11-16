'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { ContractorReceiptsMetrics, ContractorVehicleVisit } from './contractorManagerTypes';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { QuantityStat } from '@/components/ui/quantity-stat';
import { formatLossGain } from '@/lib/lossGain';
import {
  buildContractorVehicleVisits,
  computeContractorReceiptsMetrics,
} from './contractorManagerHelpers';
import {
  Receipt,
  CheckCircle2,
  Clock,
  Scale,
  ArrowRightLeft,
  Search,
  Filter,
  ShieldCheck,
  AlertCircle,
  Building2,
} from 'lucide-react';

interface ContractorReceiptsReconciliationProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

type ReceiptFilterType = 'ALL' | 'FINAL_RECEIPT' | 'RECEIPT_PENDING' | 'BEFORE_RECEIPT';

export const ContractorReceiptsReconciliation: React.FC<ContractorReceiptsReconciliationProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilterType>('ALL');

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorReceiptsMetrics = useMemo(() => {
    return computeContractorReceiptsMetrics(visits);
  }, [visits]);

  // Filtered visits
  const filteredVisits = useMemo(() => {
    return visits.filter((v) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
        const matchRec = v.receptionNumber.toLowerCase().includes(q);
        const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
        if (!matchVeh && !matchRec && !matchTok) return false;
      }

      // 2. Receipt Status Filter
      if (receiptFilter === 'ALL') return true;
      if (receiptFilter === 'FINAL_RECEIPT') return v.finalReceiptExists;
      if (receiptFilter === 'RECEIPT_PENDING')
        return Boolean(v.secondWeightTimestamp && !v.finalReceiptExists);
      if (receiptFilter === 'BEFORE_RECEIPT')
        return !v.finalReceiptExists && !v.secondWeightTimestamp;

      return true;
    });
  }, [visits, searchQuery, receiptFilter]);

  const deltaCell = (value: number | null | undefined, text: string | null | undefined) =>
    value != null ? (
      <span
        className={
          value === 0 ? 'text-secondary-foreground' : value > 0 ? 'text-emerald-700' : 'text-rose-700'
        }
      >
        {text}
      </span>
    ) : (
      <span className="text-muted-foreground font-sans text-xs font-normal">—</span>
    );

  const columns: DataColumn<ContractorVehicleVisit>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      primary: true,
      cell: (v) => (
        <div className="tabular-nums font-semibold text-foreground">
          <div>
            <span>{v.vehicleNumber}</span>
            {v.tokenNumber && (
              <span className="block text-xs text-muted-foreground font-normal">Token {v.tokenNumber}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'reception',
      header: 'Reception #',
      label: 'Reception #',
      cell: (v) => <span className="tabular-nums text-secondary-foreground text-xs">{v.receptionNumber}</span>,
    },
    {
      key: 'date',
      header: 'Business Date',
      label: 'Business Date',
      cell: (v) => <span className="text-secondary-foreground tabular-nums text-xs">{v.operationalDate || '—'}</span>,
    },
    {
      key: 'dispatchGross',
      header: 'Dispatch Gross (L)',
      label: 'Dispatch Gross (L)',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold text-foreground">
          {v.grossLiters != null ? `${v.grossLiters.toLocaleString()} L` : '—'}
        </span>
      ),
    },
    {
      key: 'plantGross',
      header: 'Plant Final Gross (L)',
      label: 'Plant Final Gross (L)',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">
          {v.authoritativeFinalLiters != null ? (
            <span className="text-emerald-700">{v.authoritativeFinalLiters.toLocaleString()} L</span>
          ) : (
            <span className="text-muted-foreground font-sans text-xs font-normal">Pending</span>
          )}
        </span>
      ),
    },
    {
      key: 'grossDelta',
      header: 'Loss / Gain (L)',
      label: 'Loss / Gain (L)',
      align: 'right',
      cell: (v) => <span className="tabular-nums font-semibold">{deltaCell(v.grossVarianceLiters, v.grossVarianceText)}</span>,
    },
    {
      key: 'grossDeltaPct',
      header: 'Loss / Gain %',
      label: 'Loss / Gain %',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">{deltaCell(v.grossVariancePercent, v.grossVariancePercentText)}</span>
      ),
    },
    {
      key: 'dispatch13',
      header: 'Dispatch @13TS',
      label: 'Dispatch @13TS',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums text-foreground">
          {v.dispatch13TsLiters != null ? (
            <span>{v.dispatch13TsLiters.toLocaleString()} L</span>
          ) : (
            <span className="text-muted-foreground font-sans text-xs font-normal">Unavailable</span>
          )}
        </span>
      ),
    },
    {
      key: 'plant13',
      header: 'Plant Final @13TS',
      label: 'Plant Final @13TS',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">
          {v.plantFinalAt13TsLiters != null ? (
            <span className="text-foreground">{v.plantFinalAt13TsLiters.toLocaleString()} L</span>
          ) : v.isHistoricalReceiptWithoutCommercialSnapshot ? (
            <span className="text-muted-foreground font-sans text-xs font-semibold">Unavailable</span>
          ) : (
            <span className="text-muted-foreground font-sans text-xs font-normal">Pending</span>
          )}
        </span>
      ),
    },
    {
      key: 'delta13',
      header: 'Loss / Gain @13TS',
      label: 'Loss / Gain @13TS',
      align: 'right',
      cell: (v) => <span className="tabular-nums font-semibold">{deltaCell(v.at13TsVarianceLiters, v.at13TsVarianceText)}</span>,
    },
    {
      key: 'delta13Pct',
      header: 'Loss / Gain @13TS %',
      label: 'Loss / Gain @13TS %',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">{deltaCell(v.at13TsVariancePercent, v.at13TsVariancePercentText)}</span>
      ),
    },
    {
      key: 'silo',
      header: 'Destination Silo',
      label: 'Destination Silo',
      cell: (v) => (
        <span className="tabular-nums text-secondary-foreground text-xs">
          {v.siloStorageId ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 font-semibold">
              <Building2 className="w-3 h-3 text-muted-foreground" />
              <span>{v.siloStorageId}</span>
            </span>
          ) : (
            '—'
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (v) =>
        v.finalReceiptExists ? (
          <div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Final Receipt
            </span>
          </div>
        ) : v.secondWeightTimestamp ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Receipt Pending
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-secondary-foreground border border-border">
            {v.journeyStageLabel}
          </span>
        ),
    },
  ];
  if (error) {
    return (
      <div className="bg-card border-border p-6 rounded-2xl border text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-900">Failed to Load Receipts & Reconciliation</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Scope Banner */}
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-900 text-white rounded-xl shadow-xs">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {assignedSourceName}: Receipts & Reconciliation
            </h2>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              Business date:{' '}
              <strong className="text-secondary-foreground tabular-nums">{serverBusinessDate || '—'}</strong>
            </p>
          </div>
        </div>

      </div>

      {/* 2. Four Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Authoritative Final Receipts */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-semibold">
            <span>Final Receipts</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-semibold text-emerald-950 tabular-nums">
            {metrics.totalReceiptsCount}
          </p>
          <p className="text-xs text-emerald-700 font-medium">
            Posted Silo transactions
          </p>
        </div>

        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-amber-700 text-xs font-semibold">
            <span>Receipt Pending</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-3xl font-semibold text-amber-950 tabular-nums">
            {metrics.receiptPendingCount}
          </p>
          <p className="text-xs text-amber-700 font-medium">
            2nd weight done · Awaiting Silo
          </p>
        </div>

        {/* Received @13 TS */}
        <QuantityStat
          label="Received"
          icon={Scale}
          at13ts={metrics.totalAuthoritativeReceivedAt13TsLiters}
          gross={metrics.totalAuthoritativeReceivedLiters}
          missingAt13tsCount={metrics.receivedMissingAt13Ts}
        />

        {/* Net @13 TS difference */}
        <QuantityStat
          label="Net difference"
          icon={ArrowRightLeft}
          at13ts={null}
          valueText={metrics.netAt13TsVariance != null ? formatLossGain(metrics.netAt13TsVariance) : '—'}
          tone={metrics.netAt13TsVariance != null && metrics.netAt13TsVariance < 0 ? 'danger' : 'default'}
          hint={metrics.totalLitersVariance != null ? `Gross ${formatLossGain(metrics.totalLitersVariance)}` : undefined}
        />
      </div>

      {/* 3. Search & Filter Controls */}
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full pl-9 pr-4 py-2 min-h-11 text-xs tabular-nums font-semibold bg-muted border border-border-strong rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-900"
          />
        </div>

        {/* Receipt Status Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Status:</span>
          </span>

          <button
            type="button"
            onClick={() => setReceiptFilter('ALL')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'ALL'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            All ({visits.length})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('FINAL_RECEIPT')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'FINAL_RECEIPT'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Final ({metrics.totalReceiptsCount})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('RECEIPT_PENDING')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'RECEIPT_PENDING'
                ? 'bg-amber-900 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Pending ({metrics.receiptPendingCount})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('BEFORE_RECEIPT')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'BEFORE_RECEIPT'
                ? 'bg-neutral-800 text-white shadow-xs'
                : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            Before ({visits.filter((v) => !v.finalReceiptExists && !v.secondWeightTimestamp).length})
          </button>
        </div>
      </div>

      {/* 4. Receipts & Reconciliation Table */}
      <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-muted pb-3">
          <div className="flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Vehicle receipts</h3>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold">
            {filteredVisits.length} {filteredVisits.length === 1 ? 'vehicle' : 'vehicles'}
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={filteredVisits}
          getRowId={(v) => String(v.visitId)}
          loading={isLoading}
          emptyTitle="No Receipt Records"
          emptyDescription="No records"
        />
      </div>
    </div>
  );
};
