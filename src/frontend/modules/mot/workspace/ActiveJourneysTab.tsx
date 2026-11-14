'use client';

import { formatTime } from '@/lib/format';
import React from 'react';
import { Button } from '@/components/ui/button';
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
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onViewMap(j.id)}>
            View Map
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onViewStops(j.id)}>
            View Stops
          </Button>
          {canCancel && (
            <Button variant="destructive" size="sm" onClick={() => onCancel(j)}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="bg-card rounded-2xl border border-border/80 shadow-2xs overflow-hidden animate-panel-in">
      <div className="p-4 border-b border-border flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Active journeys</h2>
        </div>
        <Button variant="outline" size="sm" loading={loading} loadingText="Refreshing…" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={journeys}
        getRowId={(j) => j.id}
        loading={loading}
        noun="journeys"
        emptyTitle="No active journeys currently in progress."
      />
    </div>
  );
}
