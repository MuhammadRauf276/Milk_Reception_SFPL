'use client';

import React from 'react';
import type { JourneyItem } from './types';

interface Props {
  journeys: JourneyItem[];
  loading: boolean;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
  onViewMap: (journeyId: string) => void;
  onViewStops: (journeyId: string) => void;
}

export function JourneyHistoryTab({ journeys, loading, statusFilter, onStatusFilterChange, onRefresh, onViewMap, onViewStops }: Props) {
  return (
        <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Journey Historical Ledger</h2>
            </div>
            <div className="flex items-center space-x-2">
              <div className="inline-flex rounded-xl border border-border bg-subtle p-0.5" role="group" aria-label="Status filter">
                {[
                  ['all', 'All'],
                  ['COLLECTING', 'Collecting'],
                  ['COMPLETED', 'Completed'],
                  ['CANCELLED', 'Cancelled'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onStatusFilterChange(v)}
                    aria-pressed={statusFilter === v}
                    className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold ${
                      statusFilter === v ? 'bg-primary text-white' : 'text-slate-700'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
              >
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading journey history…</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">No journeys recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Mobile Tester</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Outcome</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">{j.journey_number}</td>
                      <td className="p-3 font-medium text-slate-600">{j.operational_date}</td>
                      <td className="p-3 font-semibold text-foreground">{j.route?.route_code}</td>
                      <td className="p-3 font-semibold text-foreground">{j.mot_profile?.name}</td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">{j.mot_vehicle?.vehicle_number}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            j.status === 'COLLECTING'
                              ? 'bg-blue-100 text-blue-800'
                              : j.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        {j.status === 'CANCELLED' ? (
                          <span className="text-rose-700 text-[11px]" title={j.cancellation_reason || ''}>
                            Cancelled by {j.cancelled_by_name}: {j.cancellation_reason?.slice(0, 30)}…
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => onViewMap(j.id)}
                          className="min-h-[44px] px-3 rounded-lg bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100"
                        >
                          View Map
                        </button>
                        <button
                          type="button"
                          onClick={() => onViewStops(j.id)}
                          className="min-h-[44px] px-3 rounded-lg bg-blue-50 text-primary font-semibold hover:bg-blue-100"
                        >
                          View Stops
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
  );
}
