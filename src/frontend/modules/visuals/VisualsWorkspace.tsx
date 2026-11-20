'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Container, Factory, Gauge, Route, Truck, Users, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorPopup } from '@/components/ui/error-popup';
import type { User } from '@core/types';
import { VISUAL_TABS, type VisualTab } from '@/backend/modules/management-reporting/visuals/common';
import type { LossFilterOptions } from '@/backend/modules/management-reporting/lossLevelContracts';
import { useLossFilters, type LossFilters } from '../mpd/lossFilters';
import { useLossFilterOptions } from '../mpd/lossData';
import { VisualsFilterBar } from './VisualsFilterBar';
import type { ChartBucket, ChartUnit } from '../mpd/components/StageCharts';
import type { Measure } from './visualsKit';
import { ShopsTab } from './tabs/ShopsTab';
import { TestersTab } from './tabs/TestersTab';
import { HcTab } from './tabs/HcTab';
import { ZmccTab } from './tabs/ZmccTab';
import { PlantTab } from './tabs/PlantTab';
import { TankersTab } from './tabs/TankersTab';
import { FlowTab } from './tabs/FlowTab';

/** What every tab receives from the page: the shared filters and how to draw them. */
export interface VisualsTabProps {
  filters: LossFilters;
  setFilters: (next: LossFilters) => void;
  options?: LossFilterOptions;
  unit: ChartUnit;
  bucket: ChartBucket;
  /** Totals for the period, or per day (LPD). Use measurePoints / measureValue from the kit. */
  measure: Measure;
  /** Tab picks (Mobile Testers, routes, suppliers …), kept in the page address. */
  ids: string[];
  setIds: (ids: string[]) => void;
}

const TABS: Array<{ id: VisualTab; label: string; icon: React.ElementType }> = [
  { id: 'FLOW', label: 'Loss flow', icon: Waypoints },
  { id: 'SHOPS', label: 'Shops & routes', icon: Route },
  { id: 'TESTERS', label: 'Mobile Testers', icon: Users },
  { id: 'HC', label: 'HC suppliers', icon: Truck },
  { id: 'ZMCC', label: 'ZMCC', icon: Gauge },
  { id: 'TANKERS', label: 'Tankers', icon: Container },
  { id: 'PLANT', label: 'Plant', icon: Factory },
];

const COMPONENTS: Record<VisualTab, React.FC<VisualsTabProps>> = {
  FLOW: FlowTab,
  SHOPS: ShopsTab,
  TESTERS: TestersTab,
  HC: HcTab,
  ZMCC: ZmccTab,
  TANKERS: TankersTab,
  PLANT: PlantTab,
};

/** Visuals: one sub-tab per level, one set of filters for all of them. The tab and the picks live in the page address. */
export function VisualsWorkspace(_props: { currentUser: User }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = searchParams?.toString() ?? '';
  const params = React.useMemo(() => new URLSearchParams(key), [key]);
  const raw = (params.get('tab') ?? '').toUpperCase();
  const tab: VisualTab = (VISUAL_TABS as readonly string[]).includes(raw) ? (raw as VisualTab) : 'FLOW';
  const ids = React.useMemo(() => (params.get('ids') ?? '').split(',').filter((s) => /^\d{1,18}$/.test(s)), [params]);

  const { filters, setFilters } = useLossFilters();
  const optionsQuery = useLossFilterOptions(filters);
  const [unit, setUnit] = React.useState<ChartUnit>('at13');
  const [bucket, setBucket] = React.useState<ChartBucket>('DAY');
  const [measure, setMeasure] = React.useState<Measure>('total');

  const setParam = React.useCallback(
    (changes: Record<string, string | null>) => {
      const q = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      const qs = q.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname]
  );
  const setTab = (t: VisualTab) => setParam({ tab: t === 'FLOW' ? null : t, ids: null });
  const setIds = React.useCallback((next: string[]) => setParam({ ids: next.length ? next.join(',') : null }), [setParam]);

  const Tab = COMPONENTS[tab];
  return (
    <div className="space-y-4">
      <ErrorPopup message={optionsQuery.isError ? 'The filter lists could not be loaded.' : null} />
      <nav aria-label="Visuals" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors',
              tab === id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-secondary-foreground hover:bg-muted'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      <VisualsFilterBar
        filters={filters}
        onChange={setFilters}
        options={optionsQuery.data}
        unit={unit}
        onUnit={setUnit}
        bucket={bucket}
        onBucket={setBucket}
        measure={measure}
        onMeasure={setMeasure}
      />

      <Tab filters={filters} setFilters={setFilters} options={optionsQuery.data} unit={unit} bucket={bucket} measure={measure} ids={ids} setIds={setIds} />
    </div>
  );
}
