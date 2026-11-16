'use client';

import React from 'react';
import { QuantityStat } from '@/components/ui/quantity-stat';
import { InfoTip } from '@/components/ui/info-tip';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatLossGain, formatLossGainPercent, lossGainClass, type LossFigure, type LossPair } from '@/lib/lossGain';
import type { LitrePair, LossLevels, WholeLevel } from '@/backend/modules/management-reporting/lossLevelContracts';

const lit = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} L`;

/** "Loss 120 L" in red, "Gain 35 L" in green, "Even" in grey. A dash when there is nothing. */
export const Signed: React.FC<{ value: number | null | undefined }> = ({ value }) => {
  const text = formatLossGain(value);
  return <span className={`tabular-nums ${lossGainClass(value)}`}>{text || '—'}</span>;
};

export const SignedPercent: React.FC<{ value: number | null | undefined }> = ({ value }) => {
  const text = formatLossGainPercent(value);
  return <span className={`tabular-nums ${lossGainClass(value)}`}>{text || '—'}</span>;
};

/** Each record's own losses and gains, added up, beside the net. */
export const LossGainSums: React.FC<{ pair: LossPair }> = ({ pair }) => (
  <span className="tabular-nums">
    <span className="text-rose-700">Loss {lit(pair.lossSum)}</span> · <span className="text-emerald-700">Gain {lit(pair.gainSum)}</span>
  </span>
);

interface LossStatCardProps {
  label: string;
  figure: LossFigure | null | undefined;
  /** "sent" for transfers, "bought" for Whole. */
  basis?: 'sent' | 'bought';
  info: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}

/** One level: @13 TS signed is the big number, gross a small line, then every loss and gain and the percent. */
export const LossStatCard: React.FC<LossStatCardProps> = ({ label, figure, basis = 'sent', info, icon, className }) => {
  const has = !!figure && (figure.records > 0 || figure.at13ts.sent > 0 || figure.gross.sent > 0);
  return (
    <QuantityStat
      className={className}
      label={label}
      icon={icon}
      at13ts={null}
      valueText={has && figure ? <Signed value={figure.at13ts.signed} /> : '—'}
      missingAt13tsCount={figure?.missing13ts}
      hint={
        has && figure ? (
          <div className="space-y-0.5">
            <p>
              Gross <Signed value={figure.gross.signed} />
            </p>
            <p>
              <SignedPercent value={figure.at13ts.percent} /> of milk {basis === 'sent' ? 'sent' : 'bought'}
            </p>
            <p>
              <LossGainSums pair={figure.at13ts} />
            </p>
            <p className="flex items-center gap-1">
              How it is measured
              <InfoTip text={info} className="min-h-9 min-w-9" />
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1">
            No records
            <InfoTip text={info} className="min-h-9 min-w-9" />
          </p>
        )
      }
    />
  );
};

/** The Whole net as a LossFigure, so it can use the same card. Records without tests come from MOT and Transit. */
export function wholeFigure(levels: LossLevels | null | undefined): LossFigure | null {
  const w = levels?.whole;
  if (!w) return null;
  return {
    at13ts: w.net.at13ts,
    gross: w.net.gross,
    records: w.byZmcc?.length ?? 0,
    missing13ts: (levels?.mot?.total?.missing13ts ?? 0) + (levels?.transit?.net?.missing13ts ?? 0),
  };
}

/** Columns for a row that carries a LossFigure. */
export function figureColumns<T>(get: (row: T) => LossFigure | null | undefined): Array<DataColumn<T>> {
  return [
    {
      key: 'at13ts',
      header: 'Loss / Gain @13 TS',
      label: 'Loss / Gain @13 TS',
      align: 'right',
      cell: (r) => {
        const f = get(r);
        return f ? <Signed value={f.at13ts.signed} /> : '—';
      },
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      cell: (r) => {
        const f = get(r);
        return f ? <Signed value={f.gross.signed} /> : '—';
      },
    },
    {
      key: 'percent',
      header: '%',
      label: 'Percent',
      align: 'right',
      cell: (r) => {
        const f = get(r);
        return f ? <SignedPercent value={f.at13ts.percent} /> : '—';
      },
    },
    {
      key: 'sums',
      header: 'All losses and gains',
      align: 'right',
      defaultHidden: false,
      cell: (r) => {
        const f = get(r);
        return f ? <LossGainSums pair={f.at13ts} /> : '—';
      },
    },
    {
      key: 'missing',
      header: 'No tests',
      label: 'Without tests',
      align: 'right',
      cell: (r) => {
        const f = get(r);
        return f && f.missing13ts > 0 ? <span className="text-amber-700">{f.missing13ts} without tests</span> : '—';
      },
    },
  ];
}

interface LineRow {
  id: string;
  label: string;
  pair?: LitrePair;
  /** A net row: shown as Loss / Gain. */
  net?: LitrePair;
}

/** The Whole lines: bought, still in tanks, on the road, admin, plant received, net. */
export const WholeLinesTable: React.FC<{ whole: WholeLevel | null | undefined; className?: string }> = ({ whole, className }) => {
  const l = whole?.lines;
  const rows: LineRow[] = l
    ? [
        { id: 'shop', label: 'Bought from shops', pair: l.boughtShop },
        { id: 'hc', label: 'Bought from HC', pair: l.boughtHc },
        { id: 'tanks', label: 'Still in ZMCC tanks', pair: l.stockChange },
        { id: 'road', label: 'On the road', pair: l.onRoad },
        { id: 'admin', label: 'Admin adjustments', pair: l.adminAdjustment },
        { id: 'plant', label: 'Plant received', pair: l.plantReceived },
        { id: 'net', label: 'Net', net: { at13ts: whole.net.at13ts.signed, gross: whole.net.gross.signed } },
        { id: 'netAdmin', label: 'Net with admin', net: whole.netWithAdmin },
      ]
    : [];
  const cols: Array<DataColumn<LineRow>> = [
    { key: 'label', header: 'Line', primary: true, cell: (r) => <span className={r.net ? 'font-semibold' : undefined}>{r.label}</span> },
    {
      key: 'at13ts',
      header: '@13 TS',
      align: 'right',
      cell: (r) => (r.net ? <Signed value={r.net.at13ts} /> : <span className="tabular-nums">{lit(r.pair?.at13ts)}</span>),
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      cell: (r) => (r.net ? <Signed value={r.net.gross} /> : <span className="tabular-nums">{lit(r.pair?.gross)}</span>),
    },
  ];
  return (
    <div className={className}>
      <DataTable columns={cols} rows={rows} getRowId={(r) => r.id} paginate={false} emptyTitle="No records" />
      {l && l.acceptedNotReceivedLiters > 0 ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          Accepted, not unloaded: {lit(l.acceptedNotReceivedLiters)}
          <InfoTip text="Milk the lab accepted that was never unloaded. Information only, not counted in the net." className="min-h-9 min-w-9" />
        </p>
      ) : null}
    </div>
  );
};

export { lit as formatLitres };
