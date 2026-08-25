'use client';

import React, { useState, useEffect } from 'react';
import { MilkProcessLog } from '@core/types';
import { computeVehicleDecisionSummary, computeRuntimeMetrics } from '@backend/services/operationalCalculations';
import { warnDuplicateKeys } from '@/lib/key-utils';
import {
  Truck,
  Layers,
  Calendar,
  Filter,
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  ShieldCheck,
  Scale,
  FlaskConical,
  FileText,
  ArrowLeft
} from 'lucide-react';

export type InspectionMode = 'VISIT' | 'PORTION';

export type InspectionTarget =
  | {
      mode: 'VISIT';
      visitId: string;
      portionId?: never;
    }
  | {
      mode: 'PORTION';
      visitId: string;
      portionId: string;
    };

export interface DynamicTestComparison {
  testId: string;
  testCode: string;
  testName: string;
  category: 'Composition' | 'Physical' | 'Chemical' | 'Adulteration' | 'Microbiological' | 'Other';
  testScope: 'DISPATCH' | 'PLANT' | 'BOTH';
  unit: string;
  resultType: 'NUMERIC' | 'TEXT' | 'BOOLEAN';
  dispatchResult: {
    status: 'AVAILABLE' | 'PENDING' | 'NOT_TESTED' | 'NOT_APPLICABLE';
    value: string | number | null;
  };
  plantResult: {
    status: 'AVAILABLE' | 'PENDING' | 'NOT_TESTED' | 'NOT_APPLICABLE';
    value: string | number | null;
  };
  difference: {
    numericValue: number | null;
    displayText: string;
  };
}

export function buildPortionDynamicTests(log: MilkProcessLog): DynamicTestComparison[] {
  const metrics = computeRuntimeMetrics(log);

  const dFat = log.dispatch_fat;
  const lFat = log.sampling_fat;

  const dLr = log.dispatch_lr;
  const lLr = log.sampling_lr;

  const dSnf = metrics.computed_dispatch_snf;
  const lSnf = metrics.computed_sampling_snf;

  const dTs = metrics.computed_dispatch_ts;
  const lTs = metrics.computed_sampling_ts;

  const mbrtMins = log.b_mbrt_minutes_test;

  return [
    {
      testId: 'fat',
      testCode: 'FAT_01',
      testName: 'Fat Percentage (Fat %)',
      category: 'Composition',
      testScope: 'BOTH',
      unit: '%',
      resultType: 'NUMERIC',
      dispatchResult: dFat != null ? { status: 'AVAILABLE', value: dFat } : { status: 'PENDING', value: null },
      plantResult: lFat != null ? { status: 'AVAILABLE', value: lFat } : { status: 'PENDING', value: null },
      difference:
        lFat != null && dFat != null
          ? {
              numericValue: Number((lFat - dFat).toFixed(2)),
              displayText: lFat - dFat >= 0 ? `+${(lFat - dFat).toFixed(2)}%` : `${(lFat - dFat).toFixed(2)}%`,
            }
          : { numericValue: null, displayText: '--' },
    },
    {
      testId: 'lr',
      testCode: 'LR_01',
      testName: 'Lactometer Reading (LR)',
      category: 'Physical',
      testScope: 'BOTH',
      unit: 'LR',
      resultType: 'NUMERIC',
      dispatchResult: dLr != null ? { status: 'AVAILABLE', value: dLr } : { status: 'PENDING', value: null },
      plantResult: lLr != null ? { status: 'AVAILABLE', value: lLr } : { status: 'PENDING', value: null },
      difference:
        lLr != null && dLr != null
          ? {
              numericValue: Number((lLr - dLr).toFixed(2)),
              displayText: lLr - dLr >= 0 ? `+${(lLr - dLr).toFixed(2)}` : `${(lLr - dLr).toFixed(2)}`,
            }
          : { numericValue: null, displayText: '--' },
    },
    {
      testId: 'snf',
      testCode: 'SNF_01',
      testName: 'Solids-Not-Fat (SNF %)',
      category: 'Composition',
      testScope: 'BOTH',
      unit: '%',
      resultType: 'NUMERIC',
      dispatchResult: dSnf != null ? { status: 'AVAILABLE', value: dSnf } : { status: 'PENDING', value: null },
      plantResult: lSnf != null ? { status: 'AVAILABLE', value: lSnf } : { status: 'PENDING', value: null },
      difference:
        lSnf != null && dSnf != null
          ? {
              numericValue: Number((lSnf - dSnf).toFixed(2)),
              displayText: lSnf - dSnf >= 0 ? `+${(lSnf - dSnf).toFixed(2)}%` : `${(lSnf - dSnf).toFixed(2)}%`,
            }
          : { numericValue: null, displayText: '--' },
    },
    {
      testId: 'ts',
      testCode: 'TS_01',
      testName: 'Total Solids (TS %)',
      category: 'Composition',
      testScope: 'BOTH',
      unit: '%',
      resultType: 'NUMERIC',
      dispatchResult: dTs != null ? { status: 'AVAILABLE', value: dTs } : { status: 'PENDING', value: null },
      plantResult: lTs != null ? { status: 'AVAILABLE', value: lTs } : { status: 'PENDING', value: null },
      difference:
        lTs != null && dTs != null
          ? {
              numericValue: Number((lTs - dTs).toFixed(2)),
              displayText: lTs - dTs >= 0 ? `+${(lTs - dTs).toFixed(2)}%` : `${(lTs - dTs).toFixed(2)}%`,
            }
          : { numericValue: null, displayText: '--' },
    },
    {
      testId: 'mbrt',
      testCode: 'MBRT_01',
      testName: 'Methylene Blue Reduction Time (MBRT)',
      category: 'Microbiological',
      testScope: 'PLANT',
      unit: 'mins',
      resultType: 'NUMERIC',
      dispatchResult: { status: 'NOT_APPLICABLE', value: 'N/A (Plant Only)' },
      plantResult: mbrtMins != null ? { status: 'AVAILABLE', value: `${mbrtMins} mins` } : { status: 'PENDING', value: null },
      difference: { numericValue: null, displayText: 'N/A' },
    },
    {
      testId: 'acidity',
      testCode: 'ACID_01',
      testName: 'Lactic Acidity Test',
      category: 'Chemical',
      testScope: 'BOTH',
      unit: '%',
      resultType: 'NUMERIC',
      dispatchResult: { status: 'NOT_TESTED', value: null },
      plantResult: { status: 'NOT_TESTED', value: null },
      difference: { numericValue: null, displayText: '--' },
    },
    {
      testId: 'temperature',
      testCode: 'TEMP_01',
      testName: 'Milk Temperature',
      category: 'Physical',
      testScope: 'BOTH',
      unit: '°C',
      resultType: 'NUMERIC',
      dispatchResult: { status: 'NOT_TESTED', value: null },
      plantResult: { status: 'NOT_TESTED', value: null },
      difference: { numericValue: null, displayText: '--' },
    },
  ];
}

