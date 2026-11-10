'use client';

import { formatTime } from '@/lib/format';
import React from 'react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { JourneyItem } from './types';
import { formatLabel } from '@/lib/format';

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
  const columns: DataColumn<JourneyItem>[] = [
    {
      key: 'number',
      header: 'Journey #',
      label: 'Journey #',
      primary: true,
      cell: (j) => <span className="tabular-nums font-semibold text-primary">{j.journey_number}</span>,
    },
    { key: 'date', header: 'Date', label: 'Date', cell: (j) => <span className="font-medium text-secondary-foreground">{j.operational_date}</span> },
    { key: 'route', header: 'Route', label: 'Route', cell: (j) => <span className="font-semibold text-foreground">{j.route?.route_code}</span> },
    { key: 'tester', header: 'Mobile Tester', label: 'Mobile Tester', cell: (j) => <span className="font-semibold text-foreground">{j.mot_profile?.name}</span> },
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      cell: (j) => <span className="tabular-nums font-semibold text-secondary-foreground">{j.mot_vehicle?.vehicle_number}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (j) => (
        <span
          className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
            j.status === 'COLLECTING'
              ? 'bg-blue-100 text-blue-800'
              : j.status === 'RETURNING' || j.status === 'ARRIVED'
              ? 'bg-amber-100 text-amber-800'
              : j.status === 'COMPLETED'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-rose-100 text-rose-800'
          }`}
        >
          {formatLabel(j.status)}
        </span>
      ),
    },
    {
      key: 'dispatched',
      header: 'Dispatched At',
      label: 'Dispatched At',
      cell: (j) => <span className="font-medium text-secondary-foreground">{formatTime(j.assigned_at)}</span>,
    },
    {
      key: 'outcome',
      header: 'Outcome',
      label: 'Outcome',
      cell: (j) => (
        <span className="text-secondary-foreground font-medium">
          {j.status === 'CANCELLED' ? (
            <span className="text-rose-700 text-xs" title={j.cancellation_reason || ''}>
              Cancelled by {j.cancelled_by_name}: {j.cancellation_reason?.slice(0, 30)}…
            </span>
          ) : (
            '—'
          )}
        </span>
      ),
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
        </div>
      ),
    },
  ];

  return (
        <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Journey history</h2>
            </div>
            <div className="flex items-center space-x-2">
              <div className="bg-card border-border inline-flex rounded-xl border p-0.5" role="group" aria-label="Status filter">
                {[
                  ['all', 'All'],
                  ['COLLECTING', 'Collecting'],
                  ['RETURNING', 'Returning'],
                  ['ARRIVED', 'At ZMCC'],
                  ['COMPLETED', 'Completed'],
                  ['CANCELLED', 'Cancelled'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onStatusFilterChange(v)}
                    aria-pressed={statusFilter === v}
                    className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold ${
                      statusFilter === v ? 'bg-primary text-white' : 'text-secondary-foreground'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="min-h-11 min-w-11 flex items-center space-x-1 px-3 py-2 rounded-lg border border-action/30 text-xs font-semibold text-action hover:bg-action-soft"
              >
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={journeys}
            getRowId={(j) => j.id}
            loading={loading}
            emptyTitle="No journeys recorded."
          />
        </div>
  );
}
