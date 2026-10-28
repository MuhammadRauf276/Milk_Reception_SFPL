'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, ChevronLeft, ChevronRight, Download, Share2, Search, Filter, CheckCircle2, AlertTriangle, XCircle, Clock, Layers, Truck, FlaskConical, Store, ShieldAlert, ShieldCheck, TrendingDown, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { DailyReportData } from '@/backend/services/superAdminDailyReportService';
import { SendReportModal } from './SendReportModal';
import { InfoTip } from '@/components/ui/info-tip';

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900">Daily Report</h1>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground border border-border">
              Executive Console
            </span>
            <InfoTip text="Audit across Village MOT collections, ZMCC lab receptions, Plant QA, exceptions, and losses." />
          </div>
        </div>

        {/* Date Navigator & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Picker Controls */}
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => changeDateBy(-1)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-slate-900 transition"
              title="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-0 bg-transparent px-2 py-1 text-xs font-bold text-slate-800 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => changeDateBy(1)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-slate-900 transition"
              title="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              className="ml-1 rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition disabled:opacity-50"
            title="Refresh Data"
          >
            <Loader2 className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-primary' : 'text-slate-500'}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExporting || isLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 shadow-2xs transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSendModalOpen(true)}
            disabled={isLoading || !data}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-primary-hover transition disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>Send Report</span>
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: MOT Shop Collections */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              1. Village Intake
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-primary">
              <Store className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {kpis ? `${kpis.mot.totalLiters.toLocaleString()} L` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              ({kpis ? kpis.mot.totalCollections : 0} shops)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.mot.passedCount : 0} Pass
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.mot.warningCount : 0} Warn
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <XCircle className="h-3 w-3" />
              {kpis ? kpis.mot.rejectedCount : 0} Rej
            </span>
          </div>
          {kpis && kpis.mot.totalLiters > 0 && (
            <p className="mt-1.5 text-[11px] font-medium text-slate-500">
              Avg LR: {kpis.mot.avgLr} · Fat: {kpis.mot.avgFat}% · SNF: {kpis.mot.avgSnf}%
            </p>
          )}
        </div>

        {/* Card 2: ZMCC Lab Reception */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              2. ZMCC Intake
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <FlaskConical className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {kpis ? `${kpis.zmcc.totalLiters.toLocaleString()} L` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              ({kpis ? kpis.zmcc.totalPortions : 0} portions)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.zmcc.passedCount : 0} Pass
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.zmcc.warningCount : 0} Warn
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <XCircle className="h-3 w-3" />
              {kpis ? kpis.zmcc.rejectedCount : 0} Rej
            </span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">
            Route trucks (MC) & Commercial tankers (HC)
          </p>
        </div>

        {/* Card 3: Factory Plant QA */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              3. Plant QA
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <Truck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {kpis ? `${kpis.plantQa.totalLiters.toLocaleString()} L` : '—'}
            </span>
            <span className="text-xs text-slate-500">
              ({kpis ? kpis.plantQa.totalTankers : 0} tankers)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {kpis ? kpis.plantQa.acceptedCount : 0} Accepted
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {kpis ? kpis.plantQa.warningCount : 0} Warn
            </span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">
            {kpis?.plantQa.mtdWarningEscalations
              ? `${kpis.plantQa.mtdWarningEscalations} tanker(s) exceeded MTD limit (AVP QA approval)`
              : 'All vehicles within MTD warning limit'}
          </p>
        </div>

        {/* Card 4: Exceptions & Supply Losses */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              4. Exceptions & Loss
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {kpis ? kpis.exceptions.totalHandled : 0} Resolved
            </span>
            <span className="text-xs text-slate-500">
              ({kpis ? kpis.exceptions.pendingCount : 0} pending)
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              {kpis ? kpis.exceptions.approvedCount : 0} Approved
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              {kpis ? kpis.exceptions.rejectedCount : 0} Rejected
            </span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">
            Loss: T1 {kpis ? kpis.losses.tier1LossPercent.toFixed(2) : '0'}% · T2 {kpis ? kpis.losses.tier2LossPercent.toFixed(2) : '0'}% · T3 {kpis ? kpis.losses.tier3LossPercent.toFixed(2) : '0'}%
          </p>
        </div>
      </div>

      {/* Tabs & Search Controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('MOT');
                setStatusFilter('ALL');
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'MOT'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              MOT Collections ({data?.motCollections.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('ZMCC');
                setStatusFilter('ALL');
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'ZMCC'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              ZMCC Lab Portions ({data?.zmccPortions.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('EXCEPTIONS');
                setStatusFilter('ALL');
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'EXCEPTIONS'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Exceptions Audit ({data?.exceptions.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('PLANT_QA');
                setStatusFilter('ALL');
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'PLANT_QA'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Plant QA Tankers ({data?.plantQaVisits.length ?? 0})
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search table…"
                className="h-8 w-44 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:border-primary focus:bg-white focus:outline-none"
              />
            </div>

            {activeTab !== 'EXCEPTIONS' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="ALL">All Verdicts</option>
                <option value="ACCEPTED">Passed</option>
                <option value="WARNING">Warnings</option>
                <option value="REJECTED">Rejected</option>
              </select>
            )}
          </div>
        </div>

        {/* Tab 1: MOT Collections Table */}
        {activeTab === 'MOT' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Collection #</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Village Shop</th>
                  <th className="p-3">Route / MOT</th>
                  <th className="p-3">Source</th>
                  <th className="p-3 text-right">Liters</th>
                  <th className="p-3 text-right">LR</th>
                  <th className="p-3 text-right">Fat %</th>
                  <th className="p-3 text-right">SNF %</th>
                  <th className="p-3">Warnings</th>
                  <th className="p-3 text-center">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredMot.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-6 text-center text-slate-500">
                      No MOT collections found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredMot.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-bold text-slate-900">{m.collectionNumber}</td>
                      <td className="p-3 tabular-nums text-slate-500">{m.time}</td>
                      <td className="p-3">
                        <span className="font-semibold text-slate-900">{m.shopName}</span>
                        <span className="block text-[10px] text-slate-400">{m.shopCode}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-slate-900">{m.motName}</span>
                        {m.routeCode && <span className="block text-[10px] text-slate-400">Route {m.routeCode}</span>}
                      </td>
                      <td className="p-3 text-slate-600 truncate max-w-[140px]">{m.sourceName}</td>
                      <td className="p-3 text-right tabular-nums font-bold text-slate-900">
                        {m.grossLiters.toFixed(1)} L
                      </td>
                      <td className="p-3 text-right tabular-nums">{m.lr.toFixed(1)}</td>
                      <td className="p-3 text-right tabular-nums">{m.fat.toFixed(1)}%</td>
                      <td className="p-3 text-right tabular-nums">{m.snf.toFixed(2)}%</td>
                      <td className="p-3">
                        {m.warnings.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            {m.warnings.join('; ')}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {m.verdict === 'ACCEPTED' && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Accepted
                          </span>
                        )}
                        {m.verdict === 'WARNING' && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                            Warning
                          </span>
                        )}
                        {m.verdict === 'REJECTED' && (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                            Rejected
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: ZMCC Lab Portions Table */}
        {activeTab === 'ZMCC' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Session #</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Token #</th>
                  <th className="p-3">Vehicle #</th>
                  <th className="p-3">Supplier / Route</th>
                  <th className="p-3 text-center">Portion</th>
                  <th className="p-3 text-right">Liters</th>
                  <th className="p-3 text-right">Temp</th>
                  <th className="p-3">Warnings</th>
                  <th className="p-3">Lab Attendant</th>
                  <th className="p-3 text-center">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredZmcc.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-6 text-center text-slate-500">
                      No ZMCC lab portions found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredZmcc.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-bold text-slate-900">#{p.sessionId}</td>
                      <td className="p-3 tabular-nums text-slate-500">{p.time}</td>
                      <td className="p-3">
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          p.arrivalType === 'MC' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                        }`}>
                          {p.arrivalType === 'MC' ? 'Route (MC)' : 'Contractor (HC)'}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-slate-800">{p.tokenNo}</td>
                      <td className="p-3 font-bold text-slate-900">{p.vehicleNo}</td>
                      <td className="p-3 text-slate-700 truncate max-w-[150px]">{p.supplierName}</td>
                      <td className="p-3 text-center font-bold text-slate-800">P{p.portionNumber}</td>
                      <td className="p-3 text-right tabular-nums font-bold text-slate-900">
                        {p.grossLiters.toFixed(1)} L
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {p.temperature !== null ? `${p.temperature.toFixed(1)} °C` : '—'}
                      </td>
                      <td className="p-3">
                        {p.warnings.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            {p.warnings.join('; ')}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">{p.performedByRole || 'Attendant'}</td>
                      <td className="p-3 text-center">
                        {p.verdict === 'ACCEPTED' && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Accepted
                          </span>
                        )}
                        {p.verdict === 'WARNING' && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                            Warning
                          </span>
                        )}
                        {p.verdict === 'REJECTED' && (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                            Rejected
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Exceptions Audit Table */}
        {activeTab === 'EXCEPTIONS' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Entity Type</th>
                  <th className="p-3">Reference #</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Location / ZMCC</th>
                  <th className="p-3">Exception Trigger</th>
                  <th className="p-3">Submitted By</th>
                  <th className="p-3">Resolved By</th>
                  <th className="p-3">Remarks</th>
                  <th className="p-3 text-center">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredExceptions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-slate-500">
                      No exceptions logged or decided on this date.
                    </td>
                  </tr>
                ) : (
                  filteredExceptions.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          {e.entityType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-900">{e.referenceNumber}</td>
                      <td className="p-3 tabular-nums text-slate-500">{e.timestamp}</td>
                      <td className="p-3 text-slate-700">{e.zmccName}</td>
                      <td className="p-3 font-medium text-amber-900 max-w-[220px]">{e.reason}</td>
                      <td className="p-3">
                        <span className="text-slate-900">{e.submittedBy}</span>
                        <span className="block text-[10px] text-slate-400">{e.submittedRole}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-semibold text-slate-900">{e.reviewedBy}</span>
                        {e.reviewedRole && <span className="block text-[10px] text-slate-400">{e.reviewedRole}</span>}
                      </td>
                      <td className="p-3 text-slate-600 truncate max-w-[200px]">{e.remarks || '—'}</td>
                      <td className="p-3 text-center">
                        {e.decision === 'APPROVED' && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Approved
                          </span>
                        )}
                        {e.decision === 'REJECTED' && (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                            Overruled
                          </span>
                        )}
                        {e.decision === 'PENDING' && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Plant QA Table */}
        {activeTab === 'PLANT_QA' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Visit #</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Vehicle #</th>
                  <th className="p-3">Origin ZMCC</th>
                  <th className="p-3 text-center">Portion</th>
                  <th className="p-3 text-right">Liters</th>
                  <th className="p-3 text-center">MTD Warning Count</th>
                  <th className="p-3">Warnings</th>
                  <th className="p-3">Decided By</th>
                  <th className="p-3 text-center">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {filteredPlantQa.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-slate-500">
                      No plant QA inspections recorded for this date.
                    </td>
                  </tr>
                ) : (
                  filteredPlantQa.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-bold text-slate-900">{p.visitNumber}</td>
                      <td className="p-3 tabular-nums text-slate-500">{p.time}</td>
                      <td className="p-3 font-bold text-slate-900">{p.vehicleNumber}</td>
                      <td className="p-3 text-slate-700">{p.sourceName}</td>
                      <td className="p-3 text-center font-semibold text-slate-800">P{p.portionNumber}</td>
                      <td className="p-3 text-right tabular-nums font-bold text-slate-900">
                        {p.grossLiters.toFixed(1)} L
                      </td>
                      <td className="p-3 text-center">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          p.requiresAvpEscalation
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {p.mtdWarningCount} / {p.mtdThreshold}
                        </span>
                      </td>
                      <td className="p-3">
                        {p.warnings.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            {p.warnings.join('; ')}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-700">{p.decidedBy}</td>
                      <td className="p-3 text-center">
                        {p.verdict === 'ACCEPTED' && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Accepted
                          </span>
                        )}
                        {p.verdict === 'WARNING' && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                            Warning
                          </span>
                        )}
                        {p.verdict === 'REJECTED' && (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                            Rejected
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
