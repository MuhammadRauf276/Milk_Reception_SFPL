'use client';

import React, { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ImagePlus, Lock, Pencil, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { FileUploadProgress } from '@/components/ui/progress';
import { formatDate, formatTime } from '@/lib/format';
import { toast } from '@/frontend/lib/appToast';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { buildEditorSave, changedFields, type EditorField, type EditorGroup, type EditorPhoto, type EditorPhotoSlot, type EditorSection } from '@/lib/recordEditor';
import { ErrorPopup } from '@/components/ui/error-popup';

const MIN_REASON = 5;

const shown = (f: EditorField) => {
  if (f.value === null || f.value === '') return '—';
  return f.type === 'datetime' ? String(f.value).replace('T', ' ') : String(f.value);
};

function SectionRow({ section, onEdit, onPhoto, onAddPhoto }: { section: EditorSection; onEdit: () => void; onPhoto: (p: EditorPhoto) => void; onAddPhoto: (s: EditorPhotoSlot) => void }) {
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{section.stage}</p>
          <p className="text-sm font-semibold text-foreground break-words">{section.title}</p>
        </div>
        {section.lockedReason ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            Locked
          </span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onEdit} className="min-h-11 gap-1.5 text-xs font-semibold">
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-4 gap-y-1.5">
        {section.fields.map((f) => (
          <div key={f.field} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="text-sm tabular-nums text-foreground break-words">{shown(f)}</dd>
          </div>
        ))}
      </dl>
      {section.photos && section.photos.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {section.photos.map((p) => (
            <button key={p.captureId} type="button" onClick={() => onPhoto(p)} className="w-24 space-y-1 text-left" aria-label={`Replace photo: ${p.label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${p.captureId}?w=320&v=${p.version}`} alt={p.label} className="h-16 w-24 rounded-md border border-border object-cover" />
              <span className="block truncate text-xs text-muted-foreground">{p.label}</span>
              <span className="block text-xs font-semibold text-action">Replace</span>
            </button>
          ))}
        </div>
      )}
      {section.photoSlots && section.photoSlots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {section.photoSlots.map((slot) => (
            <Button key={slot.key} type="button" variant="outline" size="sm" onClick={() => onAddPhoto(slot)} className="min-h-11 gap-1.5 text-xs font-semibold">
              <ImagePlus aria-hidden />
              Add photo: {slot.label}
            </Button>
          ))}
        </div>
      )}
      {section.lockedReason && <p className="text-xs text-muted-foreground">{section.lockedReason}</p>}
      {section.correctionCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Corrected {section.correctionCount} {section.correctionCount === 1 ? 'time' : 'times'}
        </p>
      )}
    </li>
  );
}

