'use client';

import { formatDateTime } from '@/lib/format';
import React from 'react';
import { Search, Edit3 } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { MyCorrectionTicketsButton } from '@/frontend/modules/governance/MyCorrectionTickets';
import type { LabSession } from './labTypes';

export interface LabHistoryPanelProps {
  historySearch: string;
  setHistorySearch: (v: string) => void;
  historyDate: string;
  setHistoryDate: (v: string) => void;
  historyDecision: string;
  setHistoryDecision: (v: string) => void;
  historyPage: number;
  setHistoryPage: React.Dispatch<React.SetStateAction<number>>;
  historyItems: LabSession[];
  historyTotal: number;
  historyTotalPages: number;
  loadingHistory: boolean;
  fetchHistory: () => void;
  canTest: boolean;
  canDirectCorrect: boolean;
  /** Roles below Data Executive raise a correction ticket instead of correcting. */
  canRequestCorrection: boolean;
  /** Lab attendant never sees litres or 13TS figures. */
  showLitres: boolean;
  openCorrection: (session: LabSession) => void;
  openRequestCorrection: (session: LabSession) => void;
}

export const LabHistoryPanel: React.FC<LabHistoryPanelProps> = ({
  historySearch,
  setHistorySearch,
  historyDate,
  setHistoryDate,
  historyDecision,
  setHistoryDecision,
  historyPage,
  setHistoryPage,
  historyItems,
  historyTotal,
  historyTotalPages,
  loadingHistory,
  fetchHistory,
  canTest,
  canDirectCorrect,
  canRequestCorrection,
  showLitres,
  openCorrection,
  openRequestCorrection,
}) => {
  const columns: DataColumn<LabSession>[] = [
    {
      key: 'session',
      header: 'Session #',
      label: 'Session #',
      primary: true,
      cell: (item) => <span className="tabular-nums font-semibold text-foreground">#{item.id}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      label: 'Type',
      cell: (item) => (
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded ${
            item.arrival_type === 'MOT' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {item.arrival_type === 'MOT' ? 'Mobile Tester' : 'HC'}
        </span>
      ),
    },
    {
      key: 'token',
      header: 'Intake Token',
      label: 'Intake Token',
      cell: (item) => (
        <span className="tabular-nums text-secondary-foreground">
          {item.mot_arrival?.zmcc_token || item.local_supplier_arrival?.zmcc_token || '—'}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Source / Vehicle',
      label: 'Source / Vehicle',
      cell: (item) => (
        <span className="text-secondary-foreground">
          {item.arrival_type === 'MOT' ? (
            <span>
              {item.mot_arrival?.journey?.route?.name || 'Route Milk'} (
              {item.mot_arrival?.journey?.mot_vehicle?.vehicle_number || 'Mobile Tester'})
            </span>
          ) : (
            <span>
              {item.local_supplier_arrival?.local_supplier?.name || 'HC supplier'} (
              {item.local_supplier_arrival?.vehicle_number || '—'})
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'received',
      header: 'Received Qty',
      label: 'Received Qty',
      cell: (item) => (
        <span className="tabular-nums text-foreground font-semibold">
          {item.quantity_value != null ? (
            <span>
              {Number(item.quantity_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs text-muted-foreground font-normal">
                {item.quantity_unit === 'LITER' ? 'Liters' : item.quantity_unit}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Not captured under this version</span>
          )}
        </span>
      ),
    },
    ...(showLitres
      ? [
          {
            key: 'gross',
            header: 'Gross Liters',
            label: 'Gross Liters',
            cell: (item: LabSession) => (
              <span className="tabular-nums text-secondary-foreground">
                {item.gross_liters != null ? `${Number(item.gross_liters).toFixed(2)} L` : '—'}
              </span>
            ),
          },
          {
            key: 'ts13',
            header: '@13% TS Liters',
            label: '@13% TS Liters',
            cell: (item: LabSession) => (
              <span className="tabular-nums font-semibold text-emerald-700">
                {item.at_13ts_liters != null ? `${Number(item.at_13ts_liters).toFixed(2)} L` : '—'}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'tank',
      header: 'Tank Receipt',
      label: 'Tank Receipt',
      cell: (item) =>
        item.tank_receipt ? (
          <div className="tabular-nums text-xs">
            <span className="font-semibold text-foreground">{item.tank_receipt.tank?.tank_code || 'Tank'}</span>
            {showLitres && (
              <div className="text-xs text-muted-foreground font-sans">
                {Number(item.tank_receipt.gross_liters).toFixed(2)} L
              </div>
            )}
          </div>
        ) : item.decision === 'ACCEPTED' ? (
          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200">
            Waiting for weighing
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'completed',
      header: 'Completed At',
      label: 'Completed At',
      cell: (item) => <span className="text-muted-foreground">{item.completed_at ? formatDateTime(item.completed_at) : '—'}</span>,
    },
    {
      key: 'tester',
      header: 'Tested By',
      label: 'Tested By',
      cell: (item) => <span className="text-secondary-foreground">{item.completer?.full_name || item.completer?.username || '—'}</span>,
    },
    {
      key: 'decision',
      header: 'Decision',
      label: 'Decision',
      cell: (item) =>
        item.manager_review_status === 'PENDING' ? (
          <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">MANAGER REVIEW</span>
        ) : item.decision === 'ACCEPTED' ? (
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">ACCEPTED</span>
        ) : item.decision === 'REJECTED' ? (
          <span className="text-xs font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full">REJECTED</span>
        ) : (
          <span className="text-xs font-semibold text-secondary-foreground bg-muted px-2 py-0.5 rounded-full">PENDING</span>
        ),
    },
    ...(canDirectCorrect
      ? [
          {
            key: 'corrections',
            header: 'Corrections',
            label: 'Corrections',
            cell: (item: LabSession) => (
              <div className="space-y-0.5">
                <div className="font-semibold text-secondary-foreground">Saves: {item.correction_count ?? 0}</div>
                {item.last_corrected_at && (
                  <div className="text-xs text-muted-foreground">
                    Last by {item.last_corrector?.full_name || item.last_corrector?.username || 'user'}
                  </div>
                )}
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (item) =>
        canDirectCorrect ? (
          <button
            onClick={() => openCorrection(item)}
            className="inline-flex items-center gap-1 min-h-[44px] px-3 text-xs font-semibold text-primary bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
          >
            <Edit3 className="w-3 h-3" />
            Correct
          </button>
        ) : canRequestCorrection ? (
          <button
            onClick={() => openRequestCorrection(item)}
            className="inline-flex items-center gap-1 min-h-[44px] px-3 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors cursor-pointer"
          >
            Request correction
          </button>
        ) : null,
    },
  ];
  return (
        <div className="space-y-4 animate-panel-in">
          
          <div className="bg-card border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 rounded-2xl border">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                  placeholder="Search token, vehicle…"
                  className="min-h-11 pl-9 pr-4 py-2 border border-border-strong rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => { setHistoryDate(e.target.value); setHistoryPage(1); }}
                className="min-h-11 px-3 py-2 border border-border-strong rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              />

              <select
                value={historyDecision}
                onChange={(e) => { setHistoryDecision(e.target.value); setHistoryPage(1); }}
                className="min-h-11 px-3 py-2 border border-border-strong rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All decisions</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canRequestCorrection && <MyCorrectionTicketsButton />}
              <button
                onClick={fetchHistory}
                disabled={loadingHistory}
                className="flex items-center gap-2 min-h-[44px] px-4 py-2 bg-muted hover:bg-muted text-secondary-foreground text-xs font-semibold rounded-xl"
              >
                Filter
              </button>
            </div>
          </div>

          
          <DataTable
            columns={columns}
            rows={historyItems}
            getRowId={(r) => String(r.id)}
            loading={loadingHistory}
            emptyTitle="No completed laboratory testing records found."
            footer={
              historyTotalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-subtle p-3 text-xs font-semibold text-secondary-foreground">
                  <div>
                    Page <span className="font-semibold text-primary">{historyPage}</span> of{' '}
                    <span className="font-semibold text-primary">{historyTotalPages}</span> ({historyTotal} completed tests)
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={historyPage <= 1 || loadingHistory}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      className="min-h-11 min-w-11 px-3 py-1 bg-card border border-border-strong rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={historyPage >= historyTotalPages || loadingHistory}
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      className="min-h-11 min-w-11 px-3 py-1 bg-card border border-border-strong rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null
            }
          />
      </div>
  );
};
