'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { ContractorOverviewMetrics } from './contractorManagerTypes';
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
  FileSpreadsheet,
  AlertCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

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

  if (error) {
    return (
      <div className="bg-card border-border p-6 rounded-2xl border text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-900">Failed to Load Overview Data</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-900 text-white rounded-xl shadow-xs">
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
        <div className="bg-card border-border p-3.5 rounded-2xl border text-xs text-amber-800 flex items-center justify-between">
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
        <StatCard
          label={pagination && pagination.totalPages > 1 ? 'Received gross (this page)' : 'Received gross'}
          icon={Scale}
          value={`${metrics.totalReceivedLiters.toLocaleString()} L`}
          hint={pagination && pagination.totalPages > 1 ? `${visits.length} visits on this page` : 'From silo transactions'}
        />
      </div>

      <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-muted pb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-blue-800" />
            <h3 className="text-sm font-semibold text-foreground">Recent Plant Dispatches</h3>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold">
            {visits.length} {visits.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-semibold text-muted-foreground">
            Loading recent records…
          </div>
        ) : visits.length === 0 ? (
          <div className="bg-card border-border py-12 px-4 rounded-xl border border-dashed text-center space-y-2">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto" />
            <h4 className="text-sm font-semibold text-secondary-foreground">No Operational Records</h4>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              No records
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-secondary-foreground font-semibold text-xs bg-slate-50/70">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Reception #</th>
                  <th className="py-2.5 px-3">Business Date</th>
                  <th className="py-2.5 px-3 text-right">Gross Liters</th>
                  <th className="py-2.5 px-3">Journey Stage</th>
                  <th className="py-2.5 px-3">QA Status</th>
                  <th className="py-2.5 px-3 text-right">Final Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-medium">
                {visits.slice(0, 10).map((v) => (
                  <tr key={v.visitId} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 tabular-nums font-semibold text-foreground">
                      {v.vehicleNumber}
                    </td>
                    <td className="py-3 px-3 tabular-nums text-secondary-foreground text-xs">
                      {v.receptionNumber}
                    </td>
                    <td className="py-3 px-3 text-secondary-foreground tabular-nums text-xs">
                      {v.operationalDate || '—'}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-semibold text-foreground">
                      {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
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
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
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
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-semibold">
                      {v.finalReceiptExists && v.authoritativeFinalLiters != null ? (
                        <span className="text-emerald-700">
                          {v.authoritativeFinalLiters.toLocaleString()} L
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