function EditForm({ section, onClose, onSaved }: { section: EditorSection; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(section.fields.map((f) => [f.field, f.value === null ? '' : String(f.value)]))
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per open form, so a repeated click cannot save the same correction twice.
  const saveKey = useRef(`editor-${section.key}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const changes = useMemo(() => changedFields(section, draft), [section, draft]);
  const changedLabels = section.fields.filter((f) => f.field in changes);
  const canSave = changedLabels.length > 0 && reason.trim().length >= MIN_REASON && !saving;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const request = buildEditorSave(section, changes, reason.trim(), saveKey.current);
      await fetchJson(request.url, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      toast.success('Correction saved.');
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save the correction. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1 border-b border-border p-5 pr-14">
        <p className="text-xs text-muted-foreground">{section.stage}</p>
        <DrawerTitle className="text-base font-semibold text-foreground break-words">{section.title}</DrawerTitle>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {section.fields.map((f) => (
            <FormField key={f.field} label={f.label} htmlFor={`edit-${f.field}`} hint={f.lockedReason ?? undefined}>
              {f.type === 'select' ? (
                <select
                  id={`edit-${f.field}`}
                  value={draft[f.field]}
                  disabled={Boolean(f.lockedReason)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.field]: e.target.value }))}
                  className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`edit-${f.field}`}
                  type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={draft[f.field]}
                  disabled={Boolean(f.lockedReason)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.field]: e.target.value }))}
                />
              )}
            </FormField>
          ))}
        </div>

        <FormField label="Reason for this correction" htmlFor="edit-reason" required hint="Saved in the audit log with your name.">
          <textarea
            id="edit-reason"
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-card p-3 text-sm text-foreground"
          />
        </FormField>

        {changedLabels.length > 0 && (
          <div className="space-y-1 rounded-xl border border-border p-3">
            <p className="text-xs font-semibold text-foreground">Will change</p>
            {changedLabels.map((f) => (
              <p key={f.field} className="text-xs tabular-nums text-secondary-foreground break-words">
                {f.label}: {shown(f)} → <strong className="text-foreground">{draft[f.field].replace('T', ' ') || '—'}</strong>
              </p>
            ))}
          </div>
        )}

        <ErrorPopup message={error} onClear={() => setError(null)} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle p-4">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="default"
          loading={saving}
          loadingText="Saving…"
          disabled={!canSave}
        >
          Save correction
        </Button>
      </div>
    </form>
  );
}

/** Replace a saved photo, or add one where none was taken (`slot`). */
function PhotoForm({ photo, slot, onClose, onSaved }: { photo?: EditorPhoto; slot?: EditorPhotoSlot; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'complete' | 'error'>('idle');

  const choose = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    setUploadProgress(0);
    setUploadStatus('idle');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || reason.trim().length < MIN_REASON || saving) return;
    setSaving(true);
    setError(null);
    setUploadStatus('uploading');
    setUploadProgress(25);
    try {
      const size = await createImageBitmap(file);
      setUploadProgress(50);
      const form = new FormData();
      form.set('file', file);
      form.set('reason', reason.trim());
      form.set('width', String(size.width));
      form.set('height', String(size.height));
      setUploadStatus('processing');
      setUploadProgress(75);
      if (photo) {
        await fetchJson(`/api/corrections/photos/${photo.captureId}`, { method: 'POST', body: form });
      } else if (slot) {
        form.set('entityType', slot.entityType);
        form.set('entityId', slot.entityId);
        form.set('labTestId', slot.labTestId ?? '');
        form.set('photoKind', slot.photoKind);
        await fetchJson('/api/corrections/photos', { method: 'POST', body: form });
      }
      setUploadProgress(100);
      setUploadStatus('complete');
      toast.success(photo ? 'Photo replaced.' : 'Photo added.');
      setTimeout(() => {
        onSaved();
      }, 400);
    } catch (err) {
      setUploadStatus('error');
      setError(getErrorMessage(err) || 'Could not save the photo. Nothing was changed.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-5 pr-14">
        <DrawerTitle className="text-base font-semibold text-foreground break-words">{photo ? `Replace photo: ${photo.label}` : `Add photo: ${slot?.label}`}</DrawerTitle>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Now</p>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/photos/${photo.captureId}?w=320&v=${photo.version}`} alt="Current" className="w-full rounded-md border border-border" />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">No photo</div>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">New</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview ? <img src={preview} alt="New" className="w-full rounded-md border border-border" /> : <div className="aspect-[4/3] rounded-md border border-dashed border-border" />}
          </div>
        </div>
        <FormField label="New photo (JPEG, up to 4 MB)" htmlFor="photo-file" required>
          <Input id="photo-file" type="file" accept="image/jpeg" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </FormField>
        {file && (
          <FileUploadProgress
            fileName={file.name}
            fileSize={file.size}
            progress={uploadProgress}
            status={uploadStatus === 'idle' ? undefined : uploadStatus}
            errorMessage={error ?? undefined}
          />
        )}
        <FormField label="Reason for this correction" htmlFor="photo-reason" required hint={photo ? 'The old picture is kept and the change is saved in the audit log.' : 'Saved in the audit log with your name.'}>
          <textarea id="photo-reason" value={reason} rows={3} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-border bg-card p-3 text-sm text-foreground" />
        </FormField>
        <ErrorPopup message={error} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle p-4">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="default"
          loading={saving}
          loadingText={photo ? 'Replacing photo…' : 'Adding photo…'}
          disabled={!file || reason.trim().length < MIN_REASON}
        >
          {photo ? 'Replace photo' : 'Add photo'}
        </Button>
      </div>
    </form>
  );
}

