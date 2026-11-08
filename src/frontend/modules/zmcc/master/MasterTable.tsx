'use client';

import React from 'react';
import { Edit2, Power } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';

export interface MasterCol<T> {
  header: string;
  align?: 'left' | 'center' | 'right';
  tdClass?: string;
  cell: (row: T) => React.ReactNode;
}

export const StatusPill: React.FC<{ active: boolean; approvalStatus?: string | null }> = ({ active, approvalStatus }) => {
  // Waiting or refused records are not usable, whatever their active switch says.
  const label =
    approvalStatus === 'PENDING_APPROVAL' || approvalStatus === 'PENDING'
      ? 'Waiting approval'
      : approvalStatus === 'REJECTED'
        ? 'Rejected'
        : active
          ? 'Active'
          : 'Inactive';
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
        label === 'Active'
          ? 'bg-emerald-50 text-emerald-800'
          : label === 'Waiting approval'
            ? 'bg-amber-50 text-amber-800'
            : label === 'Rejected'
              ? 'bg-rose-50 text-rose-800'
              : 'bg-muted text-secondary-foreground'
      }`}
    >
      {label}
    </span>
  );
};

interface Props<T extends { id: string; is_active: boolean }> {
  cols: MasterCol<T>[];
  rows: T[];
  emptyText: string;
  entity: string;
  canEdit: boolean;
  /** Kept for existing callers. Read-only users never see an Actions column. */
  hideActionsWhenReadOnly?: boolean;
  renderExtraActions?: (row: T) => React.ReactNode;
  onEdit: (row: T) => void;
  onToggle: (row: T) => void;
}

/** One master-data list: columns are declared by the caller, actions are shared. */
export function MasterTable<T extends { id: string; is_active: boolean }>({
  cols,
  rows,
  emptyText,
  entity,
  canEdit,
  renderExtraActions,
  onEdit,
  onToggle,
}: Props<T>) {
  const columns: DataColumn<T>[] = cols.map((c, i) => ({
    key: c.header,
    header: c.header,
    label: c.header,
    align: c.align,
    className: c.tdClass,
    primary: i === 0,
    cell: c.cell,
  }));

  if (canEdit) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {renderExtraActions ? renderExtraActions(r) : null}
          <button
            type="button"
            onClick={() => onEdit(r)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={`Edit ${entity}`}
            aria-label={`Edit ${entity}`}
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(r)}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-muted ${
              r.is_active ? 'text-muted-foreground hover:text-destructive' : 'text-emerald-700'
            }`}
            title={r.is_active ? `Deactivate ${entity}` : `Activate ${entity}`}
            aria-label={r.is_active ? `Deactivate ${entity}` : `Activate ${entity}`}
          >
            <Power className="h-4 w-4" />
          </button>
        </div>
      ),
    });
  }

  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} emptyTitle={emptyText} />;
}
