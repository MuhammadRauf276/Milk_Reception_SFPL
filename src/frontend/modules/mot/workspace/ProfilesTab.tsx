'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import type { MotProfileItem } from './types';

interface Props {
  profiles: MotProfileItem[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (profile: MotProfileItem) => void;
  onToggleActive: (profile: MotProfileItem) => void;
}

export function ProfilesTab({ profiles, loading, onAdd, onEdit, onToggleActive }: Props) {
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

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading profiles…</div>
          ) : profiles.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              No Mobile Tester profiles registered for this ZMCC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Mobile Tester Code</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">CNIC</th>
                    <th className="p-3">Linked User</th>
                    <th className="p-3">Active Journey</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {profiles.map((p) => (
                    <tr key={p.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">{p.mot_code}</td>
                      <td className="p-3 font-semibold text-foreground">{p.name}</td>
                      <td className="p-3 font-medium text-slate-700">{p.phone_number}</td>
                      <td className="p-3 tabular-nums text-slate-600">{p.cnic}</td>
                      <td className="p-3 text-slate-600 font-medium">
                        {p.user ? `@${p.user.username}` : <span className="text-slate-400">Unlinked</span>}
                      </td>
                      <td className="p-3">
                        {p.has_active_journey ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">
                            #{p.active_journey?.journey_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None (Available)</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => onEdit(p)}
                          className="min-h-[44px] px-3 rounded-lg bg-muted text-slate-800 font-semibold hover:bg-border"
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
