'use client';

import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';
import type { HcSupplierRow, HcVisuals } from '@/backend/modules/management-reporting/visuals/hcContracts';
import type { QtyPair } from '@/backend/modules/management-reporting/visuals/common';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  AcceptRejectBars,
  ChartGrid,
  DonutChart,
  KpiRow,
  KpiTile,
  PickList,
  RankedBarsChart,
  REJECT_COLOR,
  ACCEPT_COLOR,
  SERIES_COLORS,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtCompact,
  fmtNum,
  fmtPct,
  share,
  useVisuals,
  type VisualColumn,
} from '../visualsKit';

const pickQty = (p: QtyPair, unit: VisualsTabProps['unit']) => (unit === 'at13' ? p.at13ts : p.liters);
const tsOf = (p: QtyPair) => (p.liters > 0 ? (p.at13ts * 13) / p.liters : null);
/** Rejected as a share of the arrivals that got a decision. */
const rejRate = (r: { accepted: number; rejected: number }) => share(r.rejected, r.accepted + r.rejected);
const MIN_ARRIVALS = 3;

export function HcTab({ filters, unit, bucket, ids, setIds }: VisualsTabProps) {
  const query = useVisuals<HcVisuals>('HC', filters, ids);
  const data = query.data?.current;
  const before = query.data?.previous;
  const unitText = unit === 'at13' ? '@13 TS litres' : 'litres';

  const named = React.useMemo(() => (data?.suppliers ?? []).filter((s) => s.id !== '__others'), [data]);
  const byReceived = React.useMemo(() => [...named].sort((a, b) => pickQty(b.received, unit) - pickQty(a.received, unit)), [named, unit]);
  const tip = (s: HcSupplierRow) => [
    { label: 'Arrivals', value: fmtNum(s.arrivals) },
    { label: 'Rejected', value: fmtNum(s.rejected) },
    { label: 'Received', value: `${fmtNum(pickQty(s.received, unit))} L` },
  ];
  const days = React.useMemo(() => bucketRows(data?.daily ?? [], bucket), [data, bucket]);

  const totalReceived = data ? pickQty(data.totals.received, unit) : 0;
  const columns: Array<VisualColumn<HcSupplierRow>> = [
    { key: 'name', label: 'Supplier', value: (r) => r.name },
    { key: 'code', label: 'Code', value: (r) => r.code ?? '' },
    { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmccName },
    { key: 'arrivals', label: 'Arrivals', value: (r) => r.arrivals, align: 'right' },
    { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, align: 'right' },
    { key: 'rejected', label: 'Rejected', value: (r) => r.rejected, align: 'right' },
    { key: 'rate', label: 'Rejected %', value: (r) => rejRate(r), format: (v) => fmtPct(v), align: 'right' },
    { key: 'left', label: 'Left early', value: (r) => r.leftEarly, align: 'right' },
    { key: 'received', label: unit === 'at13' ? 'Received L @13 TS' : 'Received L', value: (r) => pickQty(r.received, unit), align: 'right' },
    { key: 'share', label: 'Share', value: (r) => share(pickQty(r.received, unit), totalReceived), format: (v) => fmtPct(v), align: 'right' },
    { key: 'ts', label: 'TS', value: (r) => tsOf(r.received), format: (v) => fmtNum(v, 2), align: 'right' },
    { key: 'days', label: 'Days', value: (r) => r.daysSupplied, align: 'right' },
    { key: 'avg', label: 'Avg / arrival', value: (r) => (r.arrivals > 0 ? pickQty(r.received, unit) / r.arrivals : null), format: (v) => fmtNum(v), align: 'right' },
  ];

  const t = data?.totals;
  const p = before?.totals;
  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The HC supplier figures could not be loaded.' : null} />
      {data ? <PickList label="HC suppliers" items={data.supplierOptions.map((s) => ({ id: s.id, name: s.code ? `${s.name} (${s.code})` : s.name, group: s.group }))} picked={ids} onChange={setIds} /> : null}
      {!data || !t ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <KpiRow>
            <KpiTile
              label="HC received"
              value={pickQty(t.received, unit)}
              previous={p ? pickQty(p.received, unit) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              info={`Milk from HC suppliers that went into the ZMCC tanks, in ${unitText}.`}
            />
            <KpiTile label="Arrivals" kind="Count" value={t.arrivals} previous={p?.arrivals} format={(v) => fmtNum(v)} better="none" info="HC vehicles that arrived at the ZMCCs." />
            <KpiTile
              label="Rejection rate" kind="Rate"
              value={rejRate(t)}
              previous={p ? rejRate(p) : undefined}
              format={(v) => fmtPct(v)}
              better="down"
              info="Rejected arrivals as a share of the arrivals with a decision."
            />
            <KpiTile label="Active suppliers" kind="Count" value={t.activeSuppliers} previous={p?.activeSuppliers} format={(v) => fmtNum(v)} better="none" info="Suppliers with at least one arrival." />
            <KpiTile
              label="Top 5 share" kind="Rate"
              value={t.top5Share}
              previous={p?.top5Share}
              format={(v) => fmtPct(v)}
              better="none"
              info="Share of the received milk that came from the five biggest suppliers. High means we rely on few."
            />
          </KpiRow>

          <ChartGrid>
            <DonutChart
              title="Who we rely on"
              info={`Share of received milk per supplier, in ${unitText}. The five biggest are named; the rest is Others.`}
              rows={byReceived.map((s) => ({ id: s.id, name: s.name, value: pickQty(s.received, unit) }))}
              format={(v) => `${fmtCompact(v)} L`}
              centerLabel="received"
            />
            <RankedBarsChart
              title="Top suppliers"
              info={`Received milk in ${unitText}, biggest first.`}
              color={SERIES_COLORS[0]}
              format={(v) => fmtCompact(v)}
              rows={byReceived.filter((s) => pickQty(s.received, unit) > 0).map((s) => ({ id: s.id, name: s.name, value: pickQty(s.received, unit), tip: tip(s) }))}
            />
            <RankedBarsChart
              title="Most rejected"
              info="Rejected arrivals per supplier, most first."
              color={REJECT_COLOR}
              format={(v) => fmtNum(v)}
              rows={[...named].filter((s) => s.rejected > 0).sort((a, b) => b.rejected - a.rejected).map((s) => ({ id: s.id, name: s.name, value: s.rejected, tip: tip(s) }))}
            />
            <RankedBarsChart
              title="Highest rejection rate"
              info={`Rejected share of decided arrivals. Only suppliers with ${MIN_ARRIVALS} or more arrivals.`}
              percent
              color={REJECT_COLOR}
              format={(v) => fmtPct(v)}
              rows={[...named]
                .filter((s) => s.arrivals >= MIN_ARRIVALS && s.rejected > 0)
                .map((s) => ({ s, v: rejRate(s) ?? 0 }))
                .sort((a, b) => b.v - a.v)
                .map(({ s, v }) => ({ id: s.id, name: s.name, value: v, tip: tip(s) }))}
            />
            <RankedBarsChart
              title="Most accepted"
              info="Accepted arrivals per supplier, most first."
              color={ACCEPT_COLOR}
              format={(v) => fmtNum(v)}
              rows={[...named].filter((s) => s.accepted > 0).sort((a, b) => b.accepted - a.accepted).map((s) => ({ id: s.id, name: s.name, value: s.accepted, tip: tip(s) }))}
            />
            <AcceptRejectBars
              title="Accepted vs rejected"
              info="Each supplier as 100%. The 12 with the most arrivals are shown."
              rows={[...named].sort((a, b) => b.arrivals - a.arrivals).map((s) => ({ id: s.id, name: s.name, accepted: s.accepted, rejected: s.rejected }))}
            />
            <TrendChart
              title="Arrivals per day"
              info="Accepted and rejected HC arrivals."
              points={days}
              series={[
                { key: 'accepted', label: 'Accepted', color: ACCEPT_COLOR, stack: 'a' },
                { key: 'rejected', label: 'Rejected', color: REJECT_COLOR, stack: 'a' },
              ]}
              format={(v) => fmtNum(v)}
            />
            <TrendChart
              title="Received per day"
              info={`HC milk received, in ${unitText}.`}
              points={days}
              series={[{ key: unit === 'at13' ? 'received.at13ts' : 'received.liters', label: 'Received', color: SERIES_COLORS[0] }]}
            />
            <RankedBarsChart
              title="TS per supplier"
              info="Milk quality (Fat + SNF) of what each supplier delivered."
              color={SERIES_COLORS[2]}
              format={(v) => fmtNum(v, 2)}
              rows={byReceived
                .map((s) => ({ s, v: tsOf(s.received) }))
                .filter((x): x is { s: HcSupplierRow; v: number } => x.v != null)
                .sort((a, b) => b.v - a.v)
                .map(({ s, v }) => ({ id: s.id, name: s.name, value: v, tip: tip(s) }))}
            />
            {data.rejectionReasons.length ? (
              <RankedBarsChart
                title="Rejection reasons"
                info="As typed at the lab. The ten most frequent."
                color={REJECT_COLOR}
                format={(v) => fmtNum(v)}
                rows={data.rejectionReasons.map((r) => ({ id: r.reason, name: r.reason, value: r.count, tip: [{ label: 'Rejections', value: fmtNum(r.count) }] }))}
              />
            ) : null}
          </ChartGrid>

          <VisualTable title="Suppliers" rows={data.suppliers} columns={columns} rowKey={(r) => r.id} initialSort="received" />
        </>
      )}
    </div>
  );
}
