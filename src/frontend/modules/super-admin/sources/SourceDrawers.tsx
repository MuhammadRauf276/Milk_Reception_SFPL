'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';

export interface Source {
  id: string;
  code: string;
  name: string;
  erpCode?: string | null;
  sourceType: string;
  isActive: boolean;
  createdAt: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function SourceCreateDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('ZMCC');
  const [erpCode, setErpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      fetchJson('/api/super-admin/procurement-sources', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
  const busy = mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const normalizedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!normalizedCode) return setError('Source code is required.');
    if (!trimmedName) return setError('Source name is required.');
    const trimmedErp = erpCode.trim();
    if (sourceType === 'CONTRACTOR' && !trimmedErp) return setError('ERP code is required for a contractor.');
    mutation.mutate(
      { code: normalizedCode, name: trimmedName, sourceType, ...(sourceType === 'CONTRACTOR' ? { erpCode: trimmedErp } : {}) },
      {
        onSuccess: () => onSaved(`Procurement source "${trimmedName}" (${normalizedCode}) created successfully.`),
        onError: (err) => setError(getErrorMessage(err) || 'Failed to create procurement source'),
      }
    );
  };

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title="Add Procurement Source">
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="src-code" className={fieldLabelClass}>Source Code *</label>
          <input
            id="src-code"
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            className={`${fieldInputClass} uppercase tabular-nums`}
            placeholder="e.g. ZMCC-FAISALABAD"
          />
          <p className="mt-1 text-[10px] text-slate-400">Code is immutable once created.</p>
        </div>
        <div>
          <label htmlFor="src-name" className={fieldLabelClass}>Source Name *</label>
          <input
            id="src-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className={fieldInputClass}
            placeholder="e.g. Faisalabad ZMCC Center"
          />
        </div>
        <div>
          <span className={fieldLabelClass}>Source Type *</span>
          <div role="group" aria-label="Source type" className="flex gap-2">
            {[
              { value: 'ZMCC', label: 'ZMCC' },
              { value: 'CONTRACTOR', label: 'Contractor' },
            ].map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={sourceType === o.value}
                disabled={busy}
                onClick={() => setSourceType(o.value)}
                className={`h-11 flex-1 rounded-xl border text-sm font-semibold ${
                  sourceType === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border-strong bg-white text-slate-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Source type is immutable once created.</p>
        </div>
        {sourceType === 'CONTRACTOR' && (
          <div>
            <label htmlFor="src-erp" className={fieldLabelClass}>ERP Code *</label>
            <input
              id="src-erp"
              type="text"
              required
              value={erpCode}
              onChange={(e) => setErpCode(e.target.value)}
              disabled={busy}
              className={`${fieldInputClass} tabular-nums`}
              placeholder="Official ERP vendor code"
            />
            <p className="mt-1 text-[10px] text-slate-400">Required for contractors. Only the MPD Head, Data Executive and Super Admin can change it later.</p>
          </div>
        )}
        <DrawerActions busy={busy} onCancel={onClose} submitLabel="Save Source" busyLabel="Saving…" />
      </form>
    </FormDrawer>
  );
}

export function SourceEditDrawer({ source, onClose, onSaved }: { source: Source; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(source.name);
  const [erpCode, setErpCode] = useState(source.erpCode ?? '');
  const isContractor = source.sourceType === 'CONTRACTOR';
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (n: string) =>
      fetchJson(`/api/super-admin/procurement-sources/${source.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: n, ...(isContractor ? { erpCode: erpCode.trim() } : {}) }),
      }),
  });
  const busy = mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError('Source name cannot be empty.');
    if (isContractor && !erpCode.trim()) return setError('ERP code is required for a contractor.');
    mutation.mutate(trimmed, {
      onSuccess: () => onSaved(`Procurement source "${trimmed}" updated successfully.`),
      onError: (err) => setError(getErrorMessage(err) || 'Failed to update procurement source'),
    });
  };

  const readOnly = 'h-11 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm tabular-nums text-slate-500';
  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title="Edit Procurement Source">
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className={fieldLabelClass}>Source Code</label>
            <input type="text" disabled value={source.code} className={readOnly} />
            <p className="mt-1 text-[10px] text-slate-400">Source code is immutable and cannot be modified.</p>
          </div>
          <div>
            <label className={fieldLabelClass}>Source Type</label>
            <input type="text" disabled value={source.sourceType} className={readOnly} />
            <p className="mt-1 text-[10px] text-slate-400">Source type is immutable and cannot be modified.</p>
          </div>
        </div>
        <div>
          <label htmlFor="src-edit-name" className={fieldLabelClass}>Source Name *</label>
          <input
            id="src-edit-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className={fieldInputClass}
            placeholder="e.g. Faisalabad ZMCC Center"
          />
        </div>
        {isContractor && (
          <div>
            <label htmlFor="src-edit-erp" className={fieldLabelClass}>ERP Code *</label>
            <input
              id="src-edit-erp"
              type="text"
              required
              value={erpCode}
              onChange={(e) => setErpCode(e.target.value)}
              disabled={busy}
              className={`${fieldInputClass} tabular-nums`}
            />
          </div>
        )}
        <DrawerActions busy={busy} onCancel={onClose} submitLabel="Save Changes" busyLabel="Saving…" />
      </form>
    </FormDrawer>
  );
}

export function SourceStatusDrawer({
  source,
  targetStatus,
  onClose,
  onSaved,
}: {
  source: Source;
  targetStatus: boolean;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/super-admin/procurement-sources/${source.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ isActive: targetStatus }),
      }),
    onSuccess: () => onSaved(`Source "${source.name}" (${source.code}) ${targetStatus ? 'activated' : 'deactivated'} successfully.`),
    onError: (err) => setError(getErrorMessage(err) || 'Failed to update procurement source status'),
  });
  const busy = mutation.isPending;

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title={`${targetStatus ? 'Activate' : 'Deactivate'} Source?`}>
      <div className="flex items-center gap-3">
        <div className={`shrink-0 rounded-xl p-2 ${targetStatus ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="text-xs tabular-nums text-slate-500">{source.code}</p>
      </div>
      <div className="space-y-2 text-slate-600">
        <p>
          Are you sure you want to {targetStatus ? 'activate' : 'deactivate'}{' '}
          <strong className="font-semibold text-slate-800">{source.name}</strong>?
        </p>
        {!targetStatus ? (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium text-amber-900">
            <p className="font-semibold">Deactivation Effects & Guards:</p>
            <ul className="list-inside list-disc space-y-0.5 text-amber-800">
              <li>Will be excluded from active operational dispatch selectors.</li>
              <li>Cannot be deactivated if active users are currently assigned.</li>
              <li>Cannot be deactivated if incomplete vehicle visits are in progress.</li>
              <li>Remains visible to Super Admins with Inactive status.</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-medium text-emerald-900">
            <p className="font-semibold">Activation Effects:</p>
            <p className="text-emerald-800">Will restore availability in operational selectors and allow user assignments.</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={targetStatus ? 'default' : 'destructive'}
          className="h-11 px-5"
          disabled={busy}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {busy ? 'Processing…' : targetStatus ? 'Activate Source' : 'Deactivate Source'}
        </Button>
      </div>
    </FormDrawer>
  );
}
