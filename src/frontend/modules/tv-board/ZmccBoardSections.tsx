'use client';

import React from 'react';
import { CheckCircle2, Droplets, Truck, FlaskConical, Warehouse, MapPinned, Hourglass } from 'lucide-react';
import { HorizontalScrollRow } from '@/components/ui/horizontal-scroll-row';
import { InfoTip } from '@/components/ui/info-tip';
import { QuantityStat } from '@/components/ui/quantity-stat';
import type { TvZmccSection, TvZmccTester } from '@/backend/services/tvBoardZmccService';

type DotState = 'done' | 'current' | 'waiting' | 'upcoming';

const DOT_STYLE: Record<DotState, string> = {
  done: 'bg-emerald-700 border-emerald-700 text-white shadow-xs',
  current: 'bg-primary border-primary text-white ring-4 ring-primary/15 shadow-sm',
  waiting: 'bg-amber-50 border-amber-500 text-amber-800',
  upcoming: 'bg-muted border-border-strong text-muted-foreground',
};

const LABEL_STYLE: Record<DotState, string> = {
  done: 'text-emerald-800 font-semibold',
  current: 'text-primary font-semibold',
  waiting: 'text-amber-800 font-semibold',
  upcoming: 'text-muted-foreground',
};

function Dot({ state, size, children }: { state: DotState; size: 'md' | 'sm'; children?: React.ReactNode }) {
  const box = size === 'md' ? 'h-9 w-9' : 'h-6 w-6';
  return (
    <div className={`flex ${box} items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums transition-[color,background-color,border-color,box-shadow] ${DOT_STYLE[state]}`}>
      {children}
    </div>
  );
}

interface PipelineStep {
  key: string;
  label: string;
  count: number;
  state: DotState;
  icon: React.ComponentType<{ className?: string }>;
}

function pipelineSteps(s: TvZmccSection['steps']): PipelineStep[] {
  return [
    { key: 'collecting', label: 'Collecting', count: s.collecting, state: s.collecting > 0 ? 'current' : 'upcoming', icon: MapPinned },
    { key: 'arrived', label: 'Arrived', count: s.arrived, state: s.arrived > 0 ? 'waiting' : 'upcoming', icon: Hourglass },
    { key: 'lab', label: 'Lab', count: s.lab, state: s.lab > 0 ? 'current' : 'upcoming', icon: FlaskConical },
    { key: 'inTank', label: 'In tank', count: s.inTank, state: s.inTank > 0 ? 'done' : 'upcoming', icon: Droplets },
    { key: 'dispatched', label: 'Dispatched', count: s.dispatched, state: s.dispatched > 0 ? 'done' : 'upcoming', icon: Truck },
  ];
}

