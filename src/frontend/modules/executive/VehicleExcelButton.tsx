'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/frontend/lib/appToast';
import { fetchJson } from '@/lib/query/fetchJson';
import { SOURCE_TYPES, type SourceTypeFilter } from '@/backend/services/management/vehiclePortionReport';
import {
  ALL_VALUES,
  DEFAULT_GROUPS,
  DEFAULT_SHEETS,
  EXPORT_GROUPS,
  EXPORT_SHEETS,
  EXPORT_VALUES,
  type ExportGroupKey,
  type ExportSheetKey,
  type ExportValueKey,
} from '@/backend/services/management/vehicleReportExportOptions';

export const SOURCE_TYPE_LABELS: Record<SourceTypeFilter, string> = { ALL: 'Both', ZMCC: 'ZMCC', CONTRACTOR: 'Contractor' };

interface LabTestOption {
  id: string;
  name: string;
  unit: string | null;
}

interface Props {
  /** The dates and filters of the file, or a short reason it cannot be made yet. */
  getParams: () => URLSearchParams | string;
  /** Lets the person choose ZMCC, Contractor or both here, for a screen that has no source filter of its own. */
  chooseSourceType?: boolean;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between min-h-9">
        <p className="text-xs font-semibold text-secondary-foreground">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center gap-2.5 min-h-10 px-2 -mx-2 rounded-md text-xs text-foreground cursor-pointer hover:bg-subtle">
      <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 accent-primary shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </label>
  );
}

const linkClass = 'text-xs font-semibold text-primary hover:underline min-h-9 px-1 rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/** Excel button: choose the sheets, the values, the columns and the tests, then download for the filters on screen. */
export function VehicleExcelButton({ getParams, chooseSourceType = false }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<ExportSheetKey[]>(DEFAULT_SHEETS);
  const [values, setValues] = useState<ExportValueKey[]>(ALL_VALUES);
  const [groups, setGroups] = useState<ExportGroupKey[]>(DEFAULT_GROUPS);
  const [testIds, setTestIds] = useState<string[] | null>(null); // null: all tests
  const [sourceType, setSourceType] = useState<SourceTypeFilter>('ALL');

  const wantsTests = sheets.includes('tests');
  const testsQuery = useQuery({
    queryKey: ['executive', 'vehicle-report-tests'],
    queryFn: ({ signal }) => fetchJson<{ items: LabTestOption[] }>('/api/executive/vehicles/tests', { signal }),
    enabled: open && wantsTests,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const allTests = testsQuery.data?.items ?? [];
  const chosenTests = testIds ?? allTests.map((t) => t.id);

  const usesColumns = sheets.includes('vehicles') || sheets.includes('portions');
  const problem =
    sheets.length === 0
      ? 'Choose at least one sheet.'
      : (usesColumns || wantsTests) && values.length === 0
      ? 'Choose Dispatch, Plant or Difference.'
      : wantsTests && testIds !== null && testIds.length === 0
      ? 'Choose at least one lab test.'
      : null;

  const download = async () => {
    const params = getParams();
    if (typeof params === 'string') {
      toast.error(params);
      return;
    }
    if (problem) {
      toast.error(problem);
      return;
    }
    if (chooseSourceType) params.set('sourceType', sourceType);
    params.set('sheets', sheets.join(','));
    params.set('values', values.join(','));
    params.set('groups', groups.join(','));
    if (wantsTests && testIds !== null) params.set('tests', testIds.join(','));
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

  const segment = (active: boolean) =>
    `flex-1 min-h-9 px-3 rounded-md text-xs font-semibold transition ${
      active ? 'bg-primary text-white shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
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
      <PopoverContent
        align="end"
        collisionPadding={16}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-80 p-0 flex flex-col max-h-[min(36rem,var(--radix-popover-content-available-height))] overflow-hidden"
      >
        <div className="px-4 pt-3 pb-2 border-b border-border/60">
          <p className="text-sm font-semibold text-foreground">Excel file</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3">
          {chooseSourceType && (
            <Section title="Dispatched from">
              <div className="flex gap-1 p-1 rounded-lg bg-muted/60 border border-border" role="radiogroup" aria-label="Dispatched from">
                {SOURCE_TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={sourceType === t} onClick={() => setSourceType(t)} className={segment(sourceType === t)}>
                    {SOURCE_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Sheets">
            {EXPORT_SHEETS.map((s) => (
              <Check key={s.key} checked={sheets.includes(s.key)} onChange={() => setSheets((prev) => toggle(prev, s.key))} label={s.label} hint={s.hint} />
            ))}
          </Section>

          <Section title="Compare">
            <div className="flex gap-1 p-1 rounded-lg bg-muted/60 border border-border" role="group" aria-label="Values to compare">
              {EXPORT_VALUES.map((v) => (
                <button key={v.key} type="button" aria-pressed={values.includes(v.key)} onClick={() => setValues((prev) => toggle(prev, v.key))} className={segment(values.includes(v.key))}>
                  {v.label}
                </button>
              ))}
            </div>
          </Section>

          {usesColumns && (
            <Section
              title="Columns"
              action={
                <button type="button" onClick={() => setGroups(groups.length === EXPORT_GROUPS.length ? [] : EXPORT_GROUPS.map((g) => g.key))} className={linkClass}>
                  {groups.length === EXPORT_GROUPS.length ? 'Select none' : 'Select all'}
                </button>
              }
            >
              {EXPORT_GROUPS.map((g) => (
                <Check key={g.key} checked={groups.includes(g.key)} onChange={() => setGroups((prev) => toggle(prev, g.key))} label={g.label} />
              ))}
              <p className="text-xs text-muted-foreground pt-1">Always includes date, vehicle, token, source, decision.</p>
            </Section>
          )}

          {wantsTests && (
            <Section
              title={`Lab tests (${chosenTests.length} of ${allTests.length})`}
              action={
                <button type="button" onClick={() => setTestIds(testIds === null ? [] : null)} className={linkClass}>
                  {testIds === null ? 'Select none' : 'Select all'}
                </button>
              }
            >
              {testsQuery.isPending && <p className="text-xs text-muted-foreground py-2">Loading…</p>}
              {allTests.map((t) => (
                <Check
                  key={t.id}
                  checked={chosenTests.includes(t.id)}
                  onChange={() => {
                    const next = toggle(chosenTests, t.id);
                    setTestIds(next.length === allTests.length ? null : next);
                  }}
                  label={t.name}
                  hint={t.unit ?? undefined}
                />
              ))}
            </Section>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border/60 bg-card space-y-1.5">
          {problem && <p className="text-xs font-semibold text-rose-800">{problem}</p>}
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy || problem != null}
            className="w-full inline-flex items-center justify-center gap-2 min-h-11 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-semibold transition"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            <span>{busy ? 'Making file…' : 'Download'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
