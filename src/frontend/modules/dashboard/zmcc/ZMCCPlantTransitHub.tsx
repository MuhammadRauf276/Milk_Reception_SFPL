'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { MilkProcessLog } from '@backend/core/types';
import { ZMCCManagerLiveDispatches } from './ZMCCManagerLiveDispatches';
import { ZMCCManagerReconciliation } from './ZMCCManagerReconciliation';
import { ZMCCManagerHistoryReports } from './ZMCCManagerHistoryReports';
import { Truck, ArrowRightLeft, History, RotateCw } from 'lucide-react';

interface ZMCCPlantTransitHubProps {
  logs: MilkProcessLog[];
  liveLogs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  liveLoading?: boolean;
  liveError?: string | null;
  onRetryLive?: () => void;
  fromDate?: string;
  toDate?: string;
  onDateFilterChange?: (from: string | null, to: string | null) => void;
  pagination?: {
    page: number;
    totalPages: number;
    totalRecords: number;
    hasMore: boolean;
  };
}

export function ZMCCPlantTransitHub({
  logs,
  liveLogs,
  assignedSourceName,
  onInspectDetails,
  isLoading,
  error,
  onRetry,
  liveLoading,
  liveError,
  onRetryLive,
  fromDate,
  toDate,
  onDateFilterChange,
  pagination,
}: ZMCCPlantTransitHubProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawView = searchParams?.get('view')?.toUpperCase();

  const [subView, setSubView] = useState<'IN_TRANSIT' | 'RECONCILIATION' | 'ALL_DISPATCHES'>(
    rawView === 'RECONCILIATION' ? 'RECONCILIATION' : rawView === 'ALL_DISPATCHES' ? 'ALL_DISPATCHES' : 'IN_TRANSIT'
  );

  useEffect(() => {
    if (rawView === 'IN_TRANSIT' || rawView === 'RECONCILIATION' || rawView === 'ALL_DISPATCHES') {
      setSubView(rawView);
    }
  }, [rawView]);

  const handleSubViewChange = (newSubView: 'IN_TRANSIT' | 'RECONCILIATION' | 'ALL_DISPATCHES') => {
    setSubView(newSubView);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', 'PLANT_TRANSIT');
    params.set('view', newSubView);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Plant Dispatches & Transit Hub</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Consolidated tanker tracking: Monitor live tankers in transit, review volume reconciliation, and inspect historical plant receipts
          </p>
        </div>

        {/* Segmented Subtabs */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border w-full sm:w-fit">
          <button
            type="button"
            onClick={() => handleSubViewChange('IN_TRANSIT')}
            className={`min-h-9 px-3.5 py-1.5 text-xs font-semibold rounded-md transition flex items-center justify-center gap-1.5 flex-1 sm:flex-initial ${
              subView === 'IN_TRANSIT' ? 'bg-primary text-white shadow-2xs' : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>In-Transit ({liveLogs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubViewChange('RECONCILIATION')}
            className={`min-h-9 px-3.5 py-1.5 text-xs font-semibold rounded-md transition flex items-center justify-center gap-1.5 flex-1 sm:flex-initial ${
              subView === 'RECONCILIATION' ? 'bg-primary text-white shadow-2xs' : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Transit Reconciliation</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubViewChange('ALL_DISPATCHES')}
            className={`min-h-9 px-3.5 py-1.5 text-xs font-semibold rounded-md transition flex items-center justify-center gap-1.5 flex-1 sm:flex-initial ${
              subView === 'ALL_DISPATCHES' ? 'bg-primary text-white shadow-2xs' : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>All Dispatches</span>
          </button>
        </div>
      </div>

      {/* Render subview */}
      {subView === 'IN_TRANSIT' && (
        <ZMCCManagerLiveDispatches
          logs={liveLogs}
          assignedSourceName={assignedSourceName}
          onInspectDetails={onInspectDetails}
          isLoading={liveLoading || false}
          error={liveError || null}
          onRetry={onRetryLive || onRetry}
        />
      )}

      {subView === 'RECONCILIATION' && (
        <ZMCCManagerReconciliation
          logs={logs}
          assignedSourceName={assignedSourceName}
          onInspectDetails={onInspectDetails}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          pagination={pagination}
        />
      )}

      {subView === 'ALL_DISPATCHES' && (
        <ZMCCManagerHistoryReports
          logs={logs}
          assignedSourceName={assignedSourceName}
          onInspectDetails={onInspectDetails}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          currentFromDate={fromDate}
          currentToDate={toDate}
          onDateFilterChange={onDateFilterChange}
        />
      )}
    </div>
  );
}
