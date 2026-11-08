'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Share2, Search, CheckCircle2, AlertTriangle, XCircle, Truck, FlaskConical, Store, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { DailyReportData } from '@/backend/services/superAdminDailyReportService';
import { SendReportModal } from './SendReportModal';
import { InfoTip } from '@/components/ui/info-tip';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatNumber } from '@/lib/format';

type MotRow = DailyReportData['motCollections'][number];
type ZmccRow = DailyReportData['zmccPortions'][number];
type ExceptionRow = DailyReportData['exceptions'][number];
type PlantQaRow = DailyReportData['plantQaVisits'][number];

function VerdictChip({ verdict }: { verdict: string }) {
  if (verdict === 'ACCEPTED') return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Accepted</span>;
  if (verdict === 'WARNING') return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Warning</span>;
  if (verdict === 'REJECTED') return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Rejected</span>;
  return null;
}

function WarningsCell({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-start gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0 break-words">{warnings.join('; ')}</span>
    </span>
  );
}

const motColumns: DataColumn<MotRow>[] = [
  { key: 'collection', header: 'Collection #', label: 'Collection #', primary: true, cell: (m) => <span className="font-semibold text-foreground">{m.collectionNumber}</span> },
  { key: 'time', header: 'Time', label: 'Time', cell: (m) => <span className="tabular-nums text-muted-foreground">{m.time}</span> },
  {
    key: 'shop',
    header: 'Village shop',
    label: 'Village shop',
    cell: (m) => (
      <div className="min-w-0">
        <span className="font-semibold text-foreground">{m.shopName}</span>
        <span className="block text-xs text-muted-foreground">{m.shopCode}</span>
      </div>
    ),
  },
  {
    key: 'tester',
    header: 'Route / Mobile Tester',
    label: 'Route / Mobile Tester',
    cell: (m) => (
      <div className="min-w-0">
        <span className="text-foreground">{m.motName}</span>
        {m.routeCode && <span className="block text-xs text-muted-foreground">Route {m.routeCode}</span>}
      </div>
    ),
  },
  { key: 'source', header: 'Source', label: 'Source', cell: (m) => <span className="text-secondary-foreground">{m.sourceName}</span> },
  { key: 'liters', header: 'Liters', label: 'Liters', align: 'right', cell: (m) => <span className="font-mono font-semibold tabular-nums text-foreground">{m.grossLiters.toFixed(1)} L</span> },
  { key: 'lr', header: 'LR', label: 'LR', align: 'right', cell: (m) => <span className="font-mono tabular-nums">{m.lr.toFixed(1)}</span> },
  { key: 'fat', header: 'Fat %', label: 'Fat %', align: 'right', cell: (m) => <span className="font-mono tabular-nums">{m.fat.toFixed(1)}%</span> },
  { key: 'snf', header: 'SNF %', label: 'SNF %', align: 'right', cell: (m) => <span className="font-mono tabular-nums">{m.snf.toFixed(2)}%</span> },
  { key: 'warnings', header: 'Warnings', label: 'Warnings', cell: (m) => <WarningsCell warnings={m.warnings} /> },
  { key: 'verdict', header: 'Verdict', label: 'Verdict', align: 'center', cell: (m) => <VerdictChip verdict={m.verdict} /> },
];

