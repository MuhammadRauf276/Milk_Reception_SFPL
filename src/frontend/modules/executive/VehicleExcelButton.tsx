'use client';

import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/frontend/lib/appToast';
import { SOURCE_TYPES, type SourceTypeFilter } from '@/backend/services/management/vehiclePortionReport';
import { EXPORT_GROUPS, type ExportGroupKey } from '@/backend/services/management/vehicleReportExportOptions';

export const SOURCE_TYPE_LABELS: Record<SourceTypeFilter, string> = { ALL: 'Both', ZMCC: 'ZMCC', CONTRACTOR: 'Contractor' };

const ALL_GROUPS = EXPORT_GROUPS.map((g) => g.key);

interface Props {
  /** The dates and filters of the file, or a short reason it cannot be made yet. */
  getParams: () => URLSearchParams | string;
  /** Lets the person choose ZMCC, Contractor or both here, for a screen that has no source filter of its own. */
  chooseSourceType?: boolean;
}

/** Excel button: choose what goes in the file, then download it for the filters on screen. */
export function VehicleExcelButton({ getParams, chooseSourceType = false }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<ExportGroupKey[]>(ALL_GROUPS);
  const [sourceType, setSourceType] = useState<SourceTypeFilter>('ALL');

  const toggle = (key: ExportGroupKey) =>
    setGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const download = async () => {
    const params = getParams();
    if (typeof params === 'string') {
      toast.error(params);
      return;
    }
    if (chooseSourceType) params.set('sourceType', sourceType);
    if (groups.length > 0 && groups.length < ALL_GROUPS.length) params.set('groups', groups.join(','));
    setBusy(true);
    try {
      const res = await fetch(`/api/executive/vehicles/report/export?${params.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'The Excel file could not be made.');
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `vehicle-report-${params.get('from')}-to-${params.get('to')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
      toast.success('Excel file downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The Excel file could not be made.');
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    `min-h-9 px-3 rounded-md text-xs font-semibold border transition ${
      active ? 'bg-primary text-white border-primary' : 'bg-subtle text-secondary-foreground border-border hover:text-foreground'
    }`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition shadow-2xs"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Excel</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {chooseSourceType && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">Dispatched from</p>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Dispatched from">
              {SOURCE_TYPES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={sourceType === t} onClick={() => setSourceType(t)} className={`flex-1 ${chip(sourceType === t)}`}>
                  {SOURCE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Columns</p>
            <button
              type="button"
              onClick={() => setGroups(groups.length === ALL_GROUPS.length ? [] : ALL_GROUPS)}
              className="text-xs font-semibold text-primary hover:underline min-h-9 px-1"
            >
              {groups.length === ALL_GROUPS.length ? 'Clear' : 'All'}
            </button>
          </div>
          {EXPORT_GROUPS.map((g) => (
            <label key={g.key} className="flex items-center gap-2 min-h-9 text-xs text-foreground cursor-pointer">
              <input type="checkbox" checked={groups.includes(g.key)} onChange={() => toggle(g.key)} className="w-4 h-4 accent-primary" />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 min-h-11 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-semibold transition"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          <span>{busy ? 'Making file…' : 'Download'}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
