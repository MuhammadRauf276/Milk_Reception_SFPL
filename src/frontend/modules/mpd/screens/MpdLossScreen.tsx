'use client';

import React, { useState } from 'react';
import { Download, Loader2, Route, Building2, Truck, Layers, HardHat } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { InfoTip } from '@/components/ui/info-tip';
import { ErrorPopup } from '@/components/ui/error-popup';
import { formatDate } from '@/lib/format';
import type {
  AreaLossRow,
  ContractorLossRow,
  LossLevels,
  MotJourneyLossRow,
  MotTesterLossRow,
  TankerLossRow,
  TransitZmccRow,
  WholeZmccRow,
} from '@/backend/modules/management-reporting/lossLevelContracts';
import { LossFilterBar } from '../components/LossFilterBar';
import { LossStatCard, Signed, WholeLinesTable, figureColumns, formatLitres, wholeFigure } from '../components/LossLevelCards';
import { useLossExport, useLossFilterOptions, useLossLevels } from '../lossData';
import { useLossFilters } from '../lossFilters';

type LevelTab = 'MOT' | 'AREA' | 'TRANSIT' | 'WHOLE' | 'CONTRACTOR';

const TABS: Array<{ value: LevelTab; label: string }> = [
  { value: 'MOT', label: 'Tester' },
  { value: 'AREA', label: 'Area' },
  { value: 'TRANSIT', label: 'Transit' },
  { value: 'WHOLE', label: 'Whole' },
  { value: 'CONTRACTOR', label: 'Contractor' },
];

const INFO = {
  mot: 'Milk collected from shops vs milk received at the ZMCC, per Mobile Tester journey. Received minus sent. The total is the net of all journeys.',
  area: 'MOT Loss / Gain added up for each ZMCC.',
  transit: 'At ZMCC (tank) plus the tanker trip from ZMCC to plant.',
  atZmcc: 'Milk received at the ZMCC (MOT and HC) vs milk dispatched, with the change in tank stock taken into account.',
  onRoad: 'Milk dispatched by the ZMCC vs milk received at the plant. Tankers the plant has not reconciled yet are left out.',
  whole: 'Milk bought from shops and HC vs milk received at the plant, with milk still in ZMCC tanks and in tankers counted. Equals MOT plus Transit.',
  contractor: 'Contractor tankers: dispatched vs received at the plant. Separate from Whole.',
};

const noTest = <span className="text-muted-foreground">No test</span>;
const litres = (n: number | null | undefined) => (n == null ? noTest : <span className="tabular-nums">{formatLitres(n)}</span>);

const InspectButton: React.FC<{ open: boolean; onClick: () => void }> = ({ open, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    className="min-h-11 rounded-lg border border-border px-3 text-xs font-semibold text-secondary-foreground hover:bg-muted"
  >
    {open ? 'Close' : 'Inspect'}
  </button>
);

function useOpenSet() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { open, toggle };
}

const Block: React.FC<{ title: string; info?: React.ReactNode; children: React.ReactNode }> = ({ title, info, children }) => (
  <section className="min-w-0 space-y-2">
    <h3 className="flex items-center gap-1 text-sm font-semibold text-foreground">
      {title}
      {info ? <InfoTip text={info} /> : null}
    </h3>
    {children}
  </section>
);

/* ---------------------------------- MOT ---------------------------------- */

const journeyColumns: Array<DataColumn<MotJourneyLossRow>> = [
  { key: 'journey', header: 'Journey', primary: true, cell: (j) => <span className="font-medium">{j.journeyNumber}</span> },
  { key: 'date', header: 'Date', cardAlways: true, cell: (j) => formatDate(j.date) },
  { key: 'shop', header: 'Shops @13 TS', align: 'right', cell: (j) => litres(j.shop.at13ts) },
  { key: 'received', header: 'Received @13 TS', align: 'right', cell: (j) => litres(j.received.at13ts) },
  ...figureColumns<MotJourneyLossRow>((j) => j.figure),
];

