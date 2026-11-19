'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { InfoTip } from '@/components/ui/info-tip';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatOperationalDatetime } from '@/lib/datetime-utils';

type LateTable = 'vehicle_visit' | 'zmcc_mot_arrival' | 'zmcc_local_supplier_arrival' | 'silo_transaction';

interface LateTagResponse {
  window: { id: string; starts_at: string; ends_at: string; reason: string } | null;
}

/** Shows "Entered late (outage)" on Inspect when the record was entered under an outage window. Nothing otherwise. */
export function LateEntryTag({ table, id }: { table: LateTable; id: string | null | undefined }) {
  const query = useQuery({
    queryKey: ['late-entry-tag', table, id],
    queryFn: ({ signal }) => fetchJson<LateTagResponse>(`/api/outage-windows/late-tag?table=${table}&id=${id}`, { signal }),
    enabled: !!id && /^\d+$/.test(id),
    staleTime: 60_000,
  });
  const w = query.data?.window;
  if (!w) return null;
  return (
    <span className="inline-flex items-center">
      <Badge variant="warning">Entered late (outage)</Badge>
      <InfoTip
        label="About this late entry"
        className="-my-2"
        text={`Entered after the site was down, under the outage window ${formatOperationalDatetime(w.starts_at)} – ${formatOperationalDatetime(w.ends_at)}: ${w.reason}`}
      />
    </span>
  );
}
