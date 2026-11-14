'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Camera, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataFilters, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
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

const select = 'min-h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-hidden';

export default function PhotoRegisterPage() {
  const pageSize = useListPageSize(25);
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
  const total = query.data?.total ?? rows.length;

  const activeFilters: ActiveFilter[] = [];
  if (date) activeFilters.push({ key: 'date', label: `Date: ${date}`, onClear: () => reset(setDate, '') });
  if (stage) activeFilters.push({ key: 'stage', label: `Point: ${STAGE_LABEL[stage] ?? stage}`, onClear: () => reset(setStage, '') });
  if (status) activeFilters.push({ key: 'status', label: `Status: ${STATUS[status].label}`, onClear: () => reset(setStatus, '') });
  if (takenBy.trim()) activeFilters.push({ key: 'takenBy', label: `User: ${takenBy.trim()}`, onClear: () => reset(setTakenBy, '') });

  const columns: DataColumn<PhotoRegisterRow>[] = [
    {
      key: 'preview',
      header: 'Preview',
      label: 'Preview',
      cell: (r) => (
        <a href={`/api/photos/${r.captureId}?v=${r.version}`} target="_blank" rel="noreferrer" className="inline-block shrink-0" aria-label={`Open photo: ${r.test}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photos/${r.captureId}?w=320&v=${r.version}`}
            alt={r.test}
            className="h-12 w-14 rounded-md border border-border object-cover bg-muted"
            loading="lazy"
          />
        </a>
      ),
    },
    {
      key: 'test',
      header: 'Test & Point',
      label: 'Test & Point',
      primary: true,
      cell: (r) => (
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground break-words">{r.test}</p>
          <p className="text-xs text-secondary-foreground break-words">
            {STAGE_LABEL[r.stage] ?? r.stage}
            {r.source ? ` · ${r.source}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cardAlways: true,
      cell: (r) => (
        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS[r.status].tone}`}>
          {STATUS[r.status].label}
        </span>
      ),
    },
    {
      key: 'takenBy',
      header: 'Taken by',
      label: 'Taken by',
      cardAlways: true,
      cell: (r) => (
        <div className="text-xs text-secondary-foreground break-words">
          <div className="font-medium text-foreground">{r.takenBy}</div>
          <div className="tabular-nums text-muted-foreground">
            {formatDateTime(r.takenAt)}
            {r.wasOffline ? ' · taken offline' : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'record',
      header: 'Record & File',
      label: 'Record & File',
      cell: (r) => (
        <div className="min-w-0 space-y-0.5 text-xs">
          {r.record ? <p className="text-secondary-foreground break-words">Record: {r.record}</p> : null}
          <p className="text-muted-foreground break-all font-mono">{r.filePath}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Photo',
      label: 'Photo',
      actions: true,
      align: 'right',
      cell: (r) => (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/photos/${r.captureId}?v=${r.version}`} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            Open photo
          </a>
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      <div className="w-full min-w-0 max-w-full rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Photo register</h2>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {total}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">Every capture, user, and storage path</span>
            </div>
            {counts ? (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(Object.keys(STATUS) as PhotoRecordStatus[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => reset(setStatus, status === k ? '' : k)}
                    aria-pressed={status === k}
                    className={`min-h-11 rounded-lg border px-3 font-semibold transition-colors ${STATUS[k].tone} ${
                      status === k ? 'ring-2 ring-action' : 'hover:opacity-90'
                    }`}
                  >
                    {STATUS[k].label}: {counts[k]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <DataFilters
            search={takenBy}
            onSearchChange={(v) => reset(setTakenBy, v)}
            searchPlaceholder="Taken by (name, username or code)"
            active={activeFilters}
          >
            <Input
              id="ph-date"
              type="date"
              aria-label="Date taken"
              value={date}
              onChange={(e) => reset(setDate, e.target.value)}
              className="w-full sm:w-44"
            />
            <select
              id="ph-stage"
              aria-label="Point"
              value={stage}
              onChange={(e) => reset(setStage, e.target.value)}
              className={`${select} w-full sm:w-56`}
            >
              {STAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </DataFilters>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            paginate={false}
            columns={columns}
            rows={rows}
            getRowId={(r) => r.captureId}
            loading={query.isPending}
            stale={query.isPlaceholderData}
            error={query.isError ? getErrorMessage(query.error) || 'Could not load photos.' : null}
            onRetry={() => void query.refetch()}
            emptyTitle="No photo matches these filters."
            tableFrom="lg"
          />
        </div>

        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          totalRecords={total}
          pageSize={pageSize}
          onPageChange={setPage}
          noun="photos"
          disabled={query.isFetching}
          className="border-t border-border bg-card"
        />
      </div>
    </div>
  );
}