const MotTable: React.FC<{ rows: MotTesterLossRow[] }> = ({ rows }) => {
  const { open, toggle } = useOpenSet();
  const cols: Array<DataColumn<MotTesterLossRow>> = [
    {
      key: 'name',
      header: 'Mobile Tester',
      primary: true,
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{t.name}</p>
          <p className="text-xs text-muted-foreground">{t.zmccName}</p>
        </div>
      ),
    },
    { key: 'journeys', header: 'Journeys', align: 'right', cell: (t) => t.journeys.length },
    ...figureColumns<MotTesterLossRow>((t) => t.total),
    { key: 'inspect', header: '', actions: true, cell: (t) => <InspectButton open={open.has(t.motProfileId)} onClick={() => toggle(t.motProfileId)} /> },
  ];
  return (
    <DataTable
      columns={cols}
      rows={rows}
      getRowId={(t) => t.motProfileId}
      noun="testers"
      emptyTitle="No journeys"
      renderExpanded={(t) =>
        open.has(t.motProfileId) ? (
          <div className="p-2">
            <DataTable columns={journeyColumns} rows={t.journeys} getRowId={(j) => j.journeyId} noun="journeys" pageSize={10} />
          </div>
        ) : null
      }
    />
  );
};

/* ---------------------------------- Area --------------------------------- */