interface VehicleGroup {
  visitId: number;
  vehicleNumber: string;
  dispatchDate: string;
  zonalContractorName: string;
  overallStatus: string;
  totalZonalDispatchLiters: number;
  plantReceivedLiters: number | null;
  varianceLiters: number | null;
  variancePercent: number | null;
  grossWeightKg: number | null;
  tareWeightKg: number | null;
  netWeightKg: number | null;
  tokenNumber: string | null;
  portions: MilkProcessLog[];
}

interface ZonalHistoryTableProps {
  logs: MilkProcessLog[];
  targetZone: string;
  onInspectDetails?: (log: MilkProcessLog) => void;
  onDateFilterChange?: (fromDate?: string, toDate?: string) => void;
  currentFromDate?: string;
  currentToDate?: string;
}

export const ZonalHistoryTable: React.FC<ZonalHistoryTableProps> = ({
  logs,
  targetZone,
  onInspectDetails,
  onDateFilterChange,
  currentFromDate = '',
  currentToDate = '',
}) => {
  const [expandedVisitIds, setExpandedVisitIds] = useState<Set<number>>(new Set());
  const [fromDate, setFromDate] = useState(currentFromDate);
  const [toDate, setToDate] = useState(currentToDate);
  const [dateError, setDateError] = useState<string | null>(null);

  // SECTION 3: Explicit inspection state
  const [inspectionTarget, setInspectionTarget] = useState<InspectionTarget | null>(null);

  useEffect(() => {
    setFromDate(currentFromDate);
    setToDate(currentToDate);
  }, [currentFromDate, currentToDate]);

  // Lock background scrolling when inspection modal is open
  useEffect(() => {
    if (inspectionTarget) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [inspectionTarget]);

  // Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inspectionTarget) {
        setInspectionTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectionTarget]);

  const handleApplyDateFilter = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('From Date cannot be after To Date. Please select a valid date range.');
      return;
    }
    setDateError(null);
    if (onDateFilterChange) {
      onDateFilterChange(fromDate || undefined, toDate || undefined);
    }
  };

  const handleClearDateFilter = () => {
    setFromDate('');
    setToDate('');
    setDateError(null);
    if (onDateFilterChange) {
      onDateFilterChange(undefined, undefined);
    }
  };

  // Group flat portion logs into Complete Vehicle Visits (Model B Architecture)
  const visitGroupsMap = new Map<number, VehicleGroup>();

  for (const rawLog of logs) {
    const computed = computeRuntimeMetrics(rawLog);
    const visitId = computed.id;

    if (!visitGroupsMap.has(visitId)) {
      let grossW = computed.first_weight_of_vehicle || null;
      let tareW = computed.second_weight_of_vehicle || null;
      let netW = grossW != null && tareW != null ? grossW - tareW : null;

      let visitPlantRecv: number | null = null;
      if (computed.computed_plant_liters != null) {
        visitPlantRecv = computed.computed_plant_liters;
      } else if (netW != null && computed.sampling_lr != null) {
        visitPlantRecv = Number((netW / (1 + (computed.sampling_lr / 1000))).toFixed(2));
      }

      visitGroupsMap.set(visitId, {
        visitId,
        vehicleNumber: computed.vehicle_number,
        dispatchDate: computed.dispatch_date || (computed.created_at ? computed.created_at.split('T')[0] : 'N/A'),
        zonalContractorName: computed.zonal_contractor_name,
        overallStatus: computed.status,
        totalZonalDispatchLiters: 0,
        plantReceivedLiters: visitPlantRecv,
        varianceLiters: null,
        variancePercent: null,
        grossWeightKg: grossW,
        tareWeightKg: tareW,
        netWeightKg: netW,
        tokenNumber: computed.token_number || null,
        portions: [],
      });
    }

    const group = visitGroupsMap.get(visitId)!;
    group.portions.push(computed);
    group.totalZonalDispatchLiters += computed.dispatch_liters_gross || 0;

    const stUpper = String(computed.status).toUpperCase();
    if (stUpper !== 'COMPLETED' && stUpper !== 'READY_FOR_TARE' && stUpper !== 'SCALE_2_READY' && stUpper !== 'EXIT') {
      group.overallStatus = computed.status;
    }
  }

  // Calculate visit-level volume variance
  visitGroupsMap.forEach((group) => {
    if (group.plantReceivedLiters != null) {
      group.varianceLiters = Number((group.plantReceivedLiters - group.totalZonalDispatchLiters).toFixed(2));
      group.variancePercent =
        group.totalZonalDispatchLiters > 0
          ? Number(((group.varianceLiters / group.totalZonalDispatchLiters) * 100).toFixed(2))
          : 0;
    }
  });

  const vehicleGroups = Array.from(visitGroupsMap.values());

  if (process.env.NODE_ENV !== 'production' && vehicleGroups.length > 0) {
    const parentKeys = vehicleGroups.map((g) => `history-${String(g.visitId)}`);
    warnDuplicateKeys('ZonalHistoryTable Vehicle Groups', parentKeys);

    const subRowKeys: string[] = [];
    vehicleGroups.forEach((g) => {
      g.portions.forEach((p) => {
        const portionIdStr = p.portion_id ? String(p.portion_id) : String(p.id);
        subRowKeys.push(`history-${String(g.visitId)}-${portionIdStr}`);
      });
    });
    warnDuplicateKeys('ZonalHistoryTable Portion Sub-Rows', subRowKeys);
  }

  const toggleExpand = (visitId: number) => {
    setExpandedVisitIds((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  };

  const toggleExpandAll = () => {
    if (expandedVisitIds.size === vehicleGroups.length) {
      setExpandedVisitIds(new Set());
    } else {
      setExpandedVisitIds(new Set(vehicleGroups.map((g) => g.visitId)));
    }
  };

  // Resolve currently targeted inspection group & portion
  const targetedGroup = inspectionTarget
    ? vehicleGroups.find((g) => String(g.visitId) === inspectionTarget.visitId) || null
    : null;

  const targetedPortion =
    inspectionTarget && inspectionTarget.mode === 'PORTION' && targetedGroup
      ? targetedGroup.portions.find(
          (p) => String(p.portion_id || p.id) === inspectionTarget.portionId
        ) || null
      : null;

  return (
    <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4 text-[#111311]">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-[#1E3A8A] text-white">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold tracking-tight text-[#111311]">
              Zonal Historical Archive ({targetZone})
            </h3>
            <p className="text-xs text-[#334155] font-semibold">
              Authoritative dispatch date filter & expandable portion-level inspection for {targetZone}.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {vehicleGroups.length > 0 && (
            <button
              onClick={toggleExpandAll}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#1E3A8A] hover:bg-[#F4F0E6]/60 transition flex items-center space-x-1"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{expandedVisitIds.size === vehicleGroups.length ? 'Collapse All' : 'Expand All'}</span>
            </button>
          )}
          <span className="px-3 py-1.5 rounded-full text-xs font-mono font-black bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]">
            {vehicleGroups.length} Vehicles ({logs.length} Portions)
          </span>
        </div>
      </div>

      {/* Authoritative Business Date Filter Bar */}
      <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 space-y-2">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-[#1E3A8A]" />
            <span className="text-xs font-bold text-[#111311]">Filter by Dispatch / Business Date:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center space-x-1">
              <span className="text-[10px] font-bold text-slate-500">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setDateError(null);
                }}
                className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#FFFFFF] border border-[#EAE4D5] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
              />
            </div>

            <div className="flex items-center space-x-1">
              <span className="text-[10px] font-bold text-slate-500">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setDateError(null);
                }}
                className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#FFFFFF] border border-[#EAE4D5] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
              />
            </div>

            <button
              onClick={handleApplyDateFilter}
              className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-[#1E3A8A] text-white hover:bg-blue-900 shadow-sm transition flex items-center space-x-1"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Apply Filter</span>
            </button>

            {(fromDate || toDate) && (
              <button
                onClick={handleClearDateFilter}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FFFFFF] border border-[#EAE4D5] text-slate-700 hover:bg-[#F4F0E6] transition flex items-center space-x-1"
              >
                <X className="w-3.5 h-3.5 text-slate-500" />
                <span>Clear Date Filter</span>
              </button>
            )}
          </div>
        </div>

        {dateError && (
          <div className="p-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-xs font-bold font-sans">
            {dateError}
          </div>
        )}
      </div>

      {/* Expandable Grouped Table */}
      <div className="overflow-x-auto rounded-xl border border-[#EAE4D5]/80 bg-[#FDFBF9]">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 text-[#111311] font-sans font-extrabold uppercase text-[10px] tracking-wider">
              <th className="p-3 w-10 text-center"></th>
              <th className="p-3">Dispatch Date</th>
              <th className="p-3">Vehicle #</th>
              <th className="p-3">Contractor / Zone</th>
              <th className="p-3 text-center">Portions Count</th>
              <th className="p-3 text-right">Zonal Dispatch</th>
              <th className="p-3 text-right">Plant Receipt</th>
              <th className="p-3 text-right">Variance</th>
              <th className="p-3 text-center">Overall Decision</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAE4D5]/80 font-bold text-[#111311]">
            {vehicleGroups.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500 font-sans">
                  No historical visits found for the selected date range.
                </td>
              </tr>
            ) : (
              vehicleGroups.map((group) => {
                const isExpanded = expandedVisitIds.has(group.visitId);
                const visitKey = `history-${String(group.visitId)}`;
                const decisionSummary = computeVehicleDecisionSummary(group.portions, group.overallStatus);

                return (
                  <React.Fragment key={visitKey}>
                    {/* Parent Vehicle Visit Row */}
                    <tr
                      className={`hover:bg-[#F4F0E6]/80 transition-all duration-150 ease-in-out cursor-pointer ${
                        decisionSummary.isAllRejected
                          ? 'bg-[#FEF2F2]/80 border-l-4 border-l-[#991B1B]'
                          : decisionSummary.isMixed
                          ? 'bg-[#FFFBEB]/80 border-l-4 border-l-[#D97706]'
                          : 'bg-[#FFFFFF]'
                      }`}
                      onClick={() => toggleExpand(group.visitId)}
                    >
                      {/* Expand Toggle Chevron */}
                      <td className="p-3 text-center text-[#1E3A8A]">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 inline-block text-[#1E3A8A]" />
                        ) : (
                          <ChevronRight className="w-4 h-4 inline-block text-slate-400" />
                        )}
                      </td>

                      {/* Date */}
                      <td className="p-3 text-slate-600 font-semibold font-sans">{group.dispatchDate}</td>

                      {/* Vehicle # */}
                      <td className="p-3 font-black font-mono text-sm text-[#111311]">{group.vehicleNumber}</td>

                      {/* Contractor */}
                      <td className="p-3 font-semibold font-sans text-slate-700">{group.zonalContractorName}</td>

                      {/* Portions Count */}
                      <td className="p-3 text-center">
                        <span className="px-2.5 py-1 rounded-md text-[11px] font-black bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                          {group.portions.length} {group.portions.length === 1 ? 'Portion' : 'Portions'}
                        </span>
                      </td>

                      {/* Zonal Dispatch */}
                      <td className="p-3 text-right text-slate-700">
                        {group.totalZonalDispatchLiters.toLocaleString()} L
                      </td>

                      {/* Plant Receipt Against This Visit */}
                      <td className="p-3 text-right font-black text-[#1E3A8A]">
                        {group.plantReceivedLiters != null
                          ? `${group.plantReceivedLiters.toLocaleString()} L`
                          : 'Pending Scale 2'}
                      </td>

                      {/* Visit Volume Variance */}
                      <td className="p-3 text-right">
                        {group.varianceLiters != null ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-black ${
                              group.varianceLiters >= 0
                                ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                                : 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                            }`}
                          >
                            {group.varianceLiters >= 0
                              ? `+${group.varianceLiters.toLocaleString()}L (+${group.variancePercent}%)`
                              : `${group.varianceLiters.toLocaleString()}L (${group.variancePercent}%)`}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-sans text-[10px]">--</span>
                        )}
                      </td>

                      {/* Vehicle Decision Rule Outcome */}
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${decisionSummary.badgeClass}`}
                        >
                          {decisionSummary.isAllRejected ? (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-[#991B1B]" />
                              <span>REJECTED</span>
                            </>
                          ) : decisionSummary.isAllAccepted ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#166534]" />
                              <span>ACCEPTED</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3.5 h-3.5" />
                              <span>{decisionSummary.statusLabel}</span>
                            </>
                          )}
                        </span>
                      </td>

                      {/* Action: Inspect Visit (Section 4 & 5) */}
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setInspectionTarget({
                              mode: 'VISIT',
                              visitId: String(group.visitId),
                            });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#FDFBF9] hover:bg-[#F4F0E6]/60 text-[#111311] border border-[#EAE4D5]/80 font-sans text-[10px] font-extrabold transition-all duration-200 ease-in-out inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#1E3A8A]" />
                          <span>Inspect Visit</span>
                        </button>
                      </td>
                    </tr>

                    {/* Sub-Row: Portion Breakdown Table (When Expanded) */}
                    {isExpanded && (
                      <tr className="bg-[#FDFBF9]">
                        <td colSpan={10} className="p-4 pl-12 bg-[#F4F0E6]/40 border-b border-[#EAE4D5]/80">
                          <div className="space-y-2 p-3 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-inner">
                            <div className="flex items-center justify-between pb-1 border-b border-[#EAE4D5]/60">
                              <span className="text-[11px] font-extrabold font-sans text-[#1E3A8A]">
                                Portion Breakdown for {group.vehicleNumber} ({group.portions.length} Milk Portions)
                              </span>
                              <span className="text-[10px] font-semibold text-slate-500 font-sans">
                                Net Weight is measured at Vehicle Visit Weighbridge Scale
                              </span>
                            </div>

                            <table className="w-full text-left border-collapse text-[11px] font-mono">
                              <thead>
                                <tr className="bg-[#FDFBF9] text-slate-600 font-sans font-bold text-[9.5px] uppercase border-b border-[#EAE4D5]/60">
                                  <th className="py-2 px-3">Portion #</th>
                                  <th className="py-2 px-3 text-right">Dispatch Quantity</th>
                                  <th className="py-2 px-3 text-center">Plant Received Quantity</th>
                                  <th className="py-2 px-3 text-right">Fat% (Disp / Plant)</th>
                                  <th className="py-2 px-3 text-right">SNF% (Disp / Plant)</th>
                                  <th className="py-2 px-3 text-center">Plant QA Decision</th>
                                  <th className="py-2 px-3 text-left">Rejection Reason</th>
                                  <th className="py-2 px-3 text-center">Portion Status</th>
                                  <th className="py-2 px-3 text-center">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#EAE4D5]/40 font-semibold text-[#111311]">
                                {group.portions.map((portion) => {
                                  const portionIdStr = portion.portion_id ? String(portion.portion_id) : String(portion.id);
                                  const subRowKey = `history-${String(group.visitId)}-${portionIdStr}`;

                                  const portionDecision = String(portion.calculated_status || 'PENDING').toUpperCase();
                                  const isPortionPassed = portionDecision === 'ACCEPTED';
                                  const isPortionRejected = portionDecision === 'REJECTED';

                                  const dFatStr = portion.dispatch_fat != null ? `${portion.dispatch_fat}%` : '—';
                                  const lFatStr = portion.sampling_fat != null ? `${portion.sampling_fat}%` : '—';

                                  const dSnfStr = portion.computed_dispatch_snf != null ? `${portion.computed_dispatch_snf}%` : '—';
                                  const lSnfStr = portion.computed_sampling_snf != null ? `${portion.computed_sampling_snf}%` : '—';

                                  return (
                                    <tr key={subRowKey} className="hover:bg-[#F4F0E6]/60 transition">
                                      {/* Portion # */}
                                      <td className="py-2 px-3 font-black">
                                        <span className="px-2 py-0.5 rounded bg-[#FDFBF9] border border-[#EAE4D5]/80 font-mono text-[10px]">
                                          {portion.portion_number}
                                        </span>
                                      </td>

                                      {/* Dispatch Quantity */}
                                      <td className="py-2 px-3 text-right text-slate-700">
                                        {portion.dispatch_liters_gross != null ? `${portion.dispatch_liters_gross.toLocaleString()} L` : '—'}
                                      </td>

                                      {/* Plant Received Quantity (Model B Rule) */}
                                      <td className="py-2 px-3 text-center">
                                        <span className="text-[9.5px] font-sans font-extrabold text-slate-500 bg-[#FDFBF9] px-2 py-0.5 rounded border border-[#EAE4D5]">
                                          Vehicle Scale Net Weight Only
                                        </span>
                                      </td>

                                      {/* Fat % (Disp / Plant) */}
                                      <td className="py-2 px-3 text-right text-slate-700 font-mono">
                                        <span>{dFatStr} / {lFatStr}</span>
                                      </td>

                                      {/* SNF % (Disp / Plant) */}
                                      <td className="py-2 px-3 text-right text-slate-700 font-mono">
                                        <span>{dSnfStr} / {lSnfStr}</span>
                                      </td>

                                      {/* Plant QA Decision */}
                                      <td className="py-2 px-3 text-center">
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                                            isPortionRejected
                                              ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                                              : isPortionPassed
                                              ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                                              : 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]'
                                          }`}
                                        >
                                          {portionDecision}
                                        </span>
                                      </td>

                                      {/* Rejection Reason */}
                                      <td className="py-2 px-3 text-left font-sans text-[10px]">
                                        {isPortionRejected && portion.rejection_reasons ? (
                                          <span className="text-[#991B1B] font-bold">{portion.rejection_reasons}</span>
                                        ) : (
                                          <span className="text-slate-400">--</span>
                                        )}
                                      </td>

                                      {/* Status */}
                      <td className="py-2 px-3 text-center font-mono text-[10px] text-slate-700">
                                        {portion.status}
                                      </td>

                                      {/* Action: Inspect Portion (Section 4 & 7) */}
                                      <td className="py-2 px-3 text-center">
                                        <button
                                          onClick={() => {
                                            setInspectionTarget({
                                              mode: 'PORTION',
                                              visitId: String(group.visitId),
                                              portionId: portionIdStr,
                                            });
                                          }}
                                          className="px-2 py-0.5 rounded bg-[#FDFBF9] hover:bg-[#F4F0E6] text-[#1E3A8A] border border-[#EAE4D5] text-[9.5px] font-extrabold font-sans"
                                        >
                                          Inspect Portion
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* DEDICATED EXPLICIT INSPECTION MODAL OVERLAY (SECTION 3, 5, 6, 7, 8, 9, 10, 11) */}
      {inspectionTarget && targetedGroup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div
            className="bg-[#FFFFFF] rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-6 text-[#111311] shadow-2xl border border-[#EAE4D5] font-sans"
            style={{ maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}
          >
            {/* Modal Top Header Bar */}
            <div className="flex items-center justify-between border-b pb-4 border-[#EAE4D5]">
              <div className="flex items-center space-x-3">
                {inspectionTarget.mode === 'PORTION' && (
                  <button
                    onClick={() =>
                      setInspectionTarget({
                        mode: 'VISIT',
                        visitId: String(targetedGroup.visitId),
                      })
                    }
                    className="p-1.5 rounded-lg bg-[#FDFBF9] hover:bg-[#F4F0E6] text-[#1E3A8A] border border-[#EAE4D5] transition flex items-center gap-1 text-xs font-extrabold"
                    title="Back to Vehicle Visit"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Visit</span>
                  </button>
                )}

                <div className="p-2.5 rounded-xl bg-[#1E3A8A] text-white">
                  <Truck className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-black text-[#111311]">
                      {inspectionTarget.mode === 'VISIT'
                        ? `Vehicle Visit Inspection — ${targetedGroup.vehicleNumber}`
                        : `Portion Inspection — ${targetedGroup.vehicleNumber} / Portion ${targetedPortion?.portion_number || 'P-01'}`}
                    </h2>
                    {inspectionTarget.mode === 'PORTION' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#1E3A8A] text-white">
                        PORTION P-0{targetedPortion?.portion_number || 1}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#334155]">
                    Visit VV-{targetedGroup.visitId} • {targetedGroup.portions.length} Portions • {targetedGroup.zonalContractorName} ({targetZone})
                  </p>
                </div>
              </div>

              <button
                onClick={() => setInspectionTarget(null)}
                className="p-1.5 rounded-lg bg-[#FDFBF9] hover:bg-[#F4F0E6] text-slate-600 border border-[#EAE4D5] transition"
                title="Close modal (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* MODE 1: INSPECT VISIT MODE (SECTION 5) */}
            {inspectionTarget.mode === 'VISIT' && (
              <div className="space-y-6">
                {/* A. Identity Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] text-xs font-mono">
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Vehicle Number:</span>
                    <span className="text-sm font-black text-[#111311]">{targetedGroup.vehicleNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Visit Number:</span>
                    <span className="font-bold text-[#111311]">VV-{targetedGroup.visitId}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Dispatch Date:</span>
                    <span className="font-bold text-[#111311]">{targetedGroup.dispatchDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Token Number:</span>
                    <span className="font-bold text-[#1E3A8A]">{targetedGroup.tokenNumber || 'PENDING'}</span>
                  </div>
                </div>

                {/* B. Security & Gate Information */}
                <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-2 text-xs font-mono">
                  <div className="flex items-center space-x-2 font-sans font-extrabold text-xs text-[#1E3A8A]">
                    <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
                    <span>Security & Gate Entry Status</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-bold text-slate-700">
                    <div>
                      <span className="text-[9.5px] uppercase text-slate-400 block font-sans">Gate Entry:</span>
                      <span>{targetedGroup.portions[0]?.igp_date || 'N/A'} {targetedGroup.portions[0]?.igp_time || ''}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase text-slate-400 block font-sans">Gate Exit:</span>
                      <span>{targetedGroup.portions[0]?.out_from_gate_time || 'In Plant'}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase text-slate-400 block font-sans">Token Issued:</span>
                      <span className="text-[#1E3A8A] font-black">{targetedGroup.tokenNumber || 'Issued at Gate 2'}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase text-slate-400 block font-sans">Operational Status:</span>
                      <span className="text-black font-black uppercase">{targetedGroup.overallStatus}</span>
                    </div>
                  </div>
                </div>

                {/* C. Vehicle-Level Weighbridge (Shown ONCE at Vehicle Level) */}
                <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-xs font-mono flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5">
                    <Scale className="w-5 h-5 text-[#1E40AF]" />
                    <div>
                      <h4 className="text-xs font-black text-[#1E40AF] font-sans">Vehicle Weighbridge Scale Summary</h4>
                      <p className="text-[10.5px] font-semibold text-[#1E40AF]/80 font-sans">
                        Measured at Weighbridge Scale 1 (Gross) & Scale 2 (Second Weight) for vehicle.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6">
                    <div>
                      <span className="text-[9.5px] uppercase font-bold text-slate-500 block">Gross Weight:</span>
                      <span className="font-black text-[#111311]">
                        {targetedGroup.grossWeightKg != null ? `${targetedGroup.grossWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase font-bold text-slate-500 block">Second Weight:</span>
                      <span className="font-black text-[#111311]">
                        {targetedGroup.tareWeightKg != null ? `${targetedGroup.tareWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase font-bold text-[#1E40AF] block">Net Milk Received:</span>
                      <span className="font-black text-[#1E40AF] text-sm">
                        {targetedGroup.netWeightKg != null ? `${targetedGroup.netWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* D. Visit Quantity & Decision Summary */}
                <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-3">
                  <div className="flex items-center justify-between border-b pb-2 border-[#EAE4D5]">
                    <h3 className="text-xs font-extrabold font-sans text-[#111311]">
                      Visit Quantity & QA Decision Summary
                    </h3>
                    <span className="text-xs font-mono font-bold">
                      Vehicle Decision: {computeVehicleDecisionSummary(targetedGroup.portions, targetedGroup.overallStatus).statusLabel}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block font-sans uppercase">Total Zonal Dispatch:</span>
                      <span className="font-black text-[#111311]">{targetedGroup.totalZonalDispatchLiters.toLocaleString()} L</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block font-sans uppercase">Plant Received:</span>
                      <span className="font-black text-[#1E3A8A]">
                        {targetedGroup.plantReceivedLiters != null ? `${targetedGroup.plantReceivedLiters.toLocaleString()} L` : 'Pending Scale 2'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block font-sans uppercase">Volume Difference:</span>
                      <span className={`font-black ${targetedGroup.varianceLiters != null && targetedGroup.varianceLiters >= 0 ? 'text-emerald-700' : 'text-[#991B1B]'}`}>
                        {targetedGroup.varianceLiters != null
                          ? targetedGroup.varianceLiters >= 0
                            ? `+${targetedGroup.varianceLiters} L (+${targetedGroup.variancePercent}%)`
                            : `${targetedGroup.varianceLiters} L (${targetedGroup.variancePercent}%)`
                          : '--'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block font-sans uppercase">Portion Decisions:</span>
                      <span className="font-extrabold text-[#111311]">
                        {computeVehicleDecisionSummary(targetedGroup.portions, targetedGroup.overallStatus).statusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* F. Portion Overview Section with Inspect Portion Actions */}
                <div className="space-y-3">
                  <h3 className="text-xs font-extrabold font-sans text-[#111311] border-b pb-2 border-[#EAE4D5]">
                    Portion Overview ({targetedGroup.portions.length} Portions) — Select a portion to inspect details
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {targetedGroup.portions.map((p) => {
                      const portionIdStr = p.portion_id ? String(p.portion_id) : String(p.id);
                      const portionCardKey = `visit-inspection-${String(targetedGroup.visitId)}-${portionIdStr}`;
                      const pDec = String(p.calculated_status || 'PENDING').toUpperCase();

                      return (
                        <div
                          key={portionCardKey}
                          className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-3 flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between">
                            <span className="px-2.5 py-1 rounded bg-[#1E3A8A] text-white font-mono text-xs font-black">
                              Portion P-0{p.portion_number}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase ${
                                pDec === 'REJECTED'
                                  ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                                  : pDec === 'ACCEPTED'
                                  ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                                  : 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]'
                              }`}
                            >
                              {pDec}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                            <div>
                              <span className="text-[9.5px] text-slate-500 font-sans block">Dispatch Liters:</span>
                              <span className="font-bold text-[#111311]">{p.dispatch_liters_gross != null ? `${p.dispatch_liters_gross.toLocaleString()} L` : '—'}</span>
                            </div>
                            <div>
                              <span className="text-[9.5px] text-slate-500 font-sans block">Plant Receipt:</span>
                              <span className="font-extrabold text-slate-500 text-[10px]">Available at vehicle level</span>
                            </div>
                            <div>
                              <span className="text-[9.5px] text-slate-500 font-sans block">Fat / LR:</span>
                              <span className="font-bold text-[#111311]">{p.dispatch_fat != null ? `${p.dispatch_fat}%` : '—'} / {p.dispatch_lr != null ? `${p.dispatch_lr}` : '—'}</span>
                            </div>
                            <div>
                              <span className="text-[9.5px] text-slate-500 font-sans block">SNF %:</span>
                              <span className="font-bold text-[#111311]">{p.computed_dispatch_snf != null ? `${p.computed_dispatch_snf}%` : '—'}</span>
                            </div>
                          </div>

                          {pDec === 'REJECTED' && p.rejection_reasons && (
                            <p className="text-[10.5px] text-[#991B1B] font-sans font-bold bg-[#FEF2F2] p-2 rounded border border-[#FECACA]">
                              Rejection Reason: {p.rejection_reasons}
                            </p>
                          )}

                          <button
                            onClick={() =>
                              setInspectionTarget({
                                mode: 'PORTION',
                                visitId: String(targetedGroup.visitId),
                                portionId: portionIdStr,
                              })
                            }
                            className="w-full py-2 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white font-sans text-xs font-extrabold transition flex items-center justify-center space-x-1.5 shadow-sm"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect Portion P-0{p.portion_number} Details</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* MODE 2: INSPECT PORTION MODE (SECTION 7 & 8) */}
            {inspectionTarget.mode === 'PORTION' && targetedPortion && (
              <div className="space-y-6">
                {/* A. Portion Identity Block */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] text-xs font-mono">
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Portion Number:</span>
                    <span className="text-sm font-black text-[#1E3A8A]">Portion P-0{targetedPortion.portion_number}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Vehicle Number:</span>
                    <span className="font-bold text-[#111311]">{targetedGroup.vehicleNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Dispatch Date:</span>
                    <span className="font-bold text-[#111311]">{targetedGroup.dispatchDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Portion QA Decision:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                        String(targetedPortion.calculated_status).toUpperCase() === 'REJECTED'
                          ? 'bg-[#FEF2F2] text-[#991B1B]'
                          : 'bg-[#F0FDF4] text-[#166534]'
                      }`}
                    >
                      {String(targetedPortion.calculated_status || 'PENDING').toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* B. Dispatch vs Plant Details for this Portion */}
                <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-3">
                  <h3 className="text-xs font-extrabold font-sans text-[#111311] border-b pb-2 border-[#EAE4D5]">
                    Portion P-0{targetedPortion.portion_number} Dispatch vs Plant Parameters
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                        Dispatch Quantity
                      </span>
                      <p className="text-sm font-black text-[#111311]">
                        {(targetedPortion.dispatch_liters_gross || 0).toLocaleString()} L
                      </p>
                      <span className="text-[9.5px] font-semibold text-slate-500 block">
                        13% TS Eq: {targetedPortion.computed_dispatch_13ts_liters || 0} L
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                        Plant Receipt Quantity
                      </span>
                      <p className="text-xs font-extrabold text-slate-500 italic py-1">
                        Available at vehicle level only
                      </p>
                      <span className="text-[9.5px] font-semibold text-slate-400 block">
                        (See Shared Weighbridge Summary below)
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                        Portion QA Decision
                      </span>
                      <p
                        className={`text-sm font-black uppercase ${
                          String(targetedPortion.calculated_status).toUpperCase() === 'REJECTED'
                            ? 'text-[#991B1B]'
                            : 'text-emerald-700'
                        }`}
                      >
                        {String(targetedPortion.calculated_status || 'PENDING').toUpperCase()}
                      </p>
                      {targetedPortion.rejection_reasons && (
                        <span className="text-[9.5px] text-[#991B1B] font-sans font-bold block">
                          Reason: {targetedPortion.rejection_reasons}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* D. Dynamic Side-by-Side Test Comparison for this Portion (Section 7D) */}
                <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-3">
                  <div className="flex items-center justify-between border-b pb-2 border-[#EAE4D5]">
                    <h3 className="text-xs font-extrabold font-sans text-[#111311]">
                      Side-by-Side Lab Test Comparison for Portion P-0{targetedPortion.portion_number}
                    </h3>
                    <span className="text-[10px] text-slate-500 font-sans">
                      Authoritative test parameters
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-[#EAE4D5]">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="bg-[#FDFBF9] text-slate-600 font-sans font-bold text-[9.5px] uppercase border-b border-[#EAE4D5]">
                          <th className="py-2 px-3">Test Name</th>
                          <th className="py-2 px-3 text-center">Scope</th>
                          <th className="py-2 px-3 text-right">Dispatch Value</th>
                          <th className="py-2 px-3 text-right">Plant Value</th>
                          <th className="py-2 px-3 text-right">Difference</th>
                          <th className="py-2 px-3 text-center">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE4D5]/60 font-semibold text-[#111311]">
                        {buildPortionDynamicTests(targetedPortion).map((t) => {
                          const testRowKey = `history-portion-test-${String(targetedGroup.visitId)}-${String(targetedPortion.portion_id || targetedPortion.id)}-${t.testId}`;
                          return (
                            <tr key={testRowKey} className="hover:bg-[#F4F0E6]/40 transition">
                              <td className="py-2 px-3 font-bold font-sans text-[#111311]">{t.testName}</td>
                              <td className="py-2 px-3 text-center">
                                <span className="px-2 py-0.5 rounded text-[9px] font-extrabold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                                  {t.testScope}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right text-slate-700">
                                {t.dispatchResult.status === 'AVAILABLE' ? (
                                  <span>{t.dispatchResult.value}</span>
                                ) : t.dispatchResult.status === 'NOT_APPLICABLE' ? (
                                  <span className="text-slate-400 italic">Not Applicable</span>
                                ) : (
                                  <span className="text-amber-700">Pending</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right text-[#1E3A8A] font-black">
                                {t.plantResult.status === 'AVAILABLE' ? (
                                  <span>{t.plantResult.value}</span>
                                ) : t.plantResult.status === 'NOT_APPLICABLE' ? (
                                  <span className="text-slate-400 italic">Not Applicable</span>
                                ) : (
                                  <span className="text-amber-700">Pending</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-black">
                                <span
                                  className={
                                    t.difference.numericValue != null && t.difference.numericValue >= 0
                                      ? 'text-emerald-700'
                                      : t.difference.numericValue != null
                                      ? 'text-[#991B1B]'
                                      : 'text-slate-400'
                                  }
                                >
                                  {t.difference.displayText}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center text-slate-500 text-[10px]">{t.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* H. Shared Vehicle-Visit Information Section (Section 8) */}
                <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] space-y-2 text-xs font-mono">
                  <div className="flex items-center space-x-2 font-sans font-extrabold text-xs text-[#1E40AF]">
                    <Scale className="w-4 h-4 text-[#1E40AF]" />
                    <span>Shared Vehicle-Visit Information (Measured for Full Vehicle)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-700 font-bold">
                    <div>
                      <span className="text-[9.5px] text-slate-500 block font-sans">Net Milk Received:</span>
                      <span className="font-black text-[#1E40AF]">
                        {targetedGroup.netWeightKg != null ? `${targetedGroup.netWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block font-sans">Gross Weight:</span>
                      <span className="font-black text-[#111311]">
                        {targetedGroup.grossWeightKg != null ? `${targetedGroup.grossWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block font-sans">Second Weight:</span>
                      <span className="font-black text-[#111311]">
                        {targetedGroup.tareWeightKg != null ? `${targetedGroup.tareWeightKg.toLocaleString()} kg` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block font-sans">Security Token:</span>
                      <span className="font-black text-[#1E3A8A]">{targetedGroup.tokenNumber || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
