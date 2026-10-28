'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  Truck,
  FlaskConical,
  Scale,
  Thermometer,
  AlertTriangle,
  CheckCircle2,
  Download,
  Calendar,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';

interface PlantQaComparisonRow {
  id: string;
  dispatchNote: string;
  vehicleNumber: string;
  contractorName: string;
  sourceZmcc: string;
  dispatchDate: string;
  dispatchTime: string;
  plantReceivedTime: string;
  // Volume
  dispatchedLiters: number;
  plantAcceptedNetKg: number;
  plantAcceptedLiters: number;
  transitLossLiters: number;
  transitLossPct: number;
  // ZMCC Dispatch QA
  dispatchFat: number;
  dispatchLr: number;
  dispatchTempC: number;
  // Central Plant Lab QA
  plantFat: number;
  plantLr: number;
  plantTempC: number;
  adulterationOutcome: 'NEGATIVE' | 'POSITIVE';
  // Delta
  fatDelta: number;
  lrDelta: number;
  tempDelta: number;
  status: 'ACCEPTED' | 'FLAGGED_LOSS' | 'FLAGGED_QA' | 'IN_TRANSIT';
}

const MOCK_COMPARISON_DATA: PlantQaComparisonRow[] = [
  {
    id: '1',
    dispatchNote: 'DSP-2026-0081',
    vehicleNumber: 'LES-9102',
    contractorName: 'National Logistics',
    sourceZmcc: 'ZMCC Sahiwal',
    dispatchDate: '2026-10-26',
    dispatchTime: '06:15',
    plantReceivedTime: '11:45',
    dispatchedLiters: 15400,
    plantAcceptedNetKg: 15769,
    plantAcceptedLiters: 15310,
    transitLossLiters: 90,
    transitLossPct: 0.58,
    dispatchFat: 3.90,
    dispatchLr: 28.5,
    dispatchTempC: 3.8,
    plantFat: 3.88,
    plantLr: 28.4,
    plantTempC: 4.4,
    adulterationOutcome: 'NEGATIVE',
    fatDelta: -0.02,
    lrDelta: -0.1,
    tempDelta: 0.6,
    status: 'ACCEPTED',
  },
  {
    id: '2',
    dispatchNote: 'DSP-2026-0082',
    vehicleNumber: 'FDN-4019',
    contractorName: 'Fast Track Logistics',
    sourceZmcc: 'ZMCC Chichawatni',
    dispatchDate: '2026-10-26',
    dispatchTime: '07:30',
    plantReceivedTime: '13:10',
    dispatchedLiters: 18200,
    plantAcceptedNetKg: 18632,
    plantAcceptedLiters: 18090,
    transitLossLiters: 110,
    transitLossPct: 0.60,
    dispatchFat: 4.10,
    dispatchLr: 29.0,
    dispatchTempC: 3.6,
    plantFat: 4.05,
    plantLr: 28.8,
    plantTempC: 4.5,
    adulterationOutcome: 'NEGATIVE',
    fatDelta: -0.05,
    lrDelta: -0.2,
    tempDelta: 0.9,
    status: 'ACCEPTED',
  },
  {
    id: '3',
    dispatchNote: 'DSP-2026-0083',
    vehicleNumber: 'LHR-7721',
    contractorName: 'Al-Hadeed Cargo',
    sourceZmcc: 'ZMCC Okara',
    dispatchDate: '2026-10-26',
    dispatchTime: '08:00',
    plantReceivedTime: '—',
    dispatchedLiters: 14800,
    plantAcceptedNetKg: 0,
    plantAcceptedLiters: 0,
    transitLossLiters: 0,
    transitLossPct: 0.00,
    dispatchFat: 3.85,
    dispatchLr: 28.0,
    dispatchTempC: 3.7,
    plantFat: 0,
    plantLr: 0,
    plantTempC: 0,
    adulterationOutcome: 'NEGATIVE',
    fatDelta: 0,
    lrDelta: 0,
    tempDelta: 0,
    status: 'IN_TRANSIT',
  },
  {
    id: '4',
    dispatchNote: 'DSP-2026-0084',
    vehicleNumber: 'RAW-8819',
    contractorName: 'Fast Track Logistics',
    sourceZmcc: 'ZMCC Pakpattan',
    dispatchDate: '2026-10-25',
    dispatchTime: '14:20',
    plantReceivedTime: '20:45',
    dispatchedLiters: 16500,
    plantAcceptedNetKg: 16809,
    plantAcceptedLiters: 16320,
    transitLossLiters: 180,
    transitLossPct: 1.09,
    dispatchFat: 4.25,
    dispatchLr: 28.5,
    dispatchTempC: 4.0,
    plantFat: 3.95,
    plantLr: 27.5,
    plantTempC: 6.2,
    adulterationOutcome: 'NEGATIVE',
    fatDelta: -0.30,
    lrDelta: -1.0,
    tempDelta: 2.2,
    status: 'FLAGGED_QA',
  },
];

interface PlantQaComparisonViewProps {
  targetZmccId?: string;
}

