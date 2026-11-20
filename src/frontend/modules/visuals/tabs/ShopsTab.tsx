'use client';

import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';
import type { QtyPair } from '@/backend/modules/management-reporting/visuals/common';
import { completionPct, type ShopsDayRow, type ShopsVisuals } from '@/backend/modules/management-reporting/visuals/shopsContracts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  AcceptRejectBars,
  ChartCard,
  ChartGrid,
  DonutChart,
  EmptyChart,
  KpiRow,
  KpiTile,
  PickList,
  RankedBarsChart,
  SERIES_COLORS,
  STAGE_COLORS,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtCompact,
  fmtLiters,
  fmtNum,
  fmtPct,
  share,
  useVisuals,
  type TrendSeries,
  type VisualColumn,
} from '../visualsKit';

type DayWithOthers = ShopsDayRow & { others: QtyPair };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Adds the milk of every route that is not one of the top routes, from the day's total. */
function withOthers(r: ShopsDayRow): DayWithOthers {
  const top = Object.values(r.byRoute).reduce((s, p) => ({ liters: s.liters + p.liters, at13ts: s.at13ts + p.at13ts }), { liters: 0, at13ts: 0 });
  return { ...r, others: { liters: r2(Math.max(0, r.collected.liters - top.liters)), at13ts: r2(Math.max(0, r.collected.at13ts - top.at13ts)) } };
}

function totalsOf(days: ShopsDayRow[]) {
  const t = { liters: 0, at13ts: 0, accepted: 0, rejected: 0, planned: 0, done: 0 };
  for (const d of days) {
    t.liters += d.collected.liters;
    t.at13ts += d.collected.at13ts;
    t.accepted += d.accepted;
    t.rejected += d.rejected;
    t.planned += d.planned;
    t.done += d.done;
  }
  return t;
}

