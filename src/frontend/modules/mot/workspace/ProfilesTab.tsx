'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    { key: 'name', header: 'Name', label: 'Name', primary: true, cell: (p) => <span className="font-semibold text-foreground">{p.name}</span> },
    { key: 'phone', header: 'Phone', label: 'Phone', cell: (p) => <span className="font-medium text-secondary-foreground">{p.phone_number}</span> },
    { key: 'cnic', header: 'CNIC', label: 'CNIC', cell: (p) => <span className="tabular-nums text-secondary-foreground">{p.cnic}</span> },
    {
      key: 'user',
      header: 'Account',
      label: 'Account',
      cell: (p) => (
        <span className="text-secondary-foreground font-medium">
          {p.user ? (p.user.full_name || p.user.username) : <span className="text-muted-foreground">Unlinked</span>}
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
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => onEdit(p)}>
            Edit
          </Button>
          <Button
            variant={p.is_active ? 'destructive' : 'secondary'}
            size="sm"
            onClick={() => onToggleActive(p)}
            disabled={p.has_active_journey && p.is_active}
          >
            {p.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="bg-card rounded-2xl border border-border/80 shadow-2xs overflow-hidden space-y-3 animate-panel-in">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Testers</h2>
        </div>
        <Button onClick={() => onAdd()}>
          <Plus aria-hidden />
          <span>Add tester</span>
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={profiles}
        getRowId={(p) => p.id}
        loading={loading}
        noun="testers"
        emptyTitle="No Mobile Tester profiles registered for this ZMCC."
      />
    </div>
  );
}
