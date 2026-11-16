'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LOSS_PRESETS, type LossPreset } from '@/backend/modules/management-reporting/lossLevelContracts';

export const DEFAULT_LOSS_PRESET: LossPreset = 'LAST_30';
export const MAX_LOSS_DAYS = 366;

export interface LossFilters {
  /** A ready range. When from and to are set they win over the preset. */
  preset: LossPreset;
  from: string;
  to: string;
  zmccIds: string[];
  contractorIds: string[];
  motProfileId: string;
}

export const DEFAULT_LOSS_FILTERS: LossFilters = {
  preset: DEFAULT_LOSS_PRESET,
  from: '',
  to: '',
  zmccIds: [],
  contractorIds: [],
  motProfileId: '',
};

const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const csv = (s: string | null | undefined) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** Days from first to last, both counted. Null when a date is missing or wrong. */
export function dayCount(from: string, to: string): number | null {
  if (!isDay(from) || !isDay(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/** Null when the range can be used, otherwise a short reason. */
export function rangeProblem(from: string, to: string): string | null {
  const n = dayCount(from, to);
  if (n === null) return 'Pick both dates.';
  if (n < 1) return 'From must be on or before To.';
  if (n > MAX_LOSS_DAYS) return `Pick at most ${MAX_LOSS_DAYS} days.`;
  return null;
}

export function readLossFilters(params: URLSearchParams | { get(name: string): string | null } | null): LossFilters {
  if (!params) return DEFAULT_LOSS_FILTERS;
  const preset = (params.get('preset') ?? '').toUpperCase();
  const from = params.get('from');
  const to = params.get('to');
  const custom = isDay(from) && isDay(to) && rangeProblem(from, to) === null;
  return {
    preset: (LOSS_PRESETS as readonly string[]).includes(preset) ? (preset as LossPreset) : DEFAULT_LOSS_PRESET,
    from: custom ? from : '',
    to: custom ? to : '',
    zmccIds: csv(params.get('zmccIds')),
    contractorIds: csv(params.get('contractorIds')),
    motProfileId: params.get('motProfileId') ?? '',
  };
}

/** The query the loss endpoints take. A custom range replaces the preset. */
export function lossQueryParams(f: LossFilters, withLists = true): URLSearchParams {
  const q = new URLSearchParams();
  if (f.from && f.to) {
    q.set('from', f.from);
    q.set('to', f.to);
  } else {
    q.set('preset', f.preset);
  }
  if (withLists) {
    if (f.zmccIds.length) q.set('zmccIds', f.zmccIds.join(','));
    if (f.contractorIds.length) q.set('contractorIds', f.contractorIds.join(','));
    if (f.motProfileId) q.set('motProfileId', f.motProfileId);
  }
  return q;
}

const FILTER_KEYS = ['preset', 'from', 'to', 'zmccIds', 'contractorIds', 'motProfileId'] as const;

/** The filters live in the page address, so a link can be shared and a reload keeps the choice. */
export function useLossFilters(): { filters: LossFilters; setFilters: (next: LossFilters) => void } {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = searchParams?.toString() ?? '';
  const filters = useMemo(() => readLossFilters(new URLSearchParams(key)), [key]);

  const setFilters = useCallback(
    (next: LossFilters) => {
      const q = new URLSearchParams(key);
      FILTER_KEYS.forEach((k) => q.delete(k));
      const isDefault =
        !next.from && !next.to && next.preset === DEFAULT_LOSS_PRESET && !next.zmccIds.length && !next.contractorIds.length && !next.motProfileId;
      if (!isDefault) lossQueryParams(next).forEach((v, k) => q.set(k, v));
      const qs = q.toString();
      // The native history API updates the address and useSearchParams at once, with no server round trip, so a
      // quick second tick builds on the first one instead of overwriting it (Next.js "Native History API").
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [key, pathname]
  );

  return { filters, setFilters };
}
