'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { MotProfileItem } from './types';

interface Props {
  profiles: MotProfileItem[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (profile: MotProfileItem) => void;
  onToggleActive: (profile: MotProfileItem) => void;
}

export function ProfilesTab({ profiles, loading, onAdd, onEdit, onToggleActive }: Props) {
  const columns: DataColumn<MotProfileItem>[] = [
    {
      key: 'code',
      header: 'Mobile Tester Code',
      label: 'Mobile Tester Code',
      primary: true,
      cell: (p) => <span className="tabular-nums font-semibold text-primary">{p.mot_code}</span>,
    },
    { key: 'name', header: 'Name', label: 'Name', cell: (p) => <span className="font-semibold text-foreground">{p.name}</span> },
    { key: 'phone', header: 'Phone', label: 'Phone', cell: (p) => <span className="font-medium text-secondary-foreground">{p.phone_number}</span> },
    { key: 'cnic', header: 'CNIC', label: 'CNIC', cell: (p) => <span className="tabular-nums text-secondary-foreground">{p.cnic}</span> },
    {
      key: 'user',
      header: 'Linked User',
      label: 'Linked User',
      cell: (p) => (
        <span className="text-secondary-foreground font-medium">
          {p.user ? `@${p.user.username}` : <span className="text-muted-foreground">Unlinked</span>}
        </span>
      ),
    },
    {
      key: 'journey',
      header: 'Active Journey',
      label: 'Active Journey',
      cell: (p) =>
        p.has_active_journey ? (
          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-xs font-semibold">
            #{p.active_journey?.journey_number}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">None (Available)</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (p) => (
        <span
          className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
            p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-secondary-foreground'
          }`}
        >
          {p.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (p) => (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onEdit(p)}
            className="min-h-[44px] px-3 rounded-lg bg-muted text-foreground font-semibold hover:bg-border"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onToggleActive(p)}
            disabled={p.has_active_journey && p.is_active}
            className={`min-h-[44px] px-3 rounded-lg font-semibold ${
              p.is_active
                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {p.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      ),
    },
  ];

  return (
        <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Testers</h2>
            </div>
            <button
              type="button"
              onClick={() => onAdd()}
              className="flex items-center space-x-1.5 px-3.5 min-h-[44px] rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add tester</span>
            </button>
          </div>

          <DataTable
            columns={columns}
            rows={profiles}
            getRowId={(p) => p.id}
            loading={loading}
            emptyTitle="No Mobile Tester profiles registered for this ZMCC."
          />
        </div>
  );
}
