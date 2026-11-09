'use client';

import React from 'react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { MotVehicleItem } from './types';

interface Props {
  vehicles: MotVehicleItem[];
  loading: boolean;
}

export function vehicleStatusLabel(v: MotVehicleItem): { label: string; tone: string } {
  if (!v.is_active) return { label: 'Inactive', tone: 'bg-muted text-secondary-foreground' };
  if (v.active_journey?.status === 'RETURNING') return { label: 'Returning', tone: 'bg-blue-100 text-blue-800' };
  if (v.has_active_journey) return { label: 'Collecting', tone: 'bg-amber-100 text-amber-800' };
  if (v.at_zmcc_waiting_unload) return { label: 'At ZMCC waiting unload', tone: 'bg-amber-100 text-amber-800' };
  return { label: 'Free', tone: 'bg-emerald-100 text-emerald-800' };
}

const vehicleColumns: DataColumn<MotVehicleItem>[] = [
  {
    key: 'vehicle',
    header: 'Vehicle Number',
    label: 'Vehicle Number',
    primary: true,
    cell: (v) => <span className="tabular-nums font-semibold text-primary">{v.vehicle_number}</span>,
  },
  {
    key: 'zmcc',
    header: 'ZMCC Center',
    label: 'ZMCC Center',
    cell: (v) => <span className="font-medium text-secondary-foreground">{v.zmcc?.name}</span>,
  },
  {
    key: 'journey',
    header: 'Journey',
    label: 'Journey',
    cell: (v) =>
      v.has_active_journey ? (
        <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-xs font-semibold">
          #{v.active_journey?.journey_number}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">None</span>
      ),
  },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    cell: (v) => {
      const st = vehicleStatusLabel(v);
      return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${st.tone}`}>{st.label}</span>;
    },
  },
];

/** Read-only fleet of the user's own ZMCC. Vehicles are registered and moved by the Data Executive. */
export function VehiclesTab({ vehicles, loading }: Props) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
      <DataTable
        columns={vehicleColumns}
        rows={vehicles}
        getRowId={(v) => v.id}
        loading={loading}
        emptyTitle="No Mobile Tester vehicles registered for this ZMCC."
      />
    </div>
  );
}
