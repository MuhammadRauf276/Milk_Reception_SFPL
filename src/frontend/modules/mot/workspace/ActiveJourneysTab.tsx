'use client';

import { formatTime } from '@/lib/format';
import React from 'react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
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
  const columns: DataColumn<JourneyItem>[] = [
    {
      key: 'number',
      header: 'Journey #',
      label: 'Journey #',
      primary: true,
      cell: (j) => <span className="tabular-nums font-semibold text-primary">{j.journey_number}</span>,
    },
    {
      key: 'route',
      header: 'Route',
      label: 'Route',
      cell: (j) => (
        <span className="font-semibold text-foreground">
          {j.route?.route_code} · {j.route?.name}
        </span>
      ),
    },
    {
      key: 'tester',
      header: 'Mobile Tester',
      label: 'Mobile Tester',
      cell: (j) => (
        <span className="font-semibold text-foreground">
          {j.mot_profile?.name} ({j.mot_profile?.mot_code})
        </span>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      cell: (j) => <span className="tabular-nums font-semibold text-secondary-foreground">{j.mot_vehicle?.vehicle_number}</span>,
    },
    {
      key: 'stops',
      header: 'Stops',
      label: 'Stops',
      cell: (j) => <span className="font-semibold text-secondary-foreground">{j.total_stops != null ? `${j.total_stops} shops` : '—'}</span>,
    },
    {
      key: 'dispatched',
      header: 'Dispatched At',
      label: 'Dispatched At',
      cell: (j) => <span className="font-medium text-secondary-foreground">{formatTime(j.assigned_at)}</span>,
    },
    {
      key: 'dispatchedBy',
      header: 'Dispatched By',
      label: 'Dispatched By',
      cell: (j) => <span className="font-medium text-secondary-foreground">{j.assigned_by_name}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (j) => (
        <div className="flex flex-wrap justify-end gap-2">
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
        </div>
      ),
    },
  ];

  return (
        <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden animate-panel-in">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Active journeys</h2>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="min-h-11 min-w-11 flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-secondary-foreground hover:bg-muted"
            >
              <span>Refresh</span>
            </button>
          </div>

          <DataTable
            columns={columns}
            rows={journeys}
            getRowId={(j) => j.id}
            loading={loading}
            emptyTitle="No active journeys currently in progress."
          />
        </div>
  );
}
