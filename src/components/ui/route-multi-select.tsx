'use client';

import React from 'react';

export interface RouteChoice {
  id: string;
  name: string;
  route_code: string;
}

interface Props {
  routes: RouteChoice[];
  /** The shop's home route; it is shown as taken and never added twice. */
  homeRouteId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  idPrefix?: string;
}

/** Tick the extra routes a shop is also listed on. Tall tap targets, no sideways scroll. */
export function RouteMultiSelect({ routes, homeRouteId, value, onChange, idPrefix = 'extra-route' }: Props) {
  const choices = routes.filter((r) => r.id !== homeRouteId);
  if (choices.length === 0) {
    return <p className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">No other routes.</p>;
  }
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border">
      {choices.map((r) => (
        <label key={r.id} htmlFor={`${idPrefix}-${r.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-xs font-semibold text-foreground">
          <input
            id={`${idPrefix}-${r.id}`}
            type="checkbox"
            checked={value.includes(r.id)}
            onChange={() => toggle(r.id)}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 break-words">{r.name} · {r.route_code}</span>
        </label>
      ))}
    </div>
  );
}
