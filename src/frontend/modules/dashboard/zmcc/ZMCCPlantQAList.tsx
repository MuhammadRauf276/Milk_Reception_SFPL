'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { MilkProcessLog } from '@backend/core/types';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import { Pager, pageCount, paginate } from '../components/Pager';
import { TableWrapper } from '@/components/ui/table-wrapper';
import type { deriveQualityRejectionItems } from './zmccManagerHelpers';

type PlantItem = ReturnType<typeof deriveQualityRejectionItems>[number];

const diffClass = (diff: number | null | undefined) =>
  diff == null || diff === 0 ? 'text-muted-foreground' : diff > 0 ? 'text-emerald-700' : 'text-rose-700';

/** Paginated historical Plant QA portion cards (Dispatch QA vs Plant QA). */
export const ZMCCPlantQAList: React.FC<{
  items: PlantItem[];
  onInspectDetails: (log: MilkProcessLog) => void;
}> = ({ items, onInspectDetails }) => {
  const [page, setPage] = useState(1);
  const totalPages = pageCount(items.length);
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [items]);

  return (
    <div className="space-y-3">
      {paginate(items, currentPage).map((item) => {
        const isRejected = item.qaDecision === 'REJECTED';
        const isHold = item.qaDecision === 'HOLD';
        const isAccepted = item.qaDecision === 'ACCEPTED';

        return (
          <div
            key={`${item.visitId}-${item.portionNumber}`}
            className={`p-4 rounded-xl bg-card border shadow-2xs space-y-3 transition-[color,background-color,border-color,box-shadow,opacity,transform] ${
              isRejected
                ? 'border-rose-300 bg-rose-50/20'
                : isHold
                ? 'border-amber-300 bg-amber-50/20'
                : 'border-border/80 hover:border-primary/40'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/60">
              <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {item.vehicleNumber}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-neutral-900 text-white">
                  {item.portionNumber}
                </span>
                {item.tokenNumber && (
                  <span className="px-2 py-0.5 rounded text-xs tabular-nums font-semibold bg-muted text-secondary-foreground border border-border">
                    {item.tokenNumber}
                  </span>
                )}
                <span className="text-xs tabular-nums font-semibold text-secondary-foreground">
                  Business Date: {item.businessDate || 'Pending plant completion'}
                </span>
                <span
                  className={`px-3 py-0.5 rounded text-xs font-semibold  ${
                    isAccepted
                      ? 'bg-emerald-100 text-emerald-800'
                      : isRejected
                      ? 'bg-rose-100 text-rose-800'
                      : isHold
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-muted text-secondary-foreground'
                  }`}
                >
                  {item.qaDecision}
                </span>
              </div>

              <div>
                <button
                  onClick={() => onInspectDetails(item.log)}
                  className="flex min-h-11 items-center space-x-1 px-3 py-1 rounded-lg bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-blue-50 hover:border-blue-200 transition-[color,background-color,border-color,box-shadow,opacity,transform]"
                >
                  <span>View Details</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {isRejected && (
              <div className="bg-card border-border p-3 rounded-lg text-xs font-semibold flex items-start gap-2 border text-rose-900">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-700" />
                <div>
                  <span className="font-semibold text-xs block">Official Plant Rejection Reason:</span>
                  <span>{item.rejectionReasons || '—'}</span>
                </div>
              </div>
            )}

            <TableWrapper className="rounded-lg border border-border/80">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-muted text-xs font-sans font-semibold text-secondary-foreground border-b border-border/80">
                  <tr>
                    <th className="py-2 px-3">Parameter</th>
                    <th className="py-2 px-3">Dispatch QA</th>
                    <th className="py-2 px-3">Plant QA</th>
                    <th className="py-2 px-3">Difference</th>
                    <th className="py-2 px-3 font-sans">QA Event Date/Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-xs">
                  <tr className="hover:bg-subtle transition-colors">
                    <td className="py-2 px-3 font-sans font-semibold text-foreground">LR (Lactometer Reading)</td>
                    <td className="py-2 px-3 text-secondary-foreground">{item.dispatchLr != null ? item.dispatchLr : '—'}</td>
                    <td className="py-2 px-3 font-semibold text-foreground">{item.plantLr != null ? item.plantLr : '—'}</td>
                    <td className={`py-2 px-3 font-semibold ${diffClass(item.lrDiff)}`}>{item.lrDiffText}</td>
                    <td className="py-2 px-3 font-sans text-secondary-foreground text-xs">
                      {item.qaEventTimestamp ? formatOperationalDatetime(item.qaEventTimestamp) : '—'}
                    </td>
                  </tr>
                  <tr className="hover:bg-subtle transition-colors">
                    <td className="py-2 px-3 font-sans font-semibold text-foreground">Fat Percentage (%)</td>
                    <td className="py-2 px-3 text-secondary-foreground">
                      {item.dispatchFat != null ? `${item.dispatchFat}%` : '—'}
                    </td>
                    <td className="py-2 px-3 font-semibold text-foreground">
                      {item.plantFat != null ? `${item.plantFat}%` : '—'}
                    </td>
                    <td className={`py-2 px-3 font-semibold ${diffClass(item.fatDiff)}`}>{item.fatDiffText}</td>
                    <td className="py-2 px-3 font-sans text-secondary-foreground text-xs">
                      {item.qaEventTimestamp ? formatOperationalDatetime(item.qaEventTimestamp) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </TableWrapper>
          </div>
        );
      })}
      <Pager page={currentPage} totalPages={totalPages} total={items.length} onPageChange={setPage} />
    </div>
  );
};
