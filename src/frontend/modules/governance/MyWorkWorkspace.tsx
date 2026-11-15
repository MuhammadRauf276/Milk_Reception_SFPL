'use client';

import React, { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, Eye, FilePenLine, History, Lock, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/frontend/lib/appToast';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { getErrorMessage } from '@/lib/errors';
import { formatDateTime, formatLabel } from '@/lib/format';
import { fetchJson } from '@/lib/query/fetchJson';
import { ticketModuleFor, ticketTarget, type EditorField, type EditorGroup, type EditorSection, type TicketModule } from '@/lib/recordEditor';
import type { MyWorkRow } from '@/backend/services/myWorkService';
import type { SerializedCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { CORRECTION_MODULE_LABELS, CorrectionStatusBadge } from './MyCorrectionTickets';
import { RequestCorrectionModal, type EditableFieldOption } from './RequestCorrectionModal';
import { RequestCorrectionPanel } from './RequestCorrectionPanel';
import { MySubmittedRequestsPanel } from '@/frontend/modules/approvals/MySubmittedRequestsPanel';
import { ErrorPopup } from '@/components/ui/error-popup';

type WorkTab = 'work' | 'requests';

const KIND_LABEL: Record<MyWorkRow['kind'], string> = {
  JOURNEY: 'Mobile Tester milk',
  HC: 'HC supplier milk',
  VISIT: 'Vehicle',
};

/** The list never goes further back than 15 days. */
const RANGES: Array<{ days: number; label: string }> = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 15, label: '15 days' },
];

interface Picked {
  section: EditorSection;
  recordId: string;
  module: TicketModule;
  fields: EditableFieldOption[];
}

function pick(section: EditorSection): Picked | null {
  const ticketModule = ticketModuleFor(section.entity);
  if (!ticketModule) return null;
  const target = ticketTarget(section);
  const fields = section.fields
    .filter((f) => !f.lockedReason && f.type !== 'datetime')
    .map((f) => ({ field: target.fieldKey(f.field), label: `${target.labelPrefix}${f.label}`, currentValue: f.value, type: f.type as EditableFieldOption['type'], options: f.options }));
  return fields.length ? { section, recordId: target.recordId, module: ticketModule, fields } : null;
}

function fieldText(f: EditorField): string {
  if (f.value === null || f.value === '') return '—';
  if (f.type === 'select') return f.options?.find((o) => o.value === String(f.value))?.label ?? String(f.value);
  if (f.type === 'datetime') return String(f.value).replace('T', ' ');
  return String(f.value);
}

/** Previous work and correction requests for the people who enter records. */
export function MyWorkWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: WorkTab = params.get('tab') === 'requests' ? 'requests' : 'work';

  const approvals = useQuery({
    queryKey: ['corrections', 'approve'],
    queryFn: ({ signal }) => fetchJson<{ items?: SerializedCorrectionRequest[] }>('/api/corrections?scope=approve', { signal }),
    staleTime: 20_000,
  });
  const waiting = approvals.data?.items?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <SegmentedTabs<WorkTab>
        label="My work"
        mobileOnly={false}
        fullWidth
        value={tab}
        onValueChange={(next) => router.replace(`${pathname}?tab=${next}`)}
        tabs={[
          { value: 'work', label: 'Previous work', icon: History },
          { value: 'requests', label: 'Requests', icon: FilePenLine, count: waiting > 0 ? waiting : undefined },
        ]}
      />
      {tab === 'work' ? <PreviousWork /> : <Requests toApprove={approvals.data?.items ?? []} />}
    </div>
  );
}

