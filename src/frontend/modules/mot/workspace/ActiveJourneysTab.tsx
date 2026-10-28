'use client';

import React from 'react';
import type { JourneyItem } from './types';

interface Props {
  journeys: JourneyItem[];
  loading: boolean;
  canCancel: boolean;
  onRefresh: () => void;
  onViewMap: (journeyId: string) => void;
  onViewStops: (journeyId: string) => void;
  onCancel: (journey: JourneyItem) => void;
}

export function ActiveJourneysTab({ journeys, loading, canCancel, onRefresh, onViewMap, onViewStops, onCancel }: Props) {
  return (
        <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden animate-panel-in">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Active journeys</h2>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="min-h-11 min-w-11 flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
            >
              <span>Refresh</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading active journeys…</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              No active journeys currently in progress.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Mobile Tester</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Stops</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Dispatched By</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">
                        {j.journey_number}
                      </td>
                      <td className="p-3 font-semibold text-foreground">
                        {j.route?.route_code} · {j.route?.name}
                      </td>
                      <td className="p-3 font-semibold text-foreground">
                        {j.mot_profile?.name} ({j.mot_profile?.mot_code})
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">
                        {j.mot_vehicle?.vehicle_number}
                      </td>
                      <td className="p-3 font-semibold text-slate-700">
                        {j.total_stops != null ? `${j.total_stops} shops` : '—'}
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 font-medium text-slate-600">{j.assigned_by_name}</td>
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
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => onCancel(j)}
                            className="min-h-[44px] px-3 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100"
                          >
                            Cancel
                          </button>
                        )}
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
