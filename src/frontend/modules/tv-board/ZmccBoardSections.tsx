'use client';

import React from 'react';
import { Warehouse, Users, Truck, MapPinned, Navigation, Building2, FlaskConical, Droplets, Flag, LogIn, LogOut } from 'lucide-react';
import { StepRail, type StepRailItem } from '@/components/ui/step-rail';
import { InfoTip } from '@/components/ui/info-tip';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { formatLossGain, lossGainClass } from '@/lib/lossGain';
import type { TvZmccJourney, TvZmccSection } from '@/backend/services/tvBoardZmccService';

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  assigned: Users,
  collecting: MapPinned,
  returning: Navigation,
  arrived: Building2,
  lab: FlaskConical,
  receipt: Droplets,
  end: Flag,
  'gate-in': LogIn,
  'gate-out': LogOut,
};

const PK = 'Asia/Karachi';
const pkDay = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: PK });
/** Pakistan time; a step from an earlier day also shows its date. */
const pkTime = (isoText: string) => {
  const d = new Date(isoText);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: PK });
  if (pkDay(d) === pkDay(new Date())) return time;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: PK })}, ${time}`;
};

const lit = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} L`;

function toRail(j: TvZmccJourney): StepRailItem[] {
  return j.steps.map((s) => ({
    key: s.key,
    label: s.label,
    state: s.state,
    icon: STEP_ICONS[s.key],
    lines: [
      s.metric ? <span className="font-semibold text-secondary-foreground">{s.metric}</span> : null,
      s.note,
      s.at && s.state !== 'upcoming' ? pkTime(s.at) : null,
    ],
    approval: s.approval ? { roleLabel: getRoleLabel(s.approval.role), name: s.approval.name } : null,
  }));
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className={`text-sm font-semibold tabular-nums ${className ?? 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function JourneyRow({ j }: { j: TvZmccJourney }) {
  const diff = j.collectedAt13Ts != null && j.receivedAt13Ts != null ? j.receivedAt13Ts - j.collectedAt13Ts : null;
  return (
    <li className={`space-y-2 rounded-xl border bg-card p-3 ${j.finished ? 'border-border opacity-80' : 'border-border shadow-2xs'}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="truncate">{j.title}</span>
            {j.finished ? (
              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Ended</span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{j.vehicleNumber}</span> · {j.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {j.kind === 'MOT' ? <Figure label="Collected @13 TS" value={lit(j.collectedAt13Ts ?? 0)} /> : null}
          <Figure label="Received @13 TS" value={j.receivedAt13Ts != null ? lit(j.receivedAt13Ts) : '—'} />
          {diff != null ? <Figure label="Difference" value={formatLossGain(diff, ' L', 0)} className={lossGainClass(diff)} /> : null}
        </div>
      </div>
      <StepRail steps={toRail(j)} size="sm" ariaLabel={`${j.title} progress`} stepClassName="min-w-24" />
    </li>
  );
}

function JourneyList({
  title,
  icon: Icon,
  total,
  rows,
  empty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
  rows: TvZmccJourney[];
  empty: string;
}) {
  const more = total - rows.length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">{total}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((j) => (
            <JourneyRow key={j.id} j={j} />
          ))}
        </ul>
      )}
      {more > 0 ? <p className="text-center text-xs font-semibold tabular-nums text-muted-foreground">+{more} more</p> : null}
    </div>
  );
}

export function ZmccBoardSection({ zmcc }: { zmcc: TvZmccSection }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-subtle p-4 sm:p-5" aria-label={zmcc.name}>
      <div className="flex items-center gap-2">
        <Warehouse className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">{zmcc.name}</h2>
        <InfoTip text="Live journeys and today's finished ones. An amber step waits for the approver shown under it." />
      </div>
      <JourneyList title="Mobile Testers" icon={Users} total={zmcc.testers.total} rows={zmcc.testers.rows} empty="No journeys today" />
      <JourneyList title="Direct HC" icon={Truck} total={zmcc.hc.total} rows={zmcc.hc.rows} empty="No HC vehicles today" />
    </section>
  );
}
