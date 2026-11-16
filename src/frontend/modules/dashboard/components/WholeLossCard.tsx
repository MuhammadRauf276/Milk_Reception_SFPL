'use client';

import React, { useState } from 'react';
import { Download, Layers, Loader2 } from 'lucide-react';
import { ErrorPopup } from '@/components/ui/error-popup';
import { LossStatCard, WholeLinesTable, wholeFigure } from '@/frontend/modules/mpd/components/LossLevelCards';
import { useLossExport, useLossLevels } from '@/frontend/modules/mpd/lossData';
import { DEFAULT_LOSS_FILTERS, type LossFilters } from '@/frontend/modules/mpd/lossFilters';
import type { LossPreset } from '@/backend/modules/management-reporting/lossLevelContracts';

export interface WholeLossCardProps {
  /** A ZMCC manager is locked to their own ZMCC by the server; this only narrows a wider role. */
  zmccId?: string;
  initialPeriod?: 'today' | 'wtd' | 'mtd';
  showExportButton?: boolean;
}

const PERIODS: Array<{ value: 'today' | 'wtd' | 'mtd'; preset: LossPreset; label: string }> = [
  { value: 'today', preset: 'TODAY', label: 'Today' },
  { value: 'wtd', preset: 'LAST_7', label: 'Last 7' },
  { value: 'mtd', preset: 'MTD', label: 'This month' },
];

const WHOLE_INFO =
  'Milk bought from shops and HC vs milk received at the plant, with milk still in ZMCC tanks and in tankers counted. Received minus bought. Admin adjustments are shown on their own line.';

/** Whole Loss / Gain with its lines: @13 TS is the main figure, gross sits beside it. */
export const WholeLossCard: React.FC<WholeLossCardProps> = ({ zmccId, initialPeriod = 'today', showExportButton = true }) => {
  const [period, setPeriod] = useState<'today' | 'wtd' | 'mtd'>(initialPeriod);
  const preset = PERIODS.find((p) => p.value === period)?.preset ?? 'TODAY';
  const filters: LossFilters = { ...DEFAULT_LOSS_FILTERS, preset, zmccIds: zmccId ? [zmccId] : [] };
  const query = useLossLevels(filters);
  const exporter = useLossExport(filters);
  const whole = query.data?.whole ?? null;
  const error = query.isError ? query.error.message || 'Loss and gain could not be loaded.' : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
      <div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-800">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Whole Loss / Gain</h3>
            <p className="text-xs text-muted-foreground">{query.data?.filters?.label ?? ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Period" className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1 text-xs font-semibold">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={`min-h-11 rounded-md px-3 transition-colors ${
                  period === p.value ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {showExportButton ? (
            <button
              type="button"
              onClick={() => void exporter.run()}
              disabled={exporter.exporting || query.isPending}
              className="flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
            >
              {exporter.exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
              Excel
            </button>
          ) : null}
        </div>
      </div>

      <ErrorPopup message={error} onRetry={() => void query.refetch()} />

      {query.isPending ? (
        <div className="grid animate-pulse grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <div className="h-36 rounded-xl bg-muted" />
          <div className="h-36 rounded-xl bg-muted" />
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 ${query.isFetching ? 'opacity-60' : ''}`}>
          <LossStatCard
            label="Whole"
            basis="bought"
            info={WHOLE_INFO}
            figure={wholeFigure(query.data)}
          />
          <WholeLinesTable whole={whole} />
        </div>
      )}
    </div>
  );
};
export default WholeLossCard;