function PreviousWork() {
  const pageSize = useListPageSize(25);
  const [days, setDays] = useState(15);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<MyWorkRow | null>(null);

  const query = useQuery({
    queryKey: ['my-work', days, search, page, pageSize],
    queryFn: ({ signal }) =>
      fetchJson<{ rows: MyWorkRow[]; total: number; days: number }>(
        `/api/my-work?days=${days}&page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo<DataColumn<MyWorkRow>[]>(
    () => [
      { key: 'reference', header: 'Number', label: 'Number', primary: true, cell: (r) => <span className="font-semibold text-foreground whitespace-nowrap">{r.reference}</span> },
      { key: 'at', header: 'Date and time', label: 'Date and time', cardAlways: true, cell: (r) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(r.at)}</span> },
      { key: 'kind', header: 'Type', label: 'Type', cell: (r) => KIND_LABEL[r.kind] },
      { key: 'detail', header: 'Details', label: 'Details', cell: (r) => <span className="break-words">{r.detail || '—'}</span> },
      { key: 'status', header: 'Status', label: 'Status', cell: (r) => (r.status ? formatLabel(r.status) : '—') },
      { key: 'enteredBy', header: 'Entered by', label: 'Entered by', defaultHidden: true, cell: (r) => r.enteredBy || '—' },
      {
        key: 'actions',
        header: '',
        label: 'Inspect',
        actions: true,
        align: 'right',
        cell: (r) => (
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setOpenKey(r)}>
            <Eye aria-hidden />
            Inspect
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <section className="space-y-3" aria-label="Previous work">
      <form
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(input.trim());
        }}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="How far back">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              type="button"
              size="sm"
              variant={days === r.days ? 'default' : 'outline'}
              aria-pressed={days === r.days}
              className="min-h-11 text-xs font-semibold"
              onClick={() => {
                setPage(1);
                setDays(r.days);
              }}
            >
              {r.label}
            </Button>
          ))}
        </div>
        <div className="min-w-[10rem] flex-1">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token, visit or vehicle number" aria-label="Search your work" />
        </div>
        <Button type="submit" variant="outline" className="min-h-11 gap-1.5">
          <Search aria-hidden />
          Search
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 gap-1.5"
            onClick={() => {
              setInput('');
              setSearch('');
              setPage(1);
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.key}
        loading={query.isPending}
        stale={query.isPlaceholderData}
        error={query.isError ? getErrorMessage(query.error) || 'Could not load your work.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No work in this period"
        emptyDescription="Only the last 15 days are listed here. For an older record, use the Requests tab."
        columnPickerId="my-work"
        paginate={false}
        noun="records"
        footer={
          <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} totalRecords={total} pageSize={pageSize} noun="records" disabled={query.isFetching} onPageChange={setPage} />
        }
      />

      <InspectDrawer row={openKey} onClose={() => setOpenKey(null)} />
    </section>
  );
}

/** The full record, loaded only when its row is opened. */
function InspectDrawer({ row, onClose }: { row: MyWorkRow | null; onClose: () => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const query = useQuery({
    queryKey: ['my-work', 'record', row?.key],
    queryFn: ({ signal }) => fetchJson<{ group: EditorGroup }>(`/api/my-work/${row!.key}`, { signal }),
    enabled: !!row,
    staleTime: 15_000,
  });
  const group = query.data?.group;

  return (
    <>
      <ZmccDrawer
        open={!!row}
        onClose={onClose}
        title={row?.reference ?? 'Record'}
        subtitle={row ? `${KIND_LABEL[row.kind]} · ${formatDateTime(row.at)}` : undefined}
        icon={<ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />}
      >
        {query.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        <ErrorPopup message={query.isError ? getErrorMessage(query.error) || 'Could not load the record.' : null} onRetry={() => void query.refetch()} />
        {group && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground break-words">{group.subtitle}</p>
            {group.sections.map((s) => {
              const choice = s.lockedReason ? null : pick(s);
              return (
                <section key={s.key} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{s.stage}</p>
                      <h3 className="text-sm font-semibold text-foreground break-words">{s.title}</h3>
                    </div>
                    {choice ? (
                      <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setPicked(choice)}>
                        <FilePenLine aria-hidden />
                        Request correction
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3.5 shrink-0" aria-hidden />
                        Locked
                      </span>
                    )}
                  </div>
                  {s.lockedReason && <p className="mt-1 text-xs text-muted-foreground">{s.lockedReason}</p>}
                  <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2">
                    {s.fields.map((f) => (
                      <div key={f.field} className="min-w-0">
                        <dt className="text-xs text-muted-foreground break-words">{f.label}</dt>
                        <dd className="text-sm font-medium text-foreground tabular-nums break-words">{fieldText(f)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        )}
      </ZmccDrawer>

      {picked && (
        <RequestCorrectionModal
          key={picked.section.key}
          isOpen
          onClose={() => setPicked(null)}
          module={picked.module}
          recordId={picked.recordId}
          recordIdentifierLabel={`${picked.section.stage} · ${picked.section.title}`}
          availableFields={picked.fields}
          onSuccess={() => toast.success('Correction request sent. Follow it in the Requests tab.')}
        />
      )}
    </>
  );
}

/** A stored field key such as raw_milk_dispatch_note_number or portion:103:fat, made readable. */
function fieldName(t: SerializedCorrectionRequest, field: string): string {
  if (t.fieldLabels[field]) return t.fieldLabels[field];
  const words = field.replace(/^portion:(\d+):/, 'Portion $1 ').replace(/[_:]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function changeText(t: SerializedCorrectionRequest): string {
  const entries = Object.entries(t.requestedChanges);
  if (entries.length === 0) return '—';
  const [field, proposed] = entries[0];
  const label = fieldName(t, field);
  const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
  return `${label}: ${String(t.currentValues[field] ?? '—')} → ${String(proposed)}${more}`;
}

/** Where a request stands, in the order it travels: manager, then the Data Executive or Super Admin. */
function stepText(t: SerializedCorrectionRequest): string {
  if (t.status === 'MANAGER_PENDING') return `Waiting for ${t.managerRole ? formatLabel(t.managerRole) : 'your manager'}`;
  if (t.status === 'REQUESTED' || t.status === 'APPROVED') return 'Waiting for the Data Executive or Super Admin';
  if (t.status === 'APPLIED') return 'Correction made';
  return t.reviewedBy ? `Rejected by ${t.reviewedBy.name}` : 'Rejected';
}

function Requests({ toApprove }: { toApprove: SerializedCorrectionRequest[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<{ ticket: SerializedCorrectionRequest; canDecide: boolean } | null>(null);
  const [findOlder, setFindOlder] = useState(false);

  const mine = useQuery({
    queryKey: ['corrections', 'mine'],
    queryFn: ({ signal }) => fetchJson<{ items?: SerializedCorrectionRequest[] }>('/api/corrections?status=ALL&scope=mine', { signal }),
    staleTime: 20_000,
  });

  const columns = (canDecide: boolean): DataColumn<SerializedCorrectionRequest>[] => [
    {
      key: 'record',
      header: 'Record',
      label: 'Record',
      primary: true,
      cell: (t) => <span className="font-semibold text-foreground break-words">{CORRECTION_MODULE_LABELS[t.module] ?? formatLabel(t.module)} · {t.recordId}</span>,
    },
    { key: 'at', header: 'Sent', label: 'Sent', cardAlways: true, cell: (t) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(t.requestedAt)}</span> },
    ...(canDecide ? [{ key: 'by', header: 'Sent by', label: 'Sent by', cell: (t: SerializedCorrectionRequest) => t.requestedBy.name }] : []),
    { key: 'change', header: 'Change asked', label: 'Change asked', cell: (t) => <span className="break-words">{changeText(t)}</span> },
    { key: 'status', header: 'Status', label: 'Status', cardAlways: true, cell: (t) => <CorrectionStatusBadge label={t.statusLabel} /> },
    {
      key: 'actions',
      header: '',
      label: 'Inspect',
      actions: true,
      align: 'right',
      cell: (t) => (
        <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setOpen({ ticket: t, canDecide })}>
          <Eye aria-hidden />
          {canDecide ? 'Review' : 'Inspect'}
        </Button>
      ),
    },
  ];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['corrections'] });
  };

  return (
    <section className="space-y-5" aria-label="Requests">
      {toApprove.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Waiting for your approval</h2>
          <DataTable columns={columns(true)} rows={toApprove} getRowId={(t) => t.id} noun="requests" emptyTitle="Nothing is waiting for you" />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Correction requests</h2>
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setFindOlder((v) => !v)} aria-expanded={findOlder}>
            <Search aria-hidden />
            {findOlder ? 'Hide search' : 'Request for an older record'}
          </Button>
        </div>
        {findOlder && <RequestCorrectionPanel embedded />}
        <DataTable
          columns={columns(false)}
          rows={mine.data?.items ?? []}
          getRowId={(t) => t.id}
          loading={mine.isPending}
          error={mine.isError ? getErrorMessage(mine.error) || 'Could not load your requests.' : null}
          onRetry={() => void mine.refetch()}
          noun="requests"
          emptyTitle="No correction requests yet"
          emptyDescription="Open a record in Previous work and choose Request correction."
        />
      </div>

      <MySubmittedRequestsPanel embedded />

      <TicketDrawer open={open} onClose={() => setOpen(null)} onDecided={refresh} />
    </section>
  );
}

function TicketDrawer({
  open,
  onClose,
  onDecided,
}: {
  open: { ticket: SerializedCorrectionRequest; canDecide: boolean } | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = open?.ticket;

  const close = () => {
    setNote('');
    setError(null);
    onClose();
  };

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    if (!t) return;
    if (decision === 'REJECT' && note.trim().length < 3) {
      setError('Write why you are rejecting it (at least 3 letters).');
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await fetchJson(`/api/corrections/${t.id}/manager-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      });
      toast.success(decision === 'APPROVE' ? 'Approved. Sent to the Data Executive and Super Admin.' : 'Request rejected.');
      onDecided();
      close();
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save the decision.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ZmccDrawer
      open={!!open}
      onClose={close}
      title={t ? `${CORRECTION_MODULE_LABELS[t.module] ?? formatLabel(t.module)} · ${t.recordId}` : 'Request'}
      subtitle={t ? `Sent ${formatDateTime(t.requestedAt)} by ${t.requestedBy.name}` : undefined}
      icon={<FilePenLine className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />}
    >
      {t && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CorrectionStatusBadge label={t.statusLabel} />
            <span className="text-xs text-secondary-foreground">{stepText(t)}</span>
          </div>

          <div className="rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Value</th>
                  <th scope="col" className="px-3 py-2 font-medium">Now</th>
                  <th scope="col" className="px-3 py-2 font-medium">Asked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(t.requestedChanges).map(([field, proposed]) => (
                  <tr key={field}>
                    <td className="px-3 py-2 break-words">{fieldName(t, field)}</td>
                    <td className="px-3 py-2 tabular-nums text-rose-700 break-words">{String(t.currentValues[field] ?? '—')}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700 break-words">{String(proposed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="break-words"><span className="text-muted-foreground">Reason: </span>{t.reason}</p>
          {t.managerApproval && (
            <p className="break-words text-secondary-foreground">
              Approved by {t.managerApproval.name} ({formatLabel(t.managerApproval.role)}) on {formatDateTime(t.managerApproval.at)}
              {t.managerApproval.note ? `: ${t.managerApproval.note}` : ''}
            </p>
          )}
          {t.reviewReason && <p className="break-words"><span className="text-muted-foreground">Answer: </span>{t.reviewReason}</p>}

          {open?.canDecide && t.status === 'MANAGER_PENDING' && (
            <div className="space-y-2 border-t border-border pt-3">
              <label htmlFor="manager-note" className="text-xs font-medium text-foreground">
                Note (needed to reject)
              </label>
              <Textarea id="manager-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-base sm:text-sm" />
              {error && (
                <p role="alert" className="text-xs font-semibold text-rose-700">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="min-h-12 flex-1 gap-1.5" loading={busy === 'APPROVE'} disabled={!!busy} onClick={() => void decide('APPROVE')}>
                  <Check aria-hidden />
                  Approve and send on
                </Button>
                <Button type="button" variant="destructive" className="min-h-12 flex-1 gap-1.5" loading={busy === 'REJECT'} disabled={!!busy} onClick={() => void decide('REJECT')}>
                  <X aria-hidden />
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ZmccDrawer>
  );
}
