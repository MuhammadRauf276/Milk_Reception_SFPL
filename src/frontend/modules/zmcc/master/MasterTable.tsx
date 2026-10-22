'use client';

import React from 'react';
import { Edit2, Power } from 'lucide-react';

export interface MasterCol<T> {
  header: string;
  align?: 'left' | 'center' | 'right';
  tdClass?: string;
  cell: (row: T) => React.ReactNode;
}

const alignCls = { left: '', center: 'text-center', right: 'text-right' } as const;

export const StatusPill: React.FC<{ active: boolean }> = ({ active }) => (
  <span
    className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
      active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
    }`}
  >
    {active ? 'Active' : 'Inactive'}
  </span>
);

interface Props<T extends { id: string; is_active: boolean }> {
  cols: MasterCol<T>[];
  rows: T[];
  emptyText: string;
  entity: string;
  canEdit: boolean;
  /** Tanks hide the whole Actions column for read-only users; other tabs show a "Read-only" label. */
  hideActionsWhenReadOnly?: boolean;
  onEdit: (row: T) => void;
  onToggle: (row: T) => void;
}

/** One master-data table: columns are declared by the caller, actions are shared. */
export function MasterTable<T extends { id: string; is_active: boolean }>({
  cols,
  rows,
  emptyText,
  entity,
  canEdit,
  hideActionsWhenReadOnly,
  onEdit,
  onToggle,
}: Props<T>) {
  const showActionsCol = canEdit || !hideActionsWhenReadOnly;
  const colSpan = cols.length + (showActionsCol ? 1 : 0);
  return (
    <table className="w-full text-left text-xs border-collapse">
      <thead>
        <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
          {cols.map((c) => (
            <th key={c.header} className={`py-3 px-4 ${alignCls[c.align ?? 'left']}`}>
              {c.header}
            </th>
          ))}
          {showActionsCol && <th className="py-3 px-4 text-right">Actions</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={colSpan} className="py-8 text-center text-slate-400 font-semibold">
              {emptyText}
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-subtle/60 transition">
              {cols.map((c) => (
                <td key={c.header} className={`py-3 px-4 ${alignCls[c.align ?? 'left']} ${c.tdClass ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
              {showActionsCol && (
                <td className="py-3 px-4 text-right">
                  {!canEdit ? (
                    <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(r)}
                        className="p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                        title={`Edit ${entity}`}
                        aria-label={`Edit ${entity}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggle(r)}
                        className={`p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border transition ${
                          r.is_active
                            ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                            : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={r.is_active ? `Deactivate ${entity}` : `Activate ${entity}`}
                        aria-label={r.is_active ? `Deactivate ${entity}` : `Activate ${entity}`}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