/** Every saved transaction, newest first. Open one to correct any stage of it. Super Admin only. */
export function RecordEditor() {
  const queryClient = useQueryClient();
  const pageSize = useListPageSize();
  const [date, setDate] = useState('');
  const [stage, setStage] = useState('ALL');
  const [enteredBy, setEnteredBy] = useState('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorSection | null>(null);
  const [photo, setPhoto] = useState<EditorPhoto | null>(null);
  const [slot, setSlot] = useState<EditorPhotoSlot | null>(null);

  const params = new URLSearchParams({ stage, page: String(page), pageSize: String(pageSize) });
  if (date) params.set('date', date);
  if (enteredBy.trim()) params.set('enteredBy', enteredBy.trim());
  if (search) params.set('search', search);
  const queryString = params.toString();

  const query = useQuery({
    queryKey: ['corrections', 'record-editor', queryString],
    queryFn: ({ signal }) => fetchJson<{ groups: EditorGroup[]; total: number }>(`/api/corrections/records?${queryString}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const groups = query.data?.groups ?? [];
  const total = query.data?.total ?? 0;
  const resetTo = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    setPage(1);
    setExpanded(null);
  };

  let lastDay = '';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Date" htmlFor="rec-date" hint="Empty shows every date.">
          <Input id="rec-date" type="date" value={date} onChange={(e) => resetTo(setDate, e.target.value)} />
        </FormField>
        <FormField label="Stage" htmlFor="rec-stage">
          <select
            id="rec-stage"
            value={stage}
            onChange={(e) => resetTo(setStage, e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="ALL">All stages</option>
            <option value="SHOP">1. Shop collection</option>
            <option value="MC">2. ZMCC arrival and lab: Mobile Tester milk</option>
            <option value="HC">2. ZMCC arrival and lab: HC suppliers</option>
            <option value="DISPATCH">3. Dispatch</option>
            <option value="PLANT">4. Plant: gate, weighbridge, QA, unloading</option>
          </select>
        </FormField>
        <FormField label="Entered by" htmlFor="rec-user">
          <Input id="rec-user" value={enteredBy} onChange={(e) => resetTo(setEnteredBy, e.target.value)} placeholder="Name or username" />
        </FormField>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resetTo(setSearch, input.trim());
          }}
        >
          <FormField label="Number" htmlFor="rec-search">
            <div className="flex gap-2">
              <Input id="rec-search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token, visit, vehicle" />
              <Button type="submit" aria-label="Search" className="shrink-0">
                <Search aria-hidden />
              </Button>
            </div>
          </FormField>
        </form>
      </div>

      {query.isPending && <p className="text-sm text-muted-foreground">Loading transactions…</p>}
      <ErrorPopup message={query.isError ? getErrorMessage(query.error) || 'Could not load records.' : null} onRetry={() => void query.refetch()} />
      {query.isSuccess && groups.length === 0 && <p className="text-sm text-muted-foreground">No transaction matches these filters.</p>}

      <div className="space-y-2">
        {groups.map((g) => {
          const day = g.at ? formatDate(g.at) : '';
          const heading = day !== lastDay ? day : null;
          lastDay = day;
          const isOpen = expanded === g.key;
          return (
            <React.Fragment key={g.key}>
              {heading && <h2 className="pt-2 text-sm font-semibold text-foreground">{heading}</h2>}
              <section className="rounded-2xl border border-border bg-card">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : g.key)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground break-words">{g.title}</span>
                    <span className="block text-xs text-muted-foreground break-words">
                      {g.subtitle}
                      {g.at ? ` · ${formatTime(g.at)}` : ''}
                      {g.enteredBy ? ` · ${g.enteredBy}` : ''}
                    </span>
                  </span>
                  <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {isOpen && (
                  <ul className="divide-y divide-border border-t border-border px-4">
                    {g.sections.map((s) => (
                      <SectionRow key={s.key} section={s} onEdit={() => setEditing(s)} onPhoto={setPhoto} onAddPhoto={setSlot} />
                    ))}
                  </ul>
                )}
              </section>
            </React.Fragment>
          );
        })}
      </div>

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalRecords={total} onPageChange={setPage} noun="transactions" />

      <Drawer open={photo !== null || slot !== null} onOpenChange={(open) => !open && (setPhoto(null), setSlot(null))}>
        <DrawerContent className="max-w-2xl">
          {(photo || slot) && (
            <PhotoForm
              key={photo?.captureId ?? slot?.key}
              photo={photo ?? undefined}
              slot={slot ?? undefined}
              onClose={() => {
                setPhoto(null);
                setSlot(null);
              }}
              onSaved={() => {
                setPhoto(null);
                setSlot(null);
                void queryClient.invalidateQueries({ queryKey: ['corrections', 'record-editor'] });
              }}
            />
          )}
        </DrawerContent>
      </Drawer>

      <Drawer open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DrawerContent className="max-w-2xl">
          {editing && (
            <EditForm
              key={editing.key}
              section={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void queryClient.invalidateQueries({ queryKey: ['corrections', 'record-editor'] });
              }}
            />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
