'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingDown,
  TrendingUp,
  Download,
  RefreshCw,
  AlertTriangle,
  Layers,
  Truck,
  Building2,
  Route,
  CheckCircle2,
} from 'lucide-react';
import type { SupplyChainLossSummary } from '@/backend/services/lossCalculationService';

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
  const [summary, setSummary] = useState<SupplyChainLossSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLossData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL('/api/management/reports/loss-reconciliation', window.location.origin);
      url.searchParams.set('period', period);
      if (zmccId) {
        url.searchParams.set('zmccId', zmccId);
      }

      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to load supply chain loss data.');
      }

      const data = await res.json();
      setSummary(data.summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching loss metrics.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [period, zmccId]);

  useEffect(() => {
    fetchLossData();
  }, [fetchLossData]);

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const url = new URL('/api/management/reports/loss-reconciliation/export', window.location.origin);
      url.searchParams.set('period', period);
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
      alert(err instanceof Error ? err.message : 'Failed to download report.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {/* Card Header & Controls */}
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-800">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Supply Chain Loss Hierarchy</h3>
            <p className="text-xs text-slate-500">
              {summary ? `${summary.startDate} to ${summary.endDate}` : 'End-to-end 3-tier loss metrics'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Period Selector Tabs */}
          <div className="flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setPeriod('today')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                period === 'today' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setPeriod('wtd')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                period === 'wtd' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setPeriod('mtd')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                period === 'mtd' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchLossData}
            disabled={isLoading}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Refresh metrics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* Export Excel Button */}
          {showExportButton && (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isExporting || isLoading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              <Download className={`w-3.5 h-3.5 ${isExporting ? 'animate-pulse' : ''}`} />
              <span>{isExporting ? 'Exporting...' : 'Export Excel'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Error View */}
      {error && (
        <div className="p-4 m-4 rounded-lg bg-red-50 border border-red-200 flex items-center space-x-2 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && !summary && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-xl" />
          ))}
        </div>
      )}

      {/* Metrics Grid */}
      {summary && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Tier 1: MOT Route / Area Loss */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700">
                  <Route className="w-3.5 h-3.5 text-blue-700" />
                  <span>Tier 1: MOT Route Loss</span>
                </div>
                {summary.tier1RouteLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-bold text-amber-700">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier1RouteLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Balanced
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss Volume:</span>
                  <span className="text-base font-black text-slate-900">
                    {summary.tier1RouteLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss @13% TS:</span>
                  <span className="text-xs font-bold text-slate-700">
                    {summary.tier1RouteLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <span>Intake: {summary.tier1RouteLoss.shopGrossLiters.toLocaleString()} L</span>
              <span>Arrival: {summary.tier1RouteLoss.zmccArrivalGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          {/* Tier 2: ZMCC Process & Chilling Loss */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700">
                  <Building2 className="w-3.5 h-3.5 text-purple-700" />
                  <span>Tier 2: ZMCC Process Loss</span>
                </div>
                {summary.tier2ZmccLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-bold text-amber-700">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier2ZmccLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Balanced
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss Volume:</span>
                  <span className="text-base font-black text-slate-900">
                    {summary.tier2ZmccLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss @13% TS:</span>
                  <span className="text-xs font-bold text-slate-700">
                    {summary.tier2ZmccLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <span>Inward: {summary.tier2ZmccLoss.totalInwardGrossLiters.toLocaleString()} L</span>
              <span>Dispatched: {summary.tier2ZmccLoss.dispatchedGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          {/* Tier 3: Road Transit Loss */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700">
                  <Truck className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Tier 3: Road Transit Loss</span>
                </div>
                {summary.tier3TransitLoss.isHighLoss ? (
                  <span className="flex items-center px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold">
                    <AlertTriangle className="w-3 h-3 mr-0.5" />
                    &gt; 1.0% Loss
                  </span>
                ) : summary.tier3TransitLoss.lossLiters > 0 ? (
                  <span className="flex items-center text-xs font-bold text-slate-700">
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                    {summary.tier3TransitLoss.lossPercent.toFixed(2)}%
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Normal
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss Volume:</span>
                  <span
                    className={`text-base font-black ${
                      summary.tier3TransitLoss.isHighLoss ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {summary.tier3TransitLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Loss @13% TS:</span>
                  <span className="text-xs font-bold text-slate-700">
                    {summary.tier3TransitLoss.at13tsLossLiters.toLocaleString()} L
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <span>Dispatched: {summary.tier3TransitLoss.dispatchedGrossLiters.toLocaleString()} L</span>
              <span>Plant Net: {summary.tier3TransitLoss.plantAcceptedGrossLiters.toLocaleString()} L</span>
            </div>
          </div>

          {/* Tier 4: Total MPD Loss */}
          <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-blue-200/60">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-blue-900">
                  <Layers className="w-3.5 h-3.5 text-blue-800" />
                  <span>Total MPD Supply Chain Loss</span>
                </div>
                <span className="flex items-center text-xs font-black text-blue-950">
                  {summary.tier4TotalLoss.lossPercent.toFixed(2)}%
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-blue-800">Total Loss:</span>
                  <span className="text-base font-black text-blue-950">
                    {summary.tier4TotalLoss.lossLiters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-blue-800">Total @13% TS:</span>
                  <span className="text-xs font-bold text-blue-900">
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
