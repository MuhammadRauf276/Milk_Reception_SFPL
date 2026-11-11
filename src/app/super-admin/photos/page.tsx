'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import type { PhotoRecordStatus, PhotoRegisterRow } from '@/backend/services/photo/photoRegisterService';

const STAGES: Array<[string, string]> = [
  ['', 'All points'],
  ['MOT_SHOP', 'Mobile Tester shop'],
  ['ZMCC_LAB_MC', 'ZMCC lab (Mobile Tester milk)'],
  ['ZMCC_LAB_HC', 'ZMCC lab (supplier milk)'],
  ['ZMCC_DISPATCH', 'ZMCC dispatch'],
  ['CONTRACTOR_DISPATCH', 'Contractor dispatch'],
  ['PLANT_QA', 'Plant QA'],
];
const STAGE_LABEL = Object.fromEntries(STAGES);

const STATUS: Record<PhotoRecordStatus, { label: string; tone: string }> = {
  SUBMITTED: { label: 'Submitted', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  NOT_SUBMITTED: { label: 'Form not submitted', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  NOT_FOUND: { label: 'Record not found', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const select = 'min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground';

export default function PhotoRegisterPage() {
  const pageSize = useListPageSize();
  const [date, setDate] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState<'' | PhotoRecordStatus>('');
  const [takenBy, setTakenBy] = useState('');
  const [page, setPage] = useState(1);
  const reset = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    setPage(1);
  };

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (date) params.set('date', date);
  if (stage) params.set('stage', stage);
  if (status) params.set('status', status);
  if (takenBy.trim()) params.set('takenBy', takenBy.trim());
  const qs = params.toString();

  const query = useQuery({
    queryKey: ['super-admin', 'photos', qs],
    queryFn: ({ signal }) =>
      fetchJson<{ rows: PhotoRegisterRow[]; total: number; counts: Record<PhotoRecordStatus, number> }>(`/api/super-admin/photos?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.rows ?? [];
  const counts = query.data?.counts;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHeader title="Photo register" description="Every photo taken at every point, who took it and where it is stored" />

      {counts && (
        <div className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(STATUS) as PhotoRecordStatus[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => reset(setStatus, status === k ? '' : k)}
              aria-pressed={status === k}
              className={`min-h-11 rounded-md border px-3 font-semibold ${STATUS[k].tone} ${status === k ? 'ring-2 ring-action' : ''}`}
            >
              {STATUS[k].label}: {counts[k]}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3">
        <FormField label="Date taken" htmlFor="ph-date" hint="Empty shows every date.">
          <Input id="ph-date" type="date" value={date} onChange={(e) => reset(setDate, e.target.value)} />
        </FormField>
        <FormField label="Point" htmlFor="ph-stage">
          <select id="ph-stage" value={stage} onChange={(e) => reset(setStage, e.target.value)} className={select}>
            {STAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Taken by" htmlFor="ph-user">
          <Input id="ph-user" value={takenBy} onChange={(e) => reset(setTakenBy, e.target.value)} placeholder="Name, username or code" />
        </FormField>
      </div>

      {query.isPending && <p className="text-sm text-muted-foreground">Loading photos…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-rose-700">
          {getErrorMessage(query.error) || 'Could not load photos.'}
        </p>
      )}
      {query.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">No photo matches these filters.</p>}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li key={r.captureId} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
            <a href={`/api/photos/${r.captureId}?v=${r.version}`} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Open photo: ${r.test}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${r.captureId}?w=320&v=${r.version}`} alt={r.test} className="h-24 w-24 rounded-md border border-border object-cover" loading="lazy" />
            </a>
            <div className="min-w-0 space-y-0.5 text-xs">
              <p className="text-sm font-semibold text-foreground break-words">{r.test}</p>
              <p className="text-secondary-foreground break-words">
                {STAGE_LABEL[r.stage] ?? r.stage}
                {r.source ? ` · ${r.source}` : ''}
              </p>
              {r.record && <p className="text-secondary-foreground break-words">Record: {r.record}</p>}
              <p className="text-secondary-foreground break-words">
                {r.takenBy} · {formatDateTime(r.takenAt)}
                {r.wasOffline ? ' · taken offline' : ''}
              </p>
              <span className={`inline-block rounded-md border px-2 py-0.5 font-semibold ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
              <p className="text-muted-foreground break-all">{r.filePath}</p>
            </div>
          </li>
        ))}
      </ul>

      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil((query.data?.total ?? 0) / pageSize))}
        totalRecords={query.data?.total ?? 0}
        onPageChange={setPage}
        noun="photos"
      />
    </div>
  );
}
