'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import {
  ContractorVehicleVisit,
  ContractorQualityMetrics,
} from './contractorManagerTypes';
import {
  buildContractorVehicleVisits,
  computeContractorQualityMetrics,
  PLANT_LR_TEST_CODE,
  PLANT_FAT_TEST_CODE,
} from './contractorManagerHelpers';
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  ShieldCheck,
  FileSpreadsheet,
  AlertCircle,
  Truck,
} from 'lucide-react';

const portionColumns: DataColumn<MilkProcessLog>[] = [
  {
    key: 'portion',
    header: 'Portion',
    label: 'Portion',
    primary: true,
    cell: (p) => <span className="tabular-nums font-semibold text-foreground">{p.portion_number}</span>,
  },
  {
    key: 'qty',
    header: 'Portion Qty (Context)',
    label: 'Portion Qty (Context)',
    cell: (p) => (
      <span className="tabular-nums text-secondary-foreground text-xs">
        {p.dispatch_liters_gross ? `${p.dispatch_liters_gross.toLocaleString()} L` : '—'}
      </span>
    ),
  },
  {
    key: 'decision',
    header: 'QA Decision',
    label: 'QA Decision',
    cell: (p) => {
      const st = String(p.calculated_status || 'PENDING').toUpperCase();
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
            st === 'ACCEPTED'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : st === 'REJECTED'
              ? 'bg-rose-100 text-rose-800 border border-rose-200'
              : st === 'HOLD'
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : 'bg-muted text-secondary-foreground border border-border'
          }`}
        >
          {st}
        </span>
      );
    },
  },
  {
    key: 'lr',
    header: 'Plant LR',
    label: 'Plant LR',
    align: 'right',
    cell: (p) => (
      <span className="tabular-nums font-semibold text-foreground">{p.sampling_lr != null ? p.sampling_lr.toFixed(1) : '—'}</span>
    ),
  },
  {
    key: 'fat',
    header: 'Plant Fat',
    label: 'Plant Fat',
    align: 'right',
    cell: (p) => (
      <span className="tabular-nums font-semibold text-foreground">
        {p.sampling_fat != null ? `${p.sampling_fat.toFixed(2)}%` : '—'}
      </span>
    ),
  },
  {
    key: 'snfts',
    header: 'SNF / TS',
    label: 'SNF / TS',
    align: 'right',
    cell: (p) => (
      <span className="tabular-nums text-secondary-foreground text-xs">
        {p.computed_sampling_snf != null && p.computed_sampling_ts != null
          ? `${p.computed_sampling_snf.toFixed(2)}% / ${p.computed_sampling_ts.toFixed(2)}%`
          : '—'}
      </span>
    ),
  },
  {
    key: 'remarks',
    header: 'Remarks / Reason',
    label: 'Remarks / Reason',
    cell: (p) => <span className="text-secondary-foreground text-xs">{p.rejection_reasons || '—'}</span>,
  },
  {
    key: 'time',
    header: 'Sampling Time',
    label: 'Sampling Time',
    cell: (p) => <span className="text-muted-foreground tabular-nums text-xs">{p.sampling_time_start || '—'}</span>,
  },
];
interface ContractorQualityRejectionsProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

type QADecisionFilter = 'ALL' | 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING';

export const ContractorQualityRejections: React.FC<ContractorQualityRejectionsProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [decisionFilter, setDecisionFilter] = useState<QADecisionFilter>('ALL');

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorQualityMetrics = useMemo(() => {
    return computeContractorQualityMetrics(logs);
  }, [logs]);

  // Filter visits and their portions
  const filteredVisits = useMemo(() => {
    return visits
      .map((v) => {
        // Filter portions matching search & decision filter
        const matchingPortions = v.portions.filter((p) => {
          const st = String(p.calculated_status || 'PENDING').toUpperCase();
          if (decisionFilter === 'ALL') return true;
          if (decisionFilter === 'ACCEPTED') return st === 'ACCEPTED';
          if (decisionFilter === 'REJECTED') return st === 'REJECTED';
          if (decisionFilter === 'HOLD') return st === 'HOLD';
          if (decisionFilter === 'PENDING') return st === 'PENDING' || !p.calculated_status;
          return true;
        });

        // Search query over vehicle / reception / token
        let vehicleMatch = true;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
          const matchRec = v.receptionNumber.toLowerCase().includes(q);
          const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
          vehicleMatch = matchVeh || matchRec || matchTok;
        }

        if (!vehicleMatch || matchingPortions.length === 0) {
          return null;
        }

        return {
          ...v,
          visiblePortions: matchingPortions,
        };
      })
      .filter((v): v is (ContractorVehicleVisit & { visiblePortions: MilkProcessLog[] }) => v !== null);
  }, [visits, searchQuery, decisionFilter]);

  if (error) {
    return (
      <div className="bg-card border-border p-6 rounded-2xl border text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-900">Quality did not load</h4>
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
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {assignedSourceName}: Quality & rejections
            </h2>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              Business date:{' '}
              <strong className="text-secondary-foreground tabular-nums">{serverBusinessDate || '—'}</strong>
            </p>
          </div>
        </div>

      </div>

      {/* 2. Four Summary Portion Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Accepted Portions */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-semibold">
            <span>Accepted Portions</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-semibold text-emerald-950 tabular-nums">
            {metrics.acceptedPortions}
          </p>
          <p className="text-xs text-emerald-700 font-medium">
            Passed Plant QA criteria
          </p>
        </div>

        {/* Rejected Portions */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-rose-700 text-xs font-semibold">
            <span>Rejected Portions</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-3xl font-semibold text-rose-950 tabular-nums">
            {metrics.rejectedPortions}
          </p>
          <p className="text-xs text-rose-700 font-medium">
            Failed Plant QA standards
          </p>
        </div>

        {/* Hold Portions */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-amber-700 text-xs font-semibold">
            <span>Hold Portions</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-3xl font-semibold text-amber-950 tabular-nums">
            {metrics.holdPortions}
          </p>
          <p className="text-xs text-amber-700 font-medium">
            Under supervisory hold
          </p>
        </div>

        {/* Pending Portions */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-secondary-foreground text-xs font-semibold">
            <span>Pending Testing</span>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-semibold text-foreground tabular-nums">
            {metrics.pendingPortions}
          </p>
          <p className="text-xs text-muted-foreground font-medium">
            Awaiting lab evaluation
          </p>
        </div>
      </div>

      {/* 3. Search & Decision Filters */}
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

        {/* Decision Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Decision:</span>
          </span>

          <button
            type="button"
            onClick={() => setDecisionFilter('ALL')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'ALL'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            All ({metrics.totalPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('ACCEPTED')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'ACCEPTED'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Accepted ({metrics.acceptedPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('REJECTED')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'REJECTED'
                ? 'bg-rose-800 text-white shadow-xs'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            Rejected ({metrics.rejectedPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('HOLD')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'HOLD'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Hold ({metrics.holdPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('PENDING')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'PENDING'
                ? 'bg-neutral-800 text-white shadow-xs'
                : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            Pending ({metrics.pendingPortions})
          </button>
        </div>
      </div>

      {/* 4. Vehicle & Portion QA List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="bg-card border-border py-16 text-center text-xs font-semibold text-muted-foreground rounded-xl border shadow-xs">
            Loading quality records…
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="bg-card border-border py-16 px-4 rounded-xl border border-dashed text-center space-y-2 shadow-xs">
            <FileSpreadsheet className="w-10 h-10 text-neutral-300 mx-auto" />
            <h4 className="text-sm font-semibold text-secondary-foreground">No quality records</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No records
            </p>
          </div>
        ) : (
          filteredVisits.map((v) => (
            <div
              key={v.visitId}
              className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-4"
            >
              {/* Vehicle Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-blue-50 text-blue-900 rounded-xl">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-semibold text-foreground tabular-nums">
                        {v.vehicleNumber}
                      </h3>
                      {v.tokenNumber && (
                        <span className="px-2 py-0.5 rounded bg-muted text-secondary-foreground text-xs tabular-nums font-semibold border border-border">
                          Token: {v.tokenNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-medium">
                      Date:{' '}
                      <strong className="tabular-nums text-secondary-foreground">{v.operationalDate || '—'}</strong> · Whole Vehicle Gross:{' '}
                      <strong className="tabular-nums text-foreground">
                        {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Overall Summary Chip */}
                <div className="flex items-center space-x-2 self-start sm:self-auto">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold ${
                      v.qaSummary.badgeType === 'ALL_ACCEPTED'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : v.qaSummary.badgeType === 'ALL_REJECTED'
                        ? 'bg-rose-100 text-rose-900 border border-rose-300'
                        : v.qaSummary.badgeType === 'HAS_HOLD'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-muted text-foreground border border-border'
                    }`}
                  >
                    {v.qaSummary.summaryText}
                  </span>
                </div>
              </div>

              {/* Portion QA Table */}
              <DataTable
                columns={portionColumns}
                rows={v.visiblePortions}
                getRowId={(p) => String(p.portion_id || p.portion_number)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
