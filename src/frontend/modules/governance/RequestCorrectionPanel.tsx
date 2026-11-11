'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/frontend/lib/appToast';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { ticketModuleFor, ticketTarget, type EditorGroup, type EditorSection, type TicketModule } from '@/lib/recordEditor';
import { MyCorrectionTicketsButton } from './MyCorrectionTickets';
import { RequestCorrectionModal, type EditableFieldOption } from './RequestCorrectionModal';

interface Picked {
  section: EditorSection;
  recordId: string;
  module: TicketModule;
  fields: EditableFieldOption[];
}

function pick(section: EditorSection): Picked | null {
  const module = ticketModuleFor(section.entity);
  if (!module) return null;
  const target = ticketTarget(section);
  const fields = section.fields
    .filter((f) => !f.lockedReason && f.type !== 'datetime')
    .map((f) => ({ field: target.fieldKey(f.field), label: `${target.labelPrefix}${f.label}`, currentValue: f.value, type: f.type as EditableFieldOption['type'], options: f.options }));
  return fields.length ? { section, recordId: target.recordId, module, fields } : null;
}

/** Find a saved record of your own stage and ask the Data Executive to correct one value. */
export function RequestCorrectionPanel() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);

  const query = useQuery({
    queryKey: ['corrections', 'requestable', search],
    queryFn: ({ signal }) =>
      fetchJson<{ groups: EditorGroup[] }>(`/api/corrections/requestable?search=${encodeURIComponent(search)}`, { signal }),
    enabled: search.length >= 2,
  });
  const groups = query.data?.groups ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary-foreground">Find the record, then say which value is wrong.</p>
        <MyCorrectionTicketsButton />
      </div>

      <form
        className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input.trim());
        }}
      >
        <div className="min-w-[10rem] flex-1">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Token, journey, visit or vehicle number"
            aria-label="Search your records"
          />
        </div>
        <Button type="submit" disabled={input.trim().length < 2} className="gap-1.5">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {search.length >= 2 && query.isPending && <p className="text-sm text-muted-foreground">Searching…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-rose-700">
          {getErrorMessage(query.error) || 'Could not search records.'}
        </p>
      )}
      {search.length >= 2 && query.isSuccess && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No record of yours matches “{search}”.</p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground break-words">{g.title}</h2>
          <p className="text-xs text-muted-foreground break-words">{g.subtitle}</p>
          <ul className="mt-1 divide-y divide-border">
            {g.sections.map((s) => {
              const choice = s.lockedReason ? null : pick(s);
              return (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{s.stage}</p>
                    <p className="text-sm text-foreground break-words">{s.title}</p>
                    {s.lockedReason && <p className="text-xs text-muted-foreground">{s.lockedReason}</p>}
                  </div>
                  {choice ? (
                    <Button type="button" variant="outline" size="sm" className="min-h-11 text-xs font-semibold" onClick={() => setPicked(choice)}>
                      Choose
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3.5 shrink-0" aria-hidden />
                      Locked
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {picked && (
        <RequestCorrectionModal
          key={picked.section.key}
          isOpen
          onClose={() => setPicked(null)}
          module={picked.module}
          recordId={picked.recordId}
          recordIdentifierLabel={`${picked.section.stage} · ${picked.section.title}`}
          availableFields={picked.fields}
          onSuccess={() => toast.success('Correction request sent. Follow it under My correction requests.')}
        />
      )}
    </div>
  );
}