const areaColumns: Array<DataColumn<AreaLossRow>> = [
  { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
  { key: 'testers', header: 'Testers', align: 'right', cell: (z) => z.testerCount },
  { key: 'journeys', header: 'Journeys', align: 'right', cell: (z) => z.journeyCount },
  ...figureColumns<AreaLossRow>((z) => z.total),
];

/* --------------------------------- Transit ------------------------------- */

const transitZmccColumns: Array<DataColumn<TransitZmccRow>> = [
  { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
  { key: 'net', header: 'Transit @13 TS', align: 'right', cell: (z) => <Signed value={z.net.at13ts.signed} /> },
  { key: 'atZmcc', header: 'At ZMCC (tank) @13 TS', align: 'right', cell: (z) => <Signed value={z.atZmcc.at13ts.signed} /> },
  { key: 'onRoad', header: 'Tanker trip @13 TS', align: 'right', cell: (z) => <Signed value={z.onRoad.at13ts.signed} /> },
  { key: 'gross', header: 'Gross', align: 'right', cell: (z) => <Signed value={z.net.gross.signed} /> },
  { key: 'dispatched', header: 'Dispatched @13 TS', align: 'right', cell: (z) => litres(z.flows.dispatched.at13ts) },
  {
    key: 'inFlight',
    header: 'In flight @13 TS',
    align: 'right',
    cell: (z) => (z.inFlight.tankers > 0 ? `${z.inFlight.tankers} tankers, ${formatLitres(z.inFlight.at13ts)}` : '—'),
  },
  {
    key: 'missing',
    header: 'No tests',
    label: 'Without tests',
    align: 'right',
    cell: (z) => {
      const n = z.net.missing13ts;
      return n > 0 ? <span className="text-amber-700">{n} without tests</span> : '—';
    },
  },
];

const tankerColumns: Array<DataColumn<TankerLossRow>> = [
  {
    key: 'visit',
    header: 'Tanker',
    primary: true,
    cell: (t) => (
      <div className="min-w-0">
        <p className="font-medium text-foreground">{t.vehicleNumber || t.visitNumber}</p>
        <p className="text-xs text-muted-foreground">{t.visitNumber}</p>
      </div>
    ),
  },
  { key: 'date', header: 'Date', cardAlways: true, cell: (t) => formatDate(t.date) },
  { key: 'source', header: 'From', cell: (t) => t.sourceName },
  { key: 'dispatched', header: 'Dispatched @13 TS', align: 'right', cell: (t) => litres(t.dispatched.at13ts) },
  { key: 'plant', header: 'Plant @13 TS', align: 'right', cell: (t) => (t.plantReceived ? litres(t.plantReceived.at13ts) : <span className="text-muted-foreground">Pending</span>) },
  { key: 'figure', header: 'Loss / Gain @13 TS', align: 'right', cell: (t) => (t.figure ? <Signed value={t.figure.at13ts.signed} /> : '—') },
  { key: 'gross', header: 'Gross', align: 'right', cell: (t) => (t.figure ? <Signed value={t.figure.gross.signed} /> : '—') },
  {
    key: 'alert',
    header: 'Alert',
    cell: (t) => (t.isHighLoss ? <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Loss over 1%</span> : '—'),
  },
];

/* ---------------------------------- Whole -------------------------------- */

const wholeZmccColumns: Array<DataColumn<WholeZmccRow>> = [
  { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
  { key: 'net', header: 'Net @13 TS', align: 'right', cell: (z) => <Signed value={z.net.at13ts.signed} /> },
  { key: 'gross', header: 'Gross', align: 'right', cell: (z) => <Signed value={z.net.gross.signed} /> },
  { key: 'bought', header: 'Bought @13 TS', align: 'right', cell: (z) => litres(z.lines.bought.at13ts) },
  { key: 'tanks', header: 'In tanks @13 TS', align: 'right', cell: (z) => litres(z.lines.stockChange.at13ts) },
  { key: 'road', header: 'In tankers @13 TS', align: 'right', cell: (z) => litres(z.lines.onRoad.at13ts) },
  { key: 'plant', header: 'Plant received @13 TS', align: 'right', cell: (z) => litres(z.lines.plantReceived.at13ts) },
  { key: 'admin', header: 'Admin @13 TS', align: 'right', cell: (z) => litres(z.lines.adminAdjustment.at13ts) },
];

/* -------------------------------- Contractor ----------------------------- */

const ContractorTable: React.FC<{ rows: ContractorLossRow[] }> = ({ rows }) => {
  const { open, toggle } = useOpenSet();
  const cols: Array<DataColumn<ContractorLossRow>> = [
    {
      key: 'name',
      header: 'Contractor',
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{c.name}</p>
          <p className="text-xs text-muted-foreground">{c.code}</p>
        </div>
      ),
    },
    { key: 'tankers', header: 'Tankers', align: 'right', cell: (c) => c.tankers.length },
    { key: 'pending', header: 'Pending', align: 'right', cell: (c) => (c.pendingTankers > 0 ? c.pendingTankers : '—') },
    ...figureColumns<ContractorLossRow>((c) => c.total),
    { key: 'inspect', header: '', actions: true, cell: (c) => <InspectButton open={open.has(c.contractorId)} onClick={() => toggle(c.contractorId)} /> },
  ];
  return (
    <DataTable
      columns={cols}
      rows={rows}
      getRowId={(c) => c.contractorId}
      noun="contractors"
      emptyTitle="No contractor tankers"
      renderExpanded={(c) =>
        open.has(c.contractorId) ? (
          <div className="p-2">
            <DataTable columns={tankerColumns} rows={c.tankers} getRowId={(t) => t.visitId} noun="tankers" pageSize={10} />
          </div>
        ) : null
      }
    />
  );
};

/* ---------------------------------- Screen ------------------------------- */

interface MpdLossScreenProps {
  role?: string | null;
}

export const MpdLossScreen: React.FC<MpdLossScreenProps> = ({ role }) => {
  const { filters, setFilters } = useLossFilters();
  const [tab, setTab] = useState<LevelTab>('MOT');
  const levelsQuery = useLossLevels(filters);
  const optionsQuery = useLossFilterOptions(filters);
  const exporter = useLossExport(filters);
  const levels: LossLevels | null = levelsQuery.data ?? null;
  const error = levelsQuery.isError ? levelsQuery.error.message || 'Loss and gain could not be loaded.' : null;
  const loading = levelsQuery.isPending;

  return (
    <div className="min-w-0 space-y-4">
      <ErrorPopup message={error} onRetry={() => void levelsQuery.refetch()} />
      <ErrorPopup message={optionsQuery.isError ? 'The filter lists could not be loaded.' : null} />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Loss / Gain</h2>
        <button
          type="button"
          onClick={() => void exporter.run()}
          disabled={exporter.exporting || loading}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
        >
          {exporter.exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
          Excel
        </button>
      </div>

      <LossFilterBar
        filters={filters}
        onChange={setFilters}
        options={optionsQuery.data}
        showContractor={tab === 'CONTRACTOR' || filters.contractorIds.length > 0}
        zmccLocked={role === 'ZMCC_MANAGER'}
        rangeLabel={levels?.filters?.label}
      />

      {loading ? (
        <div className="grid animate-pulse grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className={`space-y-3 ${levelsQuery.isFetching ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LossStatCard label="MOT Loss / Gain" figure={levels?.mot?.total} info={INFO.mot} icon={Route} />
            <LossStatCard label="Area Loss / Gain" figure={levels?.area?.total} info={INFO.area} icon={Building2} />
          </div>

          <div className="space-y-2 rounded-2xl border border-border p-3">
            <h3 className="flex items-center gap-1 text-sm font-semibold text-foreground">
              Transit Loss / Gain
              <InfoTip text={INFO.transit} />
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LossStatCard label="Transit" figure={levels?.transit?.net} info={INFO.transit} icon={Truck} />
              <LossStatCard label="At ZMCC (tank)" figure={levels?.transit?.atZmcc} info={INFO.atZmcc} />
              <LossStatCard label="Tanker trip (ZMCC to plant)" figure={levels?.transit?.onRoad} info={INFO.onRoad} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LossStatCard
              label="Whole Loss / Gain"
              figure={wholeFigure(levels)}
              basis="bought"
              info={INFO.whole}
              icon={Layers}
            />
            <LossStatCard label="Contractor Transit Loss / Gain" figure={levels?.contractorTransit?.total} info={INFO.contractor} icon={HardHat} />
          </div>

          <SegmentedTabs tabs={TABS} value={tab} onValueChange={setTab} label="Loss levels" mobileOnly={false} fullWidth />

          {tab === 'MOT' && (
            <Block title="MOT per Mobile Tester" info="Open a tester to see each journey.">
              <MotTable rows={levels?.mot?.testers ?? []} />
            </Block>
          )}

          {tab === 'AREA' && (
            <Block title="Area per ZMCC" info={INFO.area}>
              <DataTable columns={areaColumns} rows={levels?.area?.zmccs ?? []} getRowId={(z) => z.zmccId} noun="ZMCCs" emptyTitle="No journeys" />
            </Block>
          )}

          {tab === 'TRANSIT' && (
            <>
              <Block title="Transit per ZMCC" info={INFO.transit}>
                <DataTable
                  columns={transitZmccColumns}
                  rows={levels?.transit?.byZmcc ?? []}
                  getRowId={(z) => z.zmccId}
                  noun="ZMCCs"
                  emptyTitle="No dispatches"
                />
              </Block>
              <Block title="Transit per tanker" info={INFO.onRoad}>
                <DataTable
                  columns={tankerColumns}
                  rows={levels?.transit?.tankers ?? []}
                  getRowId={(t) => t.visitId}
                  noun="tankers"
                  emptyTitle="No tankers"
                />
              </Block>
            </>
          )}

          {tab === 'WHOLE' && (
            <>
              <Block title="Whole lines" info={INFO.whole}>
                <WholeLinesTable whole={levels?.whole} />
                {levels?.whole && !levels.whole.reconciles ? (
                  <p className="text-xs text-amber-700">Net does not match Mobile Tester plus Transit.</p>
                ) : null}
              </Block>
              <Block title="Whole per ZMCC">
                <DataTable
                  columns={wholeZmccColumns}
                  rows={levels?.whole?.byZmcc ?? []}
                  getRowId={(z) => z.zmccId}
                  noun="ZMCCs"
                  emptyTitle="No records"
                />
              </Block>
            </>
          )}

          {tab === 'CONTRACTOR' && (
            <Block title="Contractor per tanker" info={INFO.contractor}>
              <ContractorTable rows={levels?.contractorTransit?.contractors ?? []} />
            </Block>
          )}
        </div>
      )}
    </div>
  );
};
