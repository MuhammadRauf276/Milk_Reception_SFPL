'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  TrendingDown,
  Download,
  AlertTriangle,
  Layers,
  Truck,
  Building2,
  Route,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { fetchJson } from '@/lib/fetch-json';
import type { SupplyChainLossSummary } from '@/backend/services/lossCalculationService';
import { ErrorPopup } from '@/components/ui/error-popup';

export interface SupplyChainLossCardProps {
  zmccId?: string;
  initialPeriod?: 'today' | 'wtd' | 'mtd';
  showExportButton?: boolean;
}

export const SupplyChainLossCard: React.FC<SupplyChainLossCardProps> = ({
  zmccId,
  initialPeriod = 'today',
  showExportButton = true,
}) => {
  const [period, setPeriod] = useState<'today' | 'wtd' | 'mtd'>(initialPeriod);
  // Plant vehicles counted on the calendar day or the 08:00 business day; ZMCC figures always use the calendar day.
  const [basis, setBasis] = useState<'calendar' | 'business'>('calendar');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const lossQuery = useQuery({
    queryKey: ['dashboard', 'supply-chain-loss', { period, basis, zmccId: zmccId ?? null }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ period, basis });
      if (zmccId) params.set('zmccId', zmccId);
      return fetchJson<{ summary: SupplyChainLossSummary }>(
        `/api/management/reports/loss-reconciliation?${params.toString()}`,
        { headers: { Accept: 'application/json' }, signal },
        'Failed to load supply chain loss data.'
      );
    },
    placeholderData: keepPreviousData,
  });
  const summary = lossQuery.data?.summary ?? null;
  const isLoading = lossQuery.isFetching;
  const error = lossQuery.isError ? lossQuery.error.message || 'Error fetching loss metrics.' : null;

  const selectPeriod = (next: 'today' | 'wtd' | 'mtd') => {
    if (next !== period) setPeriod(next);
  };

  const refresh = () => {
    void lossQuery.refetch();
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const url = new URL('/api/management/reports/loss-reconciliation/export', window.location.origin);
      url.searchParams.set('period', period);
      url.searchParams.set('basis', basis);
      if (zmccId) {
        url.searchParams.set('zmccId', zmccId);
      }

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error('Export download failed.');
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `Loss_Reconciliation_${period.toUpperCase()}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: unknown) {
      toast.error('Export failed', { description: err instanceof Error ? err.message : 'Failed to download report.' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-2xs overflow-hidden">
      {/* Card Header & Controls */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-800">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Supply Chain Loss Hierarchy</h3>
            <p className="text-xs text-muted-foreground">
              {summary ? `${summary.startDate} to ${summary.endDate}` : 'End-to-end 3-tier loss metrics'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector Tabs */}
          <div className="flex items-center p-1 bg-muted rounded-lg border border-border text-xs font-semibold">
            <button
              type="button"
              onClick={() => selectPeriod('today')}
              className={`px-3 min-h-11 rounded-md transition-colors ${
                period === 'today' ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => selectPeriod('wtd')}
              className={`px-3 min-h-11 rounded-md transition-colors ${
                period === 'wtd' ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => selectPeriod('mtd')}
              className={`px-3 min-h-11 rounded-md transition-colors ${
                period === 'mtd' ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
          </div>

          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs text-secondary-foreground">
            <span>Plant by</span>
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value === 'business' ? 'business' : 'calendar')}
              className="min-h-9 bg-transparent font-medium text-foreground focus:outline-hidden"
              aria-label="Date plant vehicles are counted on"
            >
              <option value="calendar">Calendar date</option>
              <option value="business">Business date (08:00 to 08:00)</option>
            </select>
          </label>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-action/30 bg-action-soft text-action hover:bg-action-soft transition-colors disabled:opacity-50 min-h-11 min-w-11"
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Refresh
          </button>

          {/* Export Excel Button */}
          {showExportButton && (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isExporting || isLoading}
              className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors disabled:opacity-50 min-h-11"
            >
              <Download className={`w-3.5 h-3.5 ${isExporting ? 'opacity-50' : ''}`} />
              <span>{isExporting ? 'Exporting…' : 'Export Excel'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Error View */}
      <ErrorPopup message={error} />

      {/* Loading Skeleton */}
      {isLoading && !summary && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {/* Metrics Grid */}
      {summary && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card border-border p-4 rounded-2xl border flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-secondary-foreground">
                  <Route className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Tier 1: Mobile Tester Route Loss</span>
                </div>
                {summary.tier1RouteLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-semibold text-amber-700">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier1RouteLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Balanced
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss Volume:</span>
                  <span className="text-base font-semibold text-foreground">
                    {summary.tier1RouteLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss @13% TS:</span>
                  <span className="text-xs font-semibold text-secondary-foreground">
                    {summary.tier1RouteLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>Intake: {summary.tier1RouteLoss.shopGrossLiters.toLocaleString()} L</span>
              <span>Arrival: {summary.tier1RouteLoss.zmccArrivalGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          <div className="bg-card border-border p-4 rounded-2xl border flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-secondary-foreground">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Tier 2: ZMCC Process Loss</span>
                </div>
                {summary.tier2ZmccLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-semibold text-amber-700">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier2ZmccLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Balanced
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss Volume:</span>
                  <span className="text-base font-semibold text-foreground">
                    {summary.tier2ZmccLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss @13% TS:</span>
                  <span className="text-xs font-semibold text-secondary-foreground">
                    {summary.tier2ZmccLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>Inward: {summary.tier2ZmccLoss.totalInwardGrossLiters.toLocaleString()} L</span>
              <span>Dispatched: {summary.tier2ZmccLoss.dispatchedGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          <div className="bg-card border-border p-4 rounded-2xl border flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-secondary-foreground">
                  <Truck className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Tier 3: Road Transit Loss</span>
                </div>
                {summary.tier3TransitLoss.isHighLoss ? (
                  <span className="flex items-center px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs font-semibold">
                    <AlertTriangle className="w-3 h-3 mr-0.5" />
                    &gt; 1.0% Loss
                  </span>
                ) : summary.tier3TransitLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-semibold text-secondary-foreground">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier3TransitLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Normal
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss Volume:</span>
                  <span
                    className={`text-base font-semibold ${
                      summary.tier3TransitLoss.isHighLoss ? 'text-rose-700' : 'text-foreground'
                    }`}
                  >
                    {summary.tier3TransitLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Loss @13% TS:</span>
                  <span className="text-xs font-semibold text-secondary-foreground">
                    {summary.tier3TransitLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>Dispatched: {summary.tier3TransitLoss.dispatchedGrossLiters.toLocaleString()} L</span>
              <span>Plant Net: {summary.tier3TransitLoss.plantAcceptedGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          <div className="bg-card border-border p-4 rounded-2xl border flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-blue-200/60">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-blue-900">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Total MPD Supply Chain Loss</span>
                </div>
                <span className="flex items-center text-xs font-semibold text-blue-950">
                  {summary.tier4TotalLoss.lossPercent.toFixed(2)}%
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-blue-800">Total Loss:</span>
                  <span className="text-base font-semibold text-blue-950">
                    {summary.tier4TotalLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-blue-800">Total @13% TS:</span>
                  <span className="text-xs font-semibold text-blue-900">
                    {summary.tier4TotalLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-blue-200/60 flex items-center justify-between text-xs text-blue-800">
              <span>Total Intake: {summary.tier4TotalLoss.totalInitialIntakeLiters.toLocaleString()} L</span>
              <span>Final Plant: {summary.tier4TotalLoss.totalFinalPlantLiters.toLocaleString()} L</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default SupplyChainLossCard;
