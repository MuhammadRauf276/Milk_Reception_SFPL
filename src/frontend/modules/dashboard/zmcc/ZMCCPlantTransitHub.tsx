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
      <div className="bg-card p-5 rounded-2xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Plant transit</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Tankers and receipts
          </p>
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
