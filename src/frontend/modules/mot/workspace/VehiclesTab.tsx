'use client';

import React from 'react';
import type { MotVehicleItem } from './types';

interface Props {
  vehicles: MotVehicleItem[];
  loading: boolean;
}

export function vehicleStatusLabel(v: MotVehicleItem): { label: string; tone: string } {
  if (!v.is_active) return { label: 'Inactive', tone: 'bg-slate-200 text-slate-700' };
  if (v.active_journey?.status === 'RETURNING') return { label: 'Returning', tone: 'bg-blue-100 text-blue-800' };
  if (v.has_active_journey) return { label: 'Collecting', tone: 'bg-amber-100 text-amber-800' };
  if (v.at_zmcc_waiting_unload) return { label: 'At ZMCC waiting unload', tone: 'bg-violet-100 text-violet-800' };
  return { label: 'Free', tone: 'bg-emerald-100 text-emerald-800' };
}

/** Read-only fleet of the user's own ZMCC. Vehicles are registered and moved by the Data Executive. */
export function VehiclesTab({ vehicles, loading }: Props) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Fleet</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">Vehicles are added and moved by the Data Executive.</p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading vehicles…</div>
      ) : vehicles.length === 0 ? (
        <div className="p-8 text-center text-xs font-semibold text-slate-500">
          No MC vehicles registered for this ZMCC.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
              <tr>
                <th className="p-3">Vehicle Number</th>
                <th className="p-3">ZMCC Center</th>
                <th className="p-3">Journey</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vehicles.map((v) => {
                const st = vehicleStatusLabel(v);
                return (
                  <tr key={v.id} className="hover:bg-subtle">
                    <td className="p-3 tabular-nums font-semibold text-primary">{v.vehicle_number}</td>
                    <td className="p-3 font-medium text-slate-700">{v.zmcc?.name}</td>
                    <td className="p-3">
                      {v.has_active_journey ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">
                          #{v.active_journey?.journey_number}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">None</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${st.tone}`}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