const zmccColumns: DataColumn<ZmccRow>[] = [
  { key: 'session', header: 'Session #', label: 'Session #', primary: true, cell: (p) => <span className="font-semibold text-foreground">#{p.sessionId}</span> },
  { key: 'time', header: 'Time', label: 'Time', cell: (p) => <span className="tabular-nums text-muted-foreground">{p.time}</span> },
  {
    key: 'type',
    header: 'Type',
    label: 'Type',
    cell: (p) => (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
        {p.arrivalType === 'MC' ? 'Route (MC)' : 'Contractor (HC)'}
      </span>
    ),
  },
  { key: 'token', header: 'Token #', label: 'Token #', cell: (p) => <span className="break-all font-mono font-semibold text-foreground">{p.tokenNo}</span> },
  { key: 'vehicle', header: 'Vehicle #', label: 'Vehicle #', cell: (p) => <span className="break-all font-mono font-semibold text-foreground">{p.vehicleNo}</span> },
  { key: 'supplier', header: 'Supplier / Route', label: 'Supplier / Route', cell: (p) => <span className="text-secondary-foreground">{p.supplierName}</span> },
  { key: 'portion', header: 'Portion', label: 'Portion', align: 'center', cell: (p) => <span className="font-semibold text-foreground">P{p.portionNumber}</span> },
  { key: 'liters', header: 'Liters', label: 'Liters', align: 'right', cell: (p) => <span className="font-mono font-semibold tabular-nums text-foreground">{p.grossLiters.toFixed(1)} L</span> },
  { key: 'temp', header: 'Temp', label: 'Temp', align: 'right', cell: (p) => <span className="font-mono tabular-nums">{p.temperature !== null ? `${p.temperature.toFixed(1)} °C` : '—'}</span> },
  { key: 'warnings', header: 'Warnings', label: 'Warnings', cell: (p) => <WarningsCell warnings={p.warnings} /> },
  { key: 'attendant', header: 'Lab attendant', label: 'Lab attendant', cell: (p) => <span className="text-secondary-foreground">{p.performedByRole || 'Attendant'}</span> },
  { key: 'verdict', header: 'Verdict', label: 'Verdict', align: 'center', cell: (p) => <VerdictChip verdict={p.verdict} /> },
];

const exceptionColumns: DataColumn<ExceptionRow>[] = [
  { key: 'reference', header: 'Reference #', label: 'Reference #', primary: true, cell: (e) => <span className="break-all font-semibold text-foreground">{e.referenceNumber}</span> },
  {
    key: 'entity',
    header: 'Entity type',
    label: 'Entity type',
    cell: (e) => <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">{e.entityType.replace(/_/g, ' ')}</span>,
  },
  { key: 'time', header: 'Time', label: 'Time', cell: (e) => <span className="tabular-nums text-muted-foreground">{e.timestamp}</span> },
  { key: 'zmcc', header: 'Location / ZMCC', label: 'Location / ZMCC', cell: (e) => <span className="text-secondary-foreground">{e.zmccName}</span> },
  { key: 'reason', header: 'Exception trigger', label: 'Exception trigger', cell: (e) => <span className="font-medium text-amber-900">{e.reason}</span> },
  {
    key: 'submitted',
    header: 'Submitted by',
    label: 'Submitted by',
    cell: (e) => (
      <div className="min-w-0">
        <span className="text-foreground">{e.submittedBy}</span>
        <span className="block text-xs text-muted-foreground">{e.submittedRole}</span>
      </div>
    ),
  },
  {
    key: 'resolved',
    header: 'Resolved by',
    label: 'Resolved by',
    cell: (e) => (
      <div className="min-w-0">
        <span className="font-semibold text-foreground">{e.reviewedBy}</span>
        {e.reviewedRole && <span className="block text-xs text-muted-foreground">{e.reviewedRole}</span>}
      </div>
    ),
  },
  { key: 'remarks', header: 'Remarks', label: 'Remarks', cell: (e) => <span className="text-secondary-foreground">{e.remarks || '—'}</span> },
  {
    key: 'decision',
    header: 'Decision',
    label: 'Decision',
    align: 'center',
    cell: (e) => (
      <>
        {e.decision === 'APPROVED' && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Approved</span>}
        {e.decision === 'REJECTED' && <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Overruled</span>}
        {e.decision === 'PENDING' && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pending</span>}
      </>
    ),
  },
];

const plantQaColumns: DataColumn<PlantQaRow>[] = [
  { key: 'visit', header: 'Visit #', label: 'Visit #', primary: true, cell: (p) => <span className="break-all font-semibold text-foreground">{p.visitNumber}</span> },
  { key: 'time', header: 'Time', label: 'Time', cell: (p) => <span className="tabular-nums text-muted-foreground">{p.time}</span> },
  { key: 'vehicle', header: 'Vehicle #', label: 'Vehicle #', cell: (p) => <span className="break-all font-mono font-semibold text-foreground">{p.vehicleNumber}</span> },
  { key: 'origin', header: 'Origin ZMCC', label: 'Origin ZMCC', cell: (p) => <span className="text-secondary-foreground">{p.sourceName}</span> },
  { key: 'portion', header: 'Portion', label: 'Portion', align: 'center', cell: (p) => <span className="font-semibold text-foreground">P{p.portionNumber}</span> },
  { key: 'liters', header: 'Liters', label: 'Liters', align: 'right', cell: (p) => <span className="font-mono font-semibold tabular-nums text-foreground">{p.grossLiters.toFixed(1)} L</span> },
  {
    key: 'mtd',
    header: 'MTD warning count',
    label: 'MTD warning count',
    align: 'center',
    cell: (p) => (
      <span
        className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
          p.requiresAvpEscalation ? 'border border-rose-300 bg-rose-100 text-rose-800' : 'bg-muted text-secondary-foreground'
        }`}
      >
        {p.mtdWarningCount} / {p.mtdThreshold}
      </span>
    ),
  },
  { key: 'warnings', header: 'Warnings', label: 'Warnings', cell: (p) => <WarningsCell warnings={p.warnings} /> },
  { key: 'decided', header: 'Decided by', label: 'Decided by', cell: (p) => <span className="text-secondary-foreground">{p.decidedBy}</span> },
  { key: 'verdict', header: 'Verdict', label: 'Verdict', align: 'center', cell: (p) => <VerdictChip verdict={p.verdict} /> },
];

type ReportTab = 'MOT' | 'ZMCC' | 'EXCEPTIONS' | 'PLANT_QA';

export function DailyReportDashboard() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<ReportTab>('MOT');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACCEPTED' | 'WARNING' | 'REJECTED'>('ALL');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<DailyReportData>({
    queryKey: ['super-admin', 'daily-report', date],
    queryFn: () => fetchJson<DailyReportData>(`/api/super-admin/daily-report?date=${date}`),
  });

  const changeDateBy = (days: number) => {
    const current = new Date(date);
    current.setDate(current.getDate() + days);
    setDate(current.toISOString().slice(0, 10));
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/super-admin/daily-report/export?date=${date}`);
      if (!res.ok) throw new Error('Failed to generate Excel report');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shakarganj-daily-report-${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Excel workbook downloaded successfully.');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Failed to download Excel report.');
    } finally {
      setIsExporting(false);
    }
  };

  const kpis = data?.kpis;
  const tableError = error ? getErrorMessage(error) || 'Could not load the report.' : null;

  // Filtered Lists
  const filteredMot = (data?.motCollections || []).filter((m) => {
    const matchStatus = statusFilter === 'ALL' || m.verdict === statusFilter;
    const matchSearch =
      !searchQuery ||
      m.collectionNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.motName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.sourceName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  const filteredZmcc = (data?.zmccPortions || []).filter((p) => {
    const matchStatus = statusFilter === 'ALL' || p.verdict === statusFilter;
    const matchSearch =
      !searchQuery ||
      p.tokenNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.vehicleNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplierName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sessionId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  const filteredExceptions = (data?.exceptions || []).filter((e) => {
    const matchSearch =
      !searchQuery ||
      e.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.zmccName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.submittedBy.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.reviewedBy || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.reason.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSearch;
  });

  const filteredPlantQa = (data?.plantQaVisits || []).filter((p) => {
    const matchStatus = statusFilter === 'ALL' || p.verdict === statusFilter;
    const matchSearch =
      !searchQuery ||
      p.visitNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sourceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.decidedBy.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden p-1">
      {/* Top Action Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">Mobile Tester collections, ZMCC lab portions, plant QA, exceptions and losses</p>
            <InfoTip text="Audit across Village Mobile Tester collections, ZMCC lab receptions, Plant QA, exceptions, and losses." />
          </div>
        </div>

        {/* Date Navigator & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Picker Controls */}
          <div className="flex items-center rounded-xl border border-border bg-subtle p-1">
            <button
              type="button"
              onClick={() => changeDateBy(-1)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-card hover:text-foreground"
              title="Previous day" aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-11 border-0 bg-transparent px-2 text-xs font-medium text-foreground focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => changeDateBy(1)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-card hover:text-foreground"
              title="Next day" aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              className="ml-1 min-h-11 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted"
            >
              Today
            </button>
          </div>

          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} title="Refresh data" aria-label="Refresh">
            <Loader2 className={isFetching ? 'animate-spin text-primary' : 'text-muted-foreground'} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button variant="outline" onClick={handleExportExcel} disabled={isExporting || isLoading}>
            <Download className="text-muted-foreground" />
            Export Excel
          </Button>

          <Button onClick={() => setIsSendModalOpen(true)} disabled={isLoading || !data}>
            <Share2 />
            Send report
          </Button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
        {/* Card 1: MOT Shop Collections */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Village intake
            </span>
            <span className="text-muted-foreground"><Store className="h-4 w-4" /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
              {kpis ? `${formatNumber(kpis.mot.totalLiters)} L` : '—'}
            </span>
            <span className="text-xs text-muted-foreground">
              ({kpis ? kpis.mot.totalCollections : 0} shops)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.mot.passedCount : 0} pass
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.mot.warningCount : 0} warn
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <XCircle className="h-3 w-3" />
              {kpis ? kpis.mot.rejectedCount : 0} rej
            </span>
          </div>
          {kpis && kpis.mot.totalLiters > 0 && (
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">
              Avg LR: {kpis.mot.avgLr} · Fat: {kpis.mot.avgFat}% · SNF: {kpis.mot.avgSnf}%
            </p>
          )}
        </div>

        {/* Card 2: ZMCC Lab Reception */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              ZMCC intake
            </span>
            <span className="text-muted-foreground"><FlaskConical className="h-4 w-4" /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
              {kpis ? `${formatNumber(kpis.zmcc.totalLiters)} L` : '—'}
            </span>
            <span className="text-xs text-muted-foreground">
              ({kpis ? kpis.zmcc.totalPortions : 0} portions)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.zmcc.passedCount : 0} pass
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.zmcc.warningCount : 0} warn
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <XCircle className="h-3 w-3" />
              {kpis ? kpis.zmcc.rejectedCount : 0} rej
            </span>
          </div>
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">
            Route trucks (MC) & Commercial tankers (HC)
          </p>
        </div>

        {/* Card 3: Factory Plant QA */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Plant QA
            </span>
            <span className="text-muted-foreground"><Truck className="h-4 w-4" /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
              {kpis ? `${formatNumber(kpis.plantQa.totalLiters)} L` : '—'}
            </span>
            <span className="text-xs text-muted-foreground">
              ({kpis ? kpis.plantQa.totalTankers : 0} tankers)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.plantQa.acceptedCount : 0} accepted
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.plantQa.warningCount : 0} warn
            </span>
          </div>
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">
            {kpis?.plantQa.mtdWarningEscalations
              ? `${kpis.plantQa.mtdWarningEscalations} tanker(s) exceeded MTD limit (AVP QA approval)`
              : 'All vehicles within MTD warning limit'}
          </p>
        </div>

        {/* Card 4: Exceptions & Supply Losses */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Exceptions and loss
            </span>
            <span className="text-muted-foreground"><ShieldCheck className="h-4 w-4" /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
              {kpis ? kpis.exceptions.totalHandled : 0} resolved
            </span>
            <span className="text-xs text-muted-foreground">
              ({kpis ? kpis.exceptions.pendingCount : 0} pending)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              {kpis ? kpis.exceptions.approvedCount : 0} approved
            </span>
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              {kpis ? kpis.exceptions.rejectedCount : 0} rejected
            </span>
          </div>
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">
            Loss: T1 {kpis ? kpis.losses.tier1LossPercent.toFixed(2) : '0'}% · T2 {kpis ? kpis.losses.tier2LossPercent.toFixed(2) : '0'}% · T3 {kpis ? kpis.losses.tier3LossPercent.toFixed(2) : '0'}%
          </p>
        </div>
      </div>

      {/* Tabs & Search Controls */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('MOT');
                setStatusFilter('ALL');
              }}
              className={`min-h-11 rounded-lg px-3 text-xs font-medium transition-colors ${
                activeTab === 'MOT'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-secondary-foreground hover:bg-muted'
              }`}
            >
              Mobile Tester collections ({data?.motCollections.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('ZMCC');
                setStatusFilter('ALL');
              }}
              className={`min-h-11 rounded-lg px-3 text-xs font-medium transition-colors ${
                activeTab === 'ZMCC'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-secondary-foreground hover:bg-muted'
              }`}
            >
              ZMCC lab portions ({data?.zmccPortions.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('EXCEPTIONS');
                setStatusFilter('ALL');
              }}
              className={`min-h-11 rounded-lg px-3 text-xs font-medium transition-colors ${
                activeTab === 'EXCEPTIONS'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-secondary-foreground hover:bg-muted'
              }`}
            >
              Exceptions audit ({data?.exceptions.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('PLANT_QA');
                setStatusFilter('ALL');
              }}
              className={`min-h-11 rounded-lg px-3 text-xs font-medium transition-colors ${
                activeTab === 'PLANT_QA'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-secondary-foreground hover:bg-muted'
              }`}
            >
              Plant QA tankers ({data?.plantQaVisits.length ?? 0})
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-[min(100%,11rem)] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search"
                className="min-h-11 w-full rounded-lg border border-border bg-subtle pl-8 pr-3 text-xs focus:border-primary focus:bg-card focus:outline-hidden"
              />
            </div>

            {activeTab !== 'EXCEPTIONS' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="min-h-11 rounded-lg border border-border bg-subtle px-2 text-xs font-medium text-secondary-foreground focus:outline-hidden"
              >
                <option value="ALL">All verdicts</option>
                <option value="ACCEPTED">Passed</option>
                <option value="WARNING">Warnings</option>
                <option value="REJECTED">Rejected</option>
              </select>
            )}
          </div>
        </div>

        {activeTab === 'MOT' && (
          <DataTable
            columns={motColumns}
            rows={filteredMot}
            getRowId={(m) => m.id}
            loading={isLoading}
            error={tableError}
            onRetry={() => void refetch()}
            emptyTitle="No Mobile Tester collections"
            emptyDescription="Nothing matches the selected filters."
            tableFrom="lg"
          />
        )}

        {activeTab === 'ZMCC' && (
          <DataTable
            columns={zmccColumns}
            rows={filteredZmcc}
            getRowId={(p) => p.id}
            loading={isLoading}
            error={tableError}
            onRetry={() => void refetch()}
            emptyTitle="No ZMCC lab portions"
            emptyDescription="Nothing matches the selected filters."
            tableFrom="lg"
          />
        )}

        {activeTab === 'EXCEPTIONS' && (
          <DataTable
            columns={exceptionColumns}
            rows={filteredExceptions}
            getRowId={(e) => e.id}
            loading={isLoading}
            error={tableError}
            onRetry={() => void refetch()}
            emptyTitle="No exceptions"
            emptyDescription="None were logged or decided on this date."
            tableFrom="lg"
          />
        )}

        {activeTab === 'PLANT_QA' && (
          <DataTable
            columns={plantQaColumns}
            rows={filteredPlantQa}
            getRowId={(p) => p.id}
            loading={isLoading}
            error={tableError}
            onRetry={() => void refetch()}
            emptyTitle="No plant QA inspections"
            emptyDescription="None were recorded for this date."
            tableFrom="lg"
          />
        )}
      </div>

      {/* Modal: Send Report */}
      {data && (
        <SendReportModal
          isOpen={isSendModalOpen}
          onClose={() => setIsSendModalOpen(false)}
          reportData={data}
        />
      )}
    </div>
  );
}
