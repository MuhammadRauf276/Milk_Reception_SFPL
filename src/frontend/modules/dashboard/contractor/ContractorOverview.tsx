'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { ContractorOverviewMetrics, ContractorVehicleVisit } from './contractorManagerTypes';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import {
  buildContractorVehicleVisits,
  computeContractorOverview,
} from './contractorManagerHelpers';
import {
  Truck,
  Layers,
  Receipt,
  Scale,
  Building2,
  AlertCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { QuantityStat } from '@/components/ui/quantity-stat';

interface ContractorOverviewProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
  pagination?: {
    page: number;
    totalPages: number;
    totalRecords: number;
    hasMore: boolean;
  };
  summary?: {
    totalVisits?: number;
    completedVisits?: number;
    activeInPlantVisits?: number;
  };
}

export const ContractorOverview: React.FC<ContractorOverviewProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
  pagination,
  summary,
}) => {
  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorOverviewMetrics = useMemo(() => {
    return computeContractorOverview(visits);
  }, [visits]);

  const columns: DataColumn<ContractorVehicleVisit>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      primary: true,
      cell: (v) => <span className="tabular-nums font-semibold text-foreground">{v.vehicleNumber}</span>,
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
      key: 'gross',
      header: 'Gross Liters',
      label: 'Gross Liters',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold text-foreground">
          {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
        </span>
      ),
    },
    {
      key: 'stage',
      header: 'Journey Stage',
      label: 'Journey Stage',
      cell: (v) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
            v.journeyStage === 'COMPLETED'
              ? 'bg-emerald-100 text-emerald-800'
              : v.journeyStage === 'RECEIPT_PENDING'
              ? 'bg-amber-100 text-amber-800'
              : v.journeyStage === 'UNLOADING'
              ? 'bg-blue-100 text-blue-800'
              : v.journeyStage === 'WEIGHBRIDGE_GROSS'
              ? 'bg-blue-100 text-blue-800'
              : v.journeyStage === 'PLANT_QA'
              ? 'bg-amber-100 text-amber-800'
              : v.journeyStage === 'GATE_ENTRY'
              ? 'bg-blue-50 text-blue-800'
              : 'bg-muted text-secondary-foreground'
          }`}
        >
          {v.journeyStageLabel}
        </span>
      ),
    },
    {
      key: 'qa',
      header: 'QA Status',
      label: 'QA Status',
      cell: (v) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
            v.qaSummary.badgeType === 'ALL_ACCEPTED'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : v.qaSummary.badgeType === 'ALL_REJECTED'
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : v.qaSummary.badgeType === 'HAS_HOLD'
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-subtle text-secondary-foreground border border-border'
          }`}
        >
          {v.qaSummary.summaryText}
        </span>
      ),
    },
    {
      key: 'final',
      header: 'Final Received',
      label: 'Final Received',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">
          {v.finalReceiptExists && v.authoritativeFinalLiters != null ? (
            <span className="text-emerald-700">{v.authoritativeFinalLiters.toLocaleString()} L</span>
          ) : (
            <span className="text-muted-foreground">Pending</span>
          )}
        </span>
      ),
    },
  ];
  if (error) {
    return (
      <div className="bg-card border-border p-6 rounded-2xl border text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-900">Overview did not load</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-900 text-white rounded-xl shadow-xs">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {assignedSourceName}: Overview
            </h2>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              Date:{' '}
              <strong className="text-secondary-foreground tabular-nums">{serverBusinessDate || '—'}</strong>
            </p>
          </div>
        </div>

      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="bg-card border-border p-4 rounded-2xl border text-xs text-amber-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Showing page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.totalRecords} total visits in query). Volume metrics reflect the visible page.
            </span>
          </div>
          <span className="text-xs font-semibold text-amber-700">Bounded page metrics</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        <StatCard
          label="Total dispatches"
          icon={Truck}
          tone="info"
          value={summary?.totalVisits ?? metrics.totalDispatches}
          hint={
            summary?.totalVisits != null ? 'All visits in period' : `${metrics.totalGrossLiters.toLocaleString()} L gross`
          }
        />
        <StatCard
          label="Active in plant"
          icon={Clock}
          tone="warning"
          value={summary?.activeInPlantVisits ?? metrics.activeInPlantCount}
          hint="At gate, lab, scale or silo"
        />
        <StatCard
          label="Completed receipts"
          icon={Receipt}
          tone="success"
          value={summary?.completedVisits ?? metrics.completedReceiptsCount}
          hint="Verified silo receipts"
        />
        <QuantityStat
          label={pagination && pagination.totalPages > 1 ? 'Received (this page)' : 'Received'}
          icon={Scale}
          at13ts={metrics.totalReceivedAt13TsLiters}
          gross={metrics.totalReceivedLiters}
          missingAt13tsCount={metrics.receivedMissingAt13Ts}
          hint={pagination && pagination.totalPages > 1 ? `${visits.length} visits on this page` : 'From silo transactions'}
        />
      </div>

      <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-muted pb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Recent dispatches</h3>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold">
            {visits.length} {visits.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        <DataTable paginate={false}
          columns={columns}
          rows={visits.slice(0, 10)}
          getRowId={(v) => String(v.visitId)}
          loading={isLoading}
          emptyTitle="No records"
        />
      </div>
    </div>
  );
};