/** Route bars that can be clicked to pick that route. */
function RouteBars({ rows, picked, onPick, format }: { rows: Array<{ id: string; name: string; value: number; pct: number | null }>; picked: string[]; onPick: (id: string) => void; format: (v: number) => string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ChartCard title="Route ranking" info="Milk collected per route and its share. Click a route to look at it alone; click again to clear.">
      {rows.length === 0 || max <= 0 ? (
        <div className="h-32">
          <EmptyChart />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 12).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                aria-pressed={picked.includes(r.id)}
                className="w-full min-h-9 rounded-lg px-2 py-1 text-left hover:bg-muted aria-pressed:bg-primary/10"
              >
                <span className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-foreground">{r.name}</span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {format(r.value)} <span className="text-muted-foreground">· {fmtPct(r.pct, 1)}</span>
                  </span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, backgroundColor: SERIES_COLORS[0] }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function ShopsTab({ filters, unit, bucket, ids, setIds }: VisualsTabProps) {
  const query = useVisuals<ShopsVisuals>('SHOPS', filters, ids);
  const cur = query.data?.current;
  const prev = query.data?.previous;
  const u = unit === 'at13' ? 'at13ts' : 'liters';
  const unitLabel = unit === 'at13' ? '@13 TS' : 'L';
  const fmt = fmtCompact;
  const fmtFull = (v: number | null) => (v == null ? '—' : unit === 'at13' ? `${fmtNum(v)} L @13 TS` : fmtLiters(v));

  const view = React.useMemo(() => {
    if (!cur) return null;
    const totals = totalsOf(cur.days);
    const routeTotal = cur.routes.reduce((s, r) => s + r.collected[u], 0);
    const points = bucketRows(cur.days, bucket, withOthers);
    const routeName = (id: string) => cur.routes.find((r) => r.id === id)?.name ?? `Route ${id}`;
    const stackSeries: TrendSeries[] = [
      ...cur.topRouteIds.map((id, i) => ({ key: `byRoute.r${id}.${u}`, label: routeName(id), color: SERIES_COLORS[i] ?? SERIES_COLORS[0], stack: 'a' })),
      { key: `others.${u}`, label: 'Others', color: '#cbd5e1', stack: 'a' },
    ];
    return { totals, routeTotal, points, stackSeries };
  }, [cur, bucket, u]);

  if (!cur || !view) {
    return (
      <>
        <ErrorPopup message={query.isError ? 'The figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  const { totals, routeTotal, points, stackSeries } = view;
  const pt = prev ? totalsOf(prev.days) : null;
  const dayCount = Math.max(1, cur.days.length);
  const prevDayCount = Math.max(1, prev?.days.length ?? 1);
  const rate = (t: { rejected: number; accepted: number }) => (t.accepted + t.rejected > 0 ? (t.rejected / (t.accepted + t.rejected)) * 100 : null);
  const conc = cur.concentration[u];
  const sharePct = (v: number) => share(v, routeTotal);

  const routeRows = cur.routes.map((r) => ({ id: r.id, name: r.name, value: r.collected[u], pct: sharePct(r.collected[u]) }));
  const pickRoute = (id: string) => setIds(ids.length === 1 && ids[0] === id ? [] : [id]);

  const routeColumns: Array<VisualColumn<(typeof cur.routes)[number]>> = [
    { key: 'name', label: 'Route', value: (r) => r.name },
    { key: 'code', label: 'Code', value: (r) => r.code },
    { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmccName },
    { key: 'shops', label: 'Shops', value: (r) => r.shops, align: 'right' },
    { key: 'journeys', label: 'Journeys', value: (r) => r.journeys, align: 'right' },
    { key: 'collected', label: `Collected ${unitLabel}`, value: (r) => r.collected[u], align: 'right' },
    { key: 'share', label: 'Share %', value: (r) => sharePct(r.collected[u]), format: (v) => fmtPct(v), align: 'right' },
    { key: 'rejected', label: 'Rejected', value: (r) => r.rejected, align: 'right' },
    { key: 'stops', label: 'Stops done %', value: (r) => completionPct(r.done, r.planned), format: (v) => fmtPct(v), align: 'right' },
  ];
  const shopColumns: Array<VisualColumn<(typeof cur.shops)[number]>> = [
    { key: 'code', label: 'Shop code', value: (s) => s.code },
    { key: 'name', label: 'Shop', value: (s) => s.name },
    { key: 'route', label: 'Route', value: (s) => s.routeName },
    { key: 'zmcc', label: 'ZMCC', value: (s) => s.zmccName },
    { key: 'days', label: 'Days with milk', value: (s) => s.daysWithMilk, align: 'right' },
    { key: 'collected', label: `Collected ${unitLabel}`, value: (s) => s.collected[u], align: 'right' },
    { key: 'share', label: 'Share %', value: (s) => sharePct(s.collected[u]), format: (v) => fmtPct(v, 2), align: 'right' },
    { key: 'rejected', label: 'Rejected', value: (s) => s.rejected, align: 'right' },
  ];

  const curveSeries: TrendSeries[] = [{ key: 'pct', label: 'Share of milk', color: SERIES_COLORS[0], type: 'line' }];
  const curvePoints = conc.curve.map((p) => ({ day: String(p.shops), label: `${p.shops}`, pct: p.pct }));

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
      <PickList label="Routes" items={cur.routeOptions} picked={ids} onChange={setIds} />

      <KpiRow>
        <KpiTile label={`Shop milk ${unitLabel}`} value={totals[u]} previous={pt ? pt[u] : undefined} format={fmtFull} info="Milk accepted at shops on journeys in these days." />
        <KpiTile label="Milk per day" kind="Per day" value={totals[u] / dayCount} previous={pt ? pt[u] / prevDayCount : undefined} format={fmtFull} info="Shop milk divided by the days in view." />
        <KpiTile label="Shops with milk" kind="Count" value={cur.shopsGave} previous={prev?.shopsGave} format={(v) => fmtNum(v)} info="Different shops that gave accepted milk in these days." />
        <KpiTile label="Rejected" kind="Count" value={totals.rejected} previous={pt?.rejected} better="down" format={(v) => fmtNum(v)} sub={`${fmtPct(rate(totals))} of collections`} info="Shop collections rejected, and their share of all collections." />
        <KpiTile label="Stops done" kind="Rate" value={completionPct(totals.done, totals.planned)} previous={pt ? completionPct(pt.done, pt.planned) : undefined} format={(v) => fmtPct(v)} sub={`${fmtNum(totals.done)} of ${fmtNum(totals.planned)}`} info="Shop stops completed out of the stops planned on journeys." />
      </KpiRow>

      <ChartGrid>
        <TrendChart title={`Milk by route (${unitLabel})`} info="Daily shop milk. The five biggest routes have their own colour; the rest is Others." points={points} series={stackSeries} format={fmt} />
        <DonutChart title="Route share" info="Each route's share of the shop milk. Five largest, then Others." rows={routeRows.map((r) => ({ id: r.id, name: r.name, value: r.value }))} format={fmt} centerLabel={unitLabel} />
        <RouteBars rows={routeRows} picked={ids} onPick={pickRoute} format={fmt} />
        <RankedBarsChart
          title="Top shops"
          info="Shops with the most accepted milk. Colour keeps one hue; all shops are in the table."
          rows={cur.shops.slice(0, 20).map((s) => ({ id: s.id, name: s.name, value: s.collected[u], tip: [{ label: 'Share', value: fmtPct(sharePct(s.collected[u])) }, { label: 'Days with milk', value: fmtNum(s.daysWithMilk) }] }))}
          color={SERIES_COLORS[2]}
          format={fmt}
        />
        <ChartCard
          title="Shop dependence"
          info="How many of the biggest shops give half and 80% of the milk. The line adds up their share, biggest first."
        >
          {conc.totalShops === 0 ? (
            <div className="h-32">
              <EmptyChart />
            </div>
          ) : (
            <>
              <p className="mb-2 flex flex-wrap gap-x-6 text-sm text-foreground">
                <span>
                  <span className="text-2xl font-semibold tabular-nums">{fmtNum(conc.shops50)}</span> shops give 50%
                </span>
                <span>
                  <span className="text-2xl font-semibold tabular-nums">{fmtNum(conc.shops80)}</span> shops give 80%
                </span>
                <span className="text-muted-foreground">of {fmtNum(conc.totalShops)} shops</span>
              </p>
              <TrendChart title="Cumulative share" points={curvePoints} series={curveSeries} format={(v) => `${fmtNum(v, 0)}%`} percent height={200} />
            </>
          )}
        </ChartCard>
        <AcceptRejectBars title="Accepted and rejected" info="Shop collections per route: accepted against rejected." rows={cur.routes.map((r) => ({ id: r.id, name: r.name, accepted: r.accepted, rejected: r.rejected }))} />
        <RankedBarsChart
          title="Stops done by route"
          info="Completed stops as a share of the stops planned."
          percent
          rows={cur.routes
            .map((r) => ({ r, v: completionPct(r.done, r.planned) }))
            .filter((x): x is { r: (typeof cur.routes)[number]; v: number } => x.v != null)
            .sort((a, b) => b.v - a.v)
            .map(({ r, v }) => ({ id: r.id, name: r.name, value: v, tip: [{ label: 'Done', value: `${fmtNum(r.done)} of ${fmtNum(r.planned)}` }] }))}
          color={STAGE_COLORS.gain}
          format={(v) => fmtPct(v)}
        />
      </ChartGrid>

      <VisualTable title="Routes" rows={cur.routes} columns={routeColumns} rowKey={(r) => r.id} initialSort="collected" />
      <VisualTable title="Shops" rows={cur.shops} columns={shopColumns} rowKey={(s) => s.id} initialSort="collected" />
    </div>
  );
}