function ZmccPipeline({ steps }: { steps: TvZmccSection['steps'] }) {
  const items = pipelineSteps(steps);
  return (
    <HorizontalScrollRow role="region" aria-label="ZMCC progress">
      <div className="relative flex min-w-max items-start px-1 py-1 md:min-w-0">
        <div className="pointer-events-none absolute left-10 right-10 top-5.5 z-0 h-0.5 bg-border" />
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.key} className="relative z-raised flex w-28 shrink-0 flex-col items-center text-center md:w-auto md:flex-1">
              <Dot state={it.state} size="md">
                {it.state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </Dot>
              <span className={`mt-2 text-2xl font-semibold leading-none tabular-nums ${it.count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                {it.count}
              </span>
              <span className={`mt-1 text-xs ${LABEL_STYLE[it.state]}`}>{it.label}</span>
            </div>
          );
        })}
      </div>
    </HorizontalScrollRow>
  );
}

const TESTER_STEPS = ['Assigned', 'Collecting', 'Returning', 'At ZMCC', 'Lab', 'In tank'];

function TesterStepper({ stepIndex }: { stepIndex: number }) {
  return (
    <HorizontalScrollRow role="region" aria-label="Journey progress">
      <div className="relative flex min-w-max items-start md:min-w-0">
        <div className="pointer-events-none absolute left-8 right-8 top-3 z-0 h-0.5 bg-border" />
        {TESTER_STEPS.map((label, i) => {
          const state: DotState = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'upcoming';
          return (
            <div key={label} className="relative z-raised flex w-16 shrink-0 flex-col items-center text-center md:w-auto md:flex-1">
              <Dot state={state} size="sm">
                {state === 'done' ? <CheckCircle2 className="h-3 w-3" /> : state === 'current' ? <span className="h-2 w-2 rounded-full bg-card" /> : null}
              </Dot>
              <span className={`mt-1 text-xs leading-tight ${LABEL_STYLE[state]}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </HorizontalScrollRow>
  );
}

const lit = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function TesterRow({ t }: { t: TvZmccTester }) {
  return (
    <li className="grid gap-3 rounded-xl border border-border bg-card p-3 lg:grid-cols-[minmax(0,14rem)_8rem_9rem_minmax(0,1fr)] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{t.testerName}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{t.vehicleNumber}</span> · {t.routeName}
        </p>
      </div>
      <div className="flex items-baseline gap-1.5 lg:block">
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {t.shopsDone} / {t.shopsTotal}
        </p>
        <p className="text-xs text-muted-foreground">Shops done</p>
      </div>
      <div className="flex items-baseline gap-1.5 lg:block">
        <p className="text-sm font-semibold tabular-nums text-foreground">{lit(t.collectedAt13Ts)} L</p>
        <p className="text-xs text-muted-foreground">Collected @13 TS</p>
      </div>
      <TesterStepper stepIndex={t.stepIndex} />
    </li>
  );
}

function FillBar({ stock, capacity }: { stock: number; capacity: number }) {
  if (capacity <= 0) return null;
  const pct = Math.max(0, Math.min(100, (stock / capacity) * 100));
  const tone = pct >= 90 ? 'bg-amber-500' : 'bg-emerald-600';
  return (
    <div className="mt-2" role="img" aria-label={`Tank ${Math.round(pct)} percent full`}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {Math.round(pct)}% of {lit(capacity)} L
      </p>
    </div>
  );
}

export function ZmccBoardSection({ zmcc }: { zmcc: TvZmccSection }) {
  const more = zmcc.testers.total - zmcc.testers.rows.length;
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-subtle p-4 sm:p-5" aria-label={zmcc.name}>
      <div className="flex items-center gap-2">
        <Warehouse className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">{zmcc.name}</h2>
        <InfoTip text="Counts are for today. Collecting and Lab show what is happening now. Arrived is waiting for the lab." />
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <ZmccPipeline steps={zmcc.steps} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
        <QuantityStat
          label="Tank stock"
          at13ts={zmcc.tank.stockAt13Ts}
          gross={zmcc.tank.stockGross}
          icon={Droplets}
          hint={<FillBar stock={zmcc.tank.stockGross} capacity={zmcc.tank.capacityLiters} />}
        />
        <QuantityStat label="Received today" at13ts={zmcc.receivedToday.at13Ts} gross={zmcc.receivedToday.gross} icon={CheckCircle2} />
        <QuantityStat label="Dispatched today" at13ts={zmcc.dispatchedToday.at13Ts} gross={zmcc.dispatchedToday.gross} icon={Truck} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium text-foreground">Mobile Testers</h3>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
            {zmcc.testers.total}
          </span>
        </div>
        {zmcc.testers.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">No active journeys</p>
        ) : (
          <ul className="space-y-2">
            {zmcc.testers.rows.map((t) => (
              <TesterRow key={t.journeyId} t={t} />
            ))}
          </ul>
        )}
        {more > 0 ? <p className="text-center text-xs font-semibold tabular-nums text-muted-foreground">+{more} more</p> : null}
      </div>
    </section>
  );
}
