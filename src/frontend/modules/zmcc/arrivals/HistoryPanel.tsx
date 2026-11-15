'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { ZmccPager } from '../shared/ZmccDrawer';
import { MyCorrectionTicketsButton } from '@/frontend/modules/governance/MyCorrectionTickets';
import type { CorrectionTarget, HcArrivalRow, McArrivalRow } from './arrivalTypes';

export type HistoryType = 'ALL' | 'MC' | 'HC';

interface Props {
  historyType: HistoryType;
  onTypeChange: (t: HistoryType) => void;
  historyDate: string;
  onDateChange: (d: string) => void;
  historySearch: string;
  onSearchChange: (s: string) => void;
  historyPage: number;
  onPageChange: (p: number) => void;
  totalPages: number;
  totalRecords: number;
  loading: boolean;
  onRefresh: () => void;
  mcArrivals: McArrivalRow[];
  hcArrivals: HcArrivalRow[];
  /** Data Executive / Super Admin: correction column, saves count and Correct button. */
  canDirectCorrect: boolean;
  /** Everyone else may raise a correction ticket. */
  canRequestCorrection: boolean;
  onCorrect: (t: CorrectionTarget) => void;
  onRequestCorrection: (type: CorrectionTarget['type'], record: McArrivalRow | HcArrivalRow) => void;
}

const fmtTime = (ts: string | Date) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });

export const HistoryPanel: React.FC<Props> = (p) => {
  const showAction = p.canDirectCorrect || p.canRequestCorrection;

  const typeBtn = (value: HistoryType, label: string, activeCls = 'bg-primary text-white') => (
    <button
      type="button"
      onClick={() => p.onTypeChange(value)}
      className={`min-h-11 px-3 ${p.historyType === value ? activeCls : 'bg-white text-secondary-foreground'}`}
    >
      {label}
    </button>
  );

  const savesBadge = (saves: number) => (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
        saves > 0 ? 'bg-amber-100 text-amber-800' : 'bg-muted text-secondary-foreground'
      }`}
    >
      {saves} saves
    </span>
  );

  const actionButton = (target: CorrectionTarget, correctCls: string) =>
    p.canDirectCorrect ? (
      <button
        type="button"
        onClick={() => p.onCorrect(target)}
        className={`min-h-11 px-3 text-xs font-semibold rounded-lg cursor-pointer ${correctCls}`}
      >
        Correct
      </button>
    ) : (
      <button
        type="button"
        onClick={() => p.onRequestCorrection(target.type, target.record)}
        className="min-h-11 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 cursor-pointer"
      >
        Request correction
      </button>
    );

  type HistoryRow = { kind: 'MC'; arr: McArrivalRow } | { kind: 'HC'; arr: HcArrivalRow };
  const rows: HistoryRow[] = [
    ...((p.historyType === 'ALL' || p.historyType === 'MC' ? p.mcArrivals : []).map((arr) => ({ kind: 'MC' as const, arr }))),
    ...((p.historyType === 'ALL' || p.historyType === 'HC' ? p.hcArrivals : []).map((arr) => ({ kind: 'HC' as const, arr }))),
  ];

  const columns: DataColumn<HistoryRow>[] = [
    {
      key: 'type',
      header: 'Type',
      label: 'Type',
      cell: (r) =>
        r.kind === 'MC' ? (
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">Mobile Tester</span>
        ) : (
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800">HC</span>
        ),
    },
    {
      key: 'zmcc_token',
      header: 'ZMCC Token',
      label: 'ZMCC Token',
      primary: true,
      cell: (r) => <span className="tabular-nums font-semibold text-foreground">{r.arr.zmcc_token}</span>,
    },
    {
      key: 'slip_token',
      header: 'Route / Slip Token',
      label: 'Route / Slip Token',
      cell: (r) =>
        r.kind === 'MC' ? (
          <div className="tabular-nums font-semibold text-secondary-foreground">
            <div>{r.arr.raw_milk_token_number || '—'}</div>
            {r.arr.route_milk_token && (
              <div className="text-xs text-muted-foreground font-sans font-normal mt-0.5">
                Legacy Route Milk Token: <span className="tabular-nums">{r.arr.route_milk_token}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="tabular-nums font-semibold text-emerald-900">
            <div>{r.arr.raw_milk_token_number || '—'}</div>
            {r.arr.rmr_number && (
              <div className="text-xs text-muted-foreground font-sans font-normal mt-0.5">
                Legacy RMR: <span className="tabular-nums">{r.arr.rmr_number}</span>
              </div>
            )}
          </div>
        ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle / Supplier',
      label: 'Vehicle / Supplier',
      cell: (r) =>
        r.kind === 'MC' ? (
          <div>
            <div className="font-semibold text-foreground">{r.arr.journey?.vehicle_number || '—'}</div>
            <div className="text-xs text-muted-foreground">
              {r.arr.journey?.journey_number} ({r.arr.journey?.route_code})
            </div>
          </div>
        ) : (
          <div>
            <div className="font-semibold text-foreground">{r.arr.vehicle_number}</div>
            <div className="text-xs text-secondary-foreground font-medium">
              {r.arr.local_supplier?.name}{' '}
              <span className="tabular-nums text-muted-foreground">({r.arr.local_supplier?.local_supplier_code})</span>
            </div>
            {r.arr.milk_source_name_snapshot && (
              <div className="text-xs font-semibold text-emerald-800">Source: {r.arr.milk_source_name_snapshot}</div>
            )}
          </div>
        ),
    },
    {
      key: 'arrival',
      header: 'Arrival Time (PKT)',
      label: 'Arrival Time (PKT)',
      cell: (r) => <span className="text-secondary-foreground font-medium">{fmtTime(r.arr.arrival_timestamp)}</span>,
    },
    {
      key: 'recorded_by',
      header: 'Recorded By',
      label: 'Recorded By',
      cell: (r) => <span className="text-secondary-foreground">{r.arr.recorded_by?.full_name || r.arr.recorded_by?.username}</span>,
    },
    ...(p.canDirectCorrect
      ? [
          {
            key: 'corrections',
            header: 'Corrections',
            label: 'Corrections',
            cell: (r: HistoryRow) => savesBadge(r.arr.correction_count),
          },
        ]
      : []),
    ...(showAction
      ? [
          {
            key: 'actions',
            header: 'Action',
            label: 'Action',
            actions: true,
            align: 'right' as const,
            cell: (r: HistoryRow) =>
              r.kind === 'MC'
                ? actionButton({ type: 'MC', record: r.arr }, 'text-primary hover:bg-blue-50')
                : actionButton({ type: 'HC', record: r.arr }, 'text-emerald-700 hover:bg-emerald-50'),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4 animate-panel-in">
      <div className="bg-card rounded-2xl border border-border p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-card border-border flex rounded-xl border overflow-hidden text-xs font-semibold">
            {typeBtn('ALL', 'All')}
            {typeBtn('MC', 'Mobile Tester only')}
            {typeBtn('HC', 'HC only', 'bg-emerald-700 text-white')}
          </div>

          <input
            type="date"
            value={p.historyDate}
            onChange={(e) => p.onDateChange(e.target.value)}
            className="min-h-11 text-xs font-semibold px-3 border rounded-xl bg-card"
          />

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-4 text-muted-foreground" />
            <input
              type="text"
              value={p.historySearch}
              onChange={(e) => p.onSearchChange(e.target.value)}
              placeholder="Search tokens, vehicle…"
              className="min-h-11 text-xs pl-8 pr-3 border rounded-xl bg-card w-48"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.canRequestCorrection && <MyCorrectionTicketsButton />}
          <button
            type="button"
            onClick={p.onRefresh}
            className="flex items-center space-x-1 min-h-11 px-4 bg-muted hover:bg-muted/80 active:scale-95 text-secondary-foreground rounded-xl text-xs font-semibold transition-colors"
          >
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => `${r.kind === 'MC' ? 'mc' : 'hc'}-${r.arr.id}`}
        emptyTitle="No records."
        footer={
          <ZmccPager
            page={p.historyPage}
            totalPages={p.totalPages}
            onPage={p.onPageChange}
            disabled={p.loading}
            summary={<> ({p.totalRecords} records)</>}
          />
        }
      />
    </div>
  );
};
