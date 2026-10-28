'use client';

import React from 'react';
import { Search } from 'lucide-react';
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
      className={`min-h-[44px] px-3 ${p.historyType === value ? activeCls : 'bg-white text-slate-700'}`}
    >
      {label}
    </button>
  );

  const savesBadge = (saves: number) => (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
        saves > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {saves} saves
    </span>
  );

  const actionCell = (target: CorrectionTarget, correctCls: string) =>
    showAction && (
      <td className="p-3 text-right">
        {p.canDirectCorrect ? (
          <button
            type="button"
            onClick={() => p.onCorrect(target)}
            className={`min-h-[44px] px-3 text-xs font-semibold rounded-lg cursor-pointer ${correctCls}`}
          >
            Correct
          </button>
        ) : (
          <button
            type="button"
            onClick={() => p.onRequestCorrection(target.type, target.record)}
            className="min-h-[44px] px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 cursor-pointer"
          >
            Request correction
          </button>
        )}
      </td>
    );

  const rowCls = 'hover:bg-slate-50/60 transition-colors';
  const none = p.mcArrivals.length === 0 && p.hcArrivals.length === 0;
  const colCount = 6 + (p.canDirectCorrect ? 1 : 0) + (showAction ? 1 : 0);

  return (
    <div className="space-y-4 animate-panel-in">
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
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
            className="min-h-[44px] text-xs font-semibold px-3 border rounded-xl bg-white"
          />

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-4 text-slate-400" />
            <input
              type="text"
              value={p.historySearch}
              onChange={(e) => p.onSearchChange(e.target.value)}
              placeholder="Search tokens, vehicle…"
              className="min-h-[44px] text-xs pl-8 pr-3 border rounded-xl bg-white w-48"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.canRequestCorrection && <MyCorrectionTicketsButton />}
          <button
            type="button"
            onClick={p.onRefresh}
            className="flex items-center space-x-1 min-h-[44px] px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
          >
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-border text-xs uppercase tracking-wider text-slate-500 font-semibold">
                <th className="p-3">Type</th>
                <th className="p-3">ZMCC Token</th>
                <th className="p-3">Route / Slip Token</th>
                <th className="p-3">Vehicle / Supplier</th>
                <th className="p-3">Arrival Time (PKT)</th>
                <th className="p-3">Recorded By</th>
                {p.canDirectCorrect && <th className="p-3">Corrections</th>}
                {showAction && <th className="p-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(p.historyType === 'ALL' || p.historyType === 'MC') &&
                p.mcArrivals.map((arr) => (
                  <tr key={`mc-${arr.id}`} className={rowCls}>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Mobile Tester</span>
                    </td>
                    <td className="p-3 tabular-nums font-semibold text-slate-900">{arr.zmcc_token}</td>
                    <td className="p-3 tabular-nums font-semibold text-slate-700">
                      <div>{arr.raw_milk_token_number || '—'}</div>
                      {arr.route_milk_token && (
                        <div className="text-xs text-slate-500 font-sans font-normal mt-0.5">
                          Legacy Route Milk Token: <span className="tabular-nums">{arr.route_milk_token}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">{arr.journey?.vehicle_number || '—'}</div>
                      <div className="text-xs text-slate-500">
                        {arr.journey?.journey_number} ({arr.journey?.route_code})
                      </div>
                    </td>
                    <td className="p-3 text-slate-700 font-medium">{fmtTime(arr.arrival_timestamp)}</td>
                    <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                    {p.canDirectCorrect && <td className="p-3">{savesBadge(arr.correction_count)}</td>}
                    {actionCell({ type: 'MC', record: arr }, 'text-primary hover:bg-blue-50')}
                  </tr>
                ))}

              {(p.historyType === 'ALL' || p.historyType === 'HC') &&
                p.hcArrivals.map((arr) => (
                  <tr key={`hc-${arr.id}`} className={rowCls}>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">HC</span>
                    </td>
                    <td className="p-3 tabular-nums font-semibold text-slate-900">{arr.zmcc_token}</td>
                    <td className="p-3 tabular-nums font-semibold text-emerald-900">
                      <div>{arr.raw_milk_token_number || '—'}</div>
                      {arr.rmr_number && (
                        <div className="text-xs text-slate-500 font-sans font-normal mt-0.5">
                          Legacy RMR: <span className="tabular-nums">{arr.rmr_number}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">{arr.vehicle_number}</div>
                      <div className="text-xs text-slate-600 font-medium">
                        {arr.local_supplier?.name}{' '}
                        <span className="tabular-nums text-slate-400">({arr.local_supplier?.local_supplier_code})</span>
                      </div>
                      {arr.milk_source_name_snapshot && (
                        <div className="text-xs font-semibold text-emerald-800">Source: {arr.milk_source_name_snapshot}</div>
                      )}
                    </td>
                    <td className="p-3 text-slate-700 font-medium">{fmtTime(arr.arrival_timestamp)}</td>
                    <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                    {p.canDirectCorrect && <td className="p-3">{savesBadge(arr.correction_count)}</td>}
                    {actionCell({ type: 'HC', record: arr }, 'text-emerald-700 hover:bg-emerald-50')}
                  </tr>
                ))}

              {none && (
                <tr>
                  <td colSpan={colCount} className="p-8 text-center text-xs text-slate-400">
                    No records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ZmccPager
          page={p.historyPage}
          totalPages={p.totalPages}
          onPage={p.onPageChange}
          disabled={p.loading}
          summary={<> ({p.totalRecords} records)</>}
        />
      </div>
    </div>
  );
};