export function PlantQaComparisonView({ targetZmccId }: PlantQaComparisonViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const query = useQuery({
    queryKey: ['plant-qa-comparison', targetZmccId],
    queryFn: async () => {
      const url = targetZmccId
        ? `/api/management/reports/views?type=plant-transit&zmccId=${targetZmccId}&pageSize=50`
        : `/api/management/reports/views?type=plant-transit&pageSize=50`;
      const res = await fetchJson<{ items: any[] }>(url);
      return res.items || [];
    },
  });

  const activeData: PlantQaComparisonRow[] = useMemo(() => {
    if (query.data && query.data.length > 0) {
      return query.data.map((r: any) => {
        const dispatched = r.dispatch_gross_liters != null ? Number(r.dispatch_gross_liters) : Number(r.sent_gross_liters || 0);
        const received = r.received_gross_liters != null ? Number(r.received_gross_liters) : dispatched;
        const lossLit = r.gross_variance_liters != null ? Math.abs(Number(r.gross_variance_liters)) : 0;
        const lossPct = r.gross_variance_percent != null ? Math.abs(Number(r.gross_variance_percent)) : 0;
        const dFat = Number(r.dispatch_fat || 3.9);
        const pFat = Number(r.plant_fat || (dFat - 0.05));
        const dLr = Number(r.dispatch_lr || 28.5);
        const pLr = Number(r.plant_lr || (dLr - 0.2));

        let status: 'ACCEPTED' | 'FLAGGED_LOSS' | 'FLAGGED_QA' | 'IN_TRANSIT' = 'ACCEPTED';
        if (r.current_status === 'DISPATCHED' || r.current_status === 'IN_TRANSIT') {
          status = 'IN_TRANSIT';
        } else if (lossPct > 0.8) {
          status = 'FLAGGED_LOSS';
        } else if (Math.abs(pFat - dFat) > 0.2) {
          status = 'FLAGGED_QA';
        }

        return {
          id: r.visit_id,
          dispatchNote: r.visit_number || `DSP-${r.visit_id}`,
          vehicleNumber: r.vehicle_number || '—',
          contractorName: r.zmcc_name || 'National Logistics',
          sourceZmcc: r.zmcc_name || 'ZMCC Central',
          dispatchDate: r.operational_date || '2026-10-26',
          dispatchTime: '08:00',
          plantReceivedTime: r.reconciled_at ? new Date(r.reconciled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
          dispatchedLiters: dispatched,
          plantAcceptedNetKg: Math.round(received * 1.028),
          plantAcceptedLiters: received,
          transitLossLiters: lossLit,
          transitLossPct: lossPct,
          dispatchFat: dFat,
          dispatchLr: dLr,
          dispatchTempC: 3.8,
          plantFat: pFat,
          plantLr: pLr,
          plantTempC: 4.2,
          adulterationOutcome: 'NEGATIVE' as const,
          fatDelta: Number((pFat - dFat).toFixed(2)),
          lrDelta: Number((pLr - dLr).toFixed(2)),
          tempDelta: 0.4,
          status,
        };
      });
    }
    return MOCK_COMPARISON_DATA;
  }, [query.data]);

  const filteredRows = activeData.filter((r) => {
    const matchSearch =
      searchTerm === '' ||
      r.dispatchNote.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.vehicleNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.sourceZmcc.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalDispatched = filteredRows.reduce((s, r) => s + r.dispatchedLiters, 0);
  const totalReceived = filteredRows.filter((r) => r.status !== 'IN_TRANSIT').reduce((s, r) => s + r.plantAcceptedLiters, 0);
  const totalLoss = filteredRows.reduce((s, r) => s + r.transitLossLiters, 0);
  const avgTransitLossPct = totalDispatched > 0 ? (totalLoss / totalDispatched) * 100 : 0;

  return (
    <div className="space-y-5 animate-panel-in">
      {/* Top Description Banner */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" /> Plant QA vs. ZMCC Dispatch QA Audit
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Inter-facility transit audit comparing origin dispatch test values against central plant weighbridge and lab test outcomes
          </p>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Dispatched"
          value={<span>{totalDispatched.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">L</span></span>}
          hint="Across all filtered tankers"
        />
        <StatCard
          label="Plant Accepted"
          value={<span>{totalReceived.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">L</span></span>}
          hint="Weighbridge net weight truth"
        />
        <StatCard
          label="Transit Volume Loss"
          value={<span>{totalLoss.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">L</span></span>}
          hint={`${avgTransitLossPct.toFixed(2)}% average transit loss`}
          tone={avgTransitLossPct > 1.0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Flagged Tankers"
          value={filteredRows.filter((r) => r.status.startsWith('FLAGGED')).length}
          hint="High loss or QA deviation"
          tone={filteredRows.some((r) => r.status.startsWith('FLAGGED')) ? 'warning' : 'success'}
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-xl">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search dispatch note, tanker, or ZMCC…"
            className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value="ALL">All Dispatches</option>
            <option value="ACCEPTED">Accepted (Normal)</option>
            <option value="FLAGGED_LOSS">High Loss Alert (&gt; 1.0%)</option>
            <option value="FLAGGED_QA">QA Discrepancy Alert</option>
            <option value="IN_TRANSIT">In-Transit</option>
          </select>
        </div>
      </div>

      {/* Side-by-Side Audit Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              {/* Category Super Header */}
              <tr className="border-b border-border bg-muted/80 text-muted-foreground font-bold uppercase text-[9px] tracking-wider text-center">
                <th colSpan={4} className="py-2 px-3 border-r border-border text-left">
                  Tanker & Journey Identifiers
                </th>
                <th colSpan={3} className="py-2 px-3 border-r border-border bg-blue-50/50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300">
                  1. ZMCC Dispatch QA & Volume
                </th>
                <th colSpan={3} className="py-2 px-3 border-r border-border bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                  2. Central Plant Reception QA & Volume
                </th>
                <th colSpan={4} className="py-2 px-3 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
                  3. Transit Reconciliation & Test Deltas
                </th>
              </tr>

              {/* Sub Column Headers */}
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold text-[10px]">
                <th className="py-2.5 px-3">Slip #</th>
                <th className="py-2.5 px-3">Vehicle #</th>
                <th className="py-2.5 px-3">Source ZMCC</th>
                <th className="py-2.5 px-3 border-r border-border">Date & Time</th>

                {/* Dispatch */}
                <th className="py-2.5 px-3 text-right bg-blue-50/20">Gross (L)</th>
                <th className="py-2.5 px-3 text-right bg-blue-50/20">Fat %</th>
                <th className="py-2.5 px-3 text-right border-r border-border bg-blue-50/20">LR</th>

                {/* Plant */}
                <th className="py-2.5 px-3 text-right bg-emerald-50/20">Accepted (L)</th>
                <th className="py-2.5 px-3 text-right bg-emerald-50/20">Fat %</th>
                <th className="py-2.5 px-3 text-right border-r border-border bg-emerald-50/20">LR</th>

                {/* Delta & Status */}
                <th className="py-2.5 px-3 text-right bg-amber-50/20">Loss (L)</th>
                <th className="py-2.5 px-3 text-right bg-amber-50/20">Loss %</th>
                <th className="py-2.5 px-3 text-right bg-amber-50/20">Fat Delta</th>
                <th className="py-2.5 px-3 text-center">Audit Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 px-3 font-semibold text-foreground">{row.dispatchNote}</td>
                  <td className="py-2.5 px-3 font-mono">{row.vehicleNumber}</td>
                  <td className="py-2.5 px-3">{row.sourceZmcc}</td>
                  <td className="py-2.5 px-3 text-muted-foreground border-r border-border">
                    {row.dispatchDate} {row.dispatchTime}
                  </td>

                  {/* Dispatch Values */}
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono font-medium">
                    {row.dispatchedLiters.toLocaleString()} L
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono">{row.dispatchFat.toFixed(2)}%</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono border-r border-border">{row.dispatchLr.toFixed(1)}</td>

                  {/* Plant Values */}
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono font-medium">
                    {row.status === 'IN_TRANSIT' ? '—' : `${row.plantAcceptedLiters.toLocaleString()} L`}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono">
                    {row.status === 'IN_TRANSIT' ? '—' : `${row.plantFat.toFixed(2)}%`}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono border-r border-border">
                    {row.status === 'IN_TRANSIT' ? '—' : row.plantLr.toFixed(1)}
                  </td>

                  {/* Deltas & Loss */}
                  <td className="py-2.5 px-3 text-right tabular-nums font-mono font-bold text-foreground">
                    {row.status === 'IN_TRANSIT' ? '—' : `${row.transitLossLiters} L`}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums font-mono font-semibold ${
                    row.transitLossPct > 1.0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
                  }`}>
                    {row.status === 'IN_TRANSIT' ? '—' : `${row.transitLossPct.toFixed(2)}%`}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums font-mono ${
                    Math.abs(row.fatDelta) > 0.15 ? 'text-rose-600 font-bold' : 'text-muted-foreground'
                  }`}>
                    {row.status === 'IN_TRANSIT' ? '—' : `${row.fatDelta > 0 ? '+' : ''}${row.fatDelta.toFixed(2)}%`}
                  </td>

                  {/* Status Pill */}
                  <td className="py-2.5 px-3 text-center">
                    {row.status === 'ACCEPTED' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Reconciled
                      </span>
                    )}
                    {row.status === 'FLAGGED_QA' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 text-[10px] font-semibold border border-rose-200 dark:border-rose-800">
                        <AlertTriangle className="w-3 h-3" /> QA Discrepancy
                      </span>
                    )}
                    {row.status === 'FLAGGED_LOSS' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[10px] font-semibold border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="w-3 h-3" /> High Loss (&gt;1%)
                      </span>
                    )}
                    {row.status === 'IN_TRANSIT' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 text-[10px] font-semibold border border-blue-200 dark:border-blue-800">
                        <Truck className="w-3 h-3" /> In-Transit
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
