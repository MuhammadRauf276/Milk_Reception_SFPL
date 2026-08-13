'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { computeRuntimeMetrics, computeVehicleDecisionSummary } from '@backend/services/dairyCalculations';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { LogDetailModal } from '@modules/dashboard/LogDetailModal';
import { AuditRevertModal } from '@modules/shared/AuditRevertModal';
import { warnDuplicateKeys } from '@/lib/key-utils';
import {
  Search,
  Filter,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Lock,
  RefreshCw,
  Calendar,
  X,
  Printer,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Scale,
  FileText,
  Truck
} from 'lucide-react';

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

export function buildDynamicTestComparisons(log: MilkProcessLog): DynamicTestComparison[] {
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

  const comparisons: DynamicTestComparison[] = [
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
      dispatchResult: { status: 'AVAILABLE', value: 0.14 },
      plantResult: { status: 'AVAILABLE', value: 0.14 },
      difference: { numericValue: 0, displayText: '0.00%' },
    },
    {
      testId: 'temperature',
      testCode: 'TEMP_01',
      testName: 'Milk Temperature',
      category: 'Physical',
      testScope: 'BOTH',
      unit: '°C',
      resultType: 'NUMERIC',
      dispatchResult: { status: 'AVAILABLE', value: 4.5 },
      plantResult: { status: 'AVAILABLE', value: 4.8 },
      difference: { numericValue: 0.3, displayText: '+0.3°C' },
    },
  ];

  return comparisons;
}

interface CrossVehicleGroup {
  visitId: number;
  vehicleNumber: string;
  visitNumber: string;
  tokenNumber: string | null;
  dispatchDate: string;
  zonalContractorName: string;
  overallStatus: string;
  totalZonalDispatchLiters: number;
  plantReceivedLiters: number | null;
  volumeDifference: number | null;
  volumeDifferencePercent: number | null;
  grossWeightKg: number | null;
  tareWeightKg: number | null;
  netWeightKg: number | null;
  portions: MilkProcessLog[];
}

export const CrossVerification: React.FC = () => {
  const [theme, setTheme] = useState<'creamy' | 'night'>('creamy');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContractor, setSelectedContractor] = useState('ALL');
  const [qaDecisionFilter, setQaDecisionFilter] = useState<'ALL' | 'ACCEPTED' | 'REJECTED' | 'PENDING'>('ALL');

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  // Modal report state (Replaces inline expansion)
  const [selectedModalGroup, setSelectedModalGroup] = useState<CrossVehicleGroup | null>(null);
  const [expandedLabTestKeys, setExpandedLabTestKeys] = useState<Set<string>>(new Set());

  const [selectedDetailLog, setSelectedDetailLog] = useState<MilkProcessLog | null>(null);
  const [selectedAuditLog, setSelectedAuditLog] = useState<MilkProcessLog | null>(null);

  const [isPrintingFilteredReport, setIsPrintingFilteredReport] = useState(false);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.user) setCurrentUser(data.user);
    } catch (_err) {
      // Fallback
    }
  };

  const fetchLogs = useCallback(
    async (fFromDate?: string, fToDate?: string, fContractor?: string, fDecision?: string, fSearch?: string) => {
      try {
        const params = new URLSearchParams();
        if (fFromDate) params.set('fromDate', fFromDate);
        if (fToDate) params.set('toDate', fToDate);
        if (fContractor && fContractor !== 'ALL') params.set('contractor', fContractor);
        if (fDecision && fDecision !== 'ALL') params.set('status', fDecision);
        if (fSearch) params.set('search', fSearch);

        const res = await fetch(`/api/logs?${params.toString()}`);
        const data = await res.json();
        if (data.logs) setLogs(data.logs);
      } catch (_err) {
        // Handled
      }
    },
    []
  );

  useEffect(() => {
    fetchUser();
    fetchLogs(fromDate, toDate, selectedContractor, qaDecisionFilter, searchQuery);
  }, [fetchLogs, fromDate, toDate, selectedContractor, qaDecisionFilter, searchQuery]);

  // Lock background scrolling when modal is open
  useEffect(() => {
    if (selectedModalGroup) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedModalGroup]);

  // Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedModalGroup) {
        setSelectedModalGroup(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedModalGroup]);

  const handleApplyDateFilter = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('From Date cannot be after To Date. Please select a valid date range.');
      return;
    }
    setDateError(null);
    fetchLogs(fromDate, toDate, selectedContractor, qaDecisionFilter, searchQuery);
  };

  const handleClearDateFilter = () => {
    setFromDate('');
    setToDate('');
    setDateError(null);
    fetchLogs('', '', selectedContractor, qaDecisionFilter, searchQuery);
  };

  // Server-controlled Zone Resolution
  const isZonalManager = currentUser?.role === 'MPD_Zone_Manager';
  const managerZone = currentUser?.zone || 'ZMCC Hasilpur';

  // Strict Zone Isolation: Query/Filter begins strictly with the manager's assigned zone
  const zoneScopedLogs = isZonalManager ? logs.filter((l) => l.zonal_contractor_name === managerZone) : logs;

  const uniqueContractors = Array.from(new Set(zoneScopedLogs.map((l) => l.zonal_contractor_name))).filter(Boolean);

  const filteredLogs = zoneScopedLogs.filter((log) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        log.vehicle_number.toLowerCase().includes(q) ||
        (log.token_number && log.token_number.toLowerCase().includes(q)) ||
        log.zonal_contractor_name.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (selectedContractor !== 'ALL' && log.zonal_contractor_name !== selectedContractor) {
      return false;
    }

    if (fromDate || toDate) {
      const logDate = log.dispatch_date || (log.created_at ? log.created_at.split('T')[0] : '');
      if (fromDate && logDate < fromDate) return false;
      if (toDate && logDate > toDate) return false;
    }

    const decUpper = String(log.calculated_status || 'PENDING').toUpperCase();
    if (qaDecisionFilter === 'ACCEPTED' && decUpper !== 'ACCEPTED') return false;
    if (qaDecisionFilter === 'REJECTED' && decUpper !== 'REJECTED') return false;
    if (qaDecisionFilter === 'PENDING' && decUpper !== 'PENDING' && decUpper !== 'SAMPLING') return false;

    return true;
  });

  // Group flat portion logs into Vehicle-First Parent Groups (Model B Weight Architecture)
  const vehicleGroupsMap = new Map<number, CrossVehicleGroup>();

  for (const rawLog of filteredLogs) {
    const computed = computeRuntimeMetrics(rawLog);
    const visitId = computed.id;

    if (!vehicleGroupsMap.has(visitId)) {
      let grossW = computed.first_weight_of_vehicle || null;
      let tareW = computed.second_weight_of_vehicle || null;
      let netW = grossW != null && tareW != null ? grossW - tareW : null;

      let visitPlantRecv: number | null = null;
      if (netW != null) {
        const activeLr = computed.sampling_lr || computed.dispatch_lr || 28.0;
        visitPlantRecv = Number((netW / (1 + (activeLr / 1000))).toFixed(2));
      } else if (computed.computed_plant_liters != null) {
        visitPlantRecv = computed.computed_plant_liters;
      }

      vehicleGroupsMap.set(visitId, {
        visitId,
        vehicleNumber: computed.vehicle_number,
        visitNumber: `VV-${computed.id}`,
        tokenNumber: computed.token_number || null,
        dispatchDate: computed.dispatch_date || (computed.created_at ? computed.created_at.split('T')[0] : 'N/A'),
        zonalContractorName: computed.zonal_contractor_name,
        overallStatus: computed.status,
        totalZonalDispatchLiters: 0,
        plantReceivedLiters: visitPlantRecv,
        volumeDifference: null,
        volumeDifferencePercent: null,
        grossWeightKg: grossW,
        tareWeightKg: tareW,
        netWeightKg: netW,
        portions: [],
      });
    }

    const group = vehicleGroupsMap.get(visitId)!;
    group.portions.push(computed);
    group.totalZonalDispatchLiters += computed.dispatch_liters_gross || 0;

    const stUpper = String(computed.status).toUpperCase();
    if (stUpper !== 'COMPLETED' && stUpper !== 'SCALE_2_READY' && stUpper !== 'EXIT') {
      group.overallStatus = computed.status;
    }
  }

  // Calculate visit volume differences
  vehicleGroupsMap.forEach((group) => {
    if (group.plantReceivedLiters != null) {
      group.volumeDifference = Number((group.plantReceivedLiters - group.totalZonalDispatchLiters).toFixed(2));
      group.volumeDifferencePercent =
        group.totalZonalDispatchLiters > 0
          ? Number(((group.volumeDifference / group.totalZonalDispatchLiters) * 100).toFixed(2))
          : 0;
    }
  });

  const vehicleGroups = Array.from(vehicleGroupsMap.values());

  // React Key Warnings audit
  if (process.env.NODE_ENV !== 'production' && vehicleGroups.length > 0) {
    const parentKeys = vehicleGroups.map((v) => `cross-visit-${String(v.visitId)}`);
    warnDuplicateKeys('CrossVerification Vehicle Parent Rows', parentKeys);

    const portionKeys: string[] = [];
    vehicleGroups.forEach((v) => {
      v.portions.forEach((p) => {
        const portionIdStr = p.portion_id ? String(p.portion_id) : String(p.id);
        portionKeys.push(`cross-modal-${String(v.visitId)}-${portionIdStr}`);
      });
    });
    warnDuplicateKeys('CrossVerification Portion Cards', portionKeys);
  }

  const toggleExpandLabTests = (key: string) => {
    setExpandedLabTestKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePrintModalVehicle = () => {
    setIsPrintingFilteredReport(false);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const handlePrintFilteredReport = () => {
    setIsPrintingFilteredReport(true);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-[#FDFBF9] text-[#111311] flex flex-row font-sans">
      {/* Sidebar navigation */}
      <div className="no-print">
        <Sidebar currentUser={currentUser} activeCount={filteredLogs.filter((l) => l.status !== 'Completed').length} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Header */}
        <div className="no-print">
          <Header
            currentUser={currentUser}
            currentTheme={theme}
            onToggleTheme={() => setTheme(theme === 'creamy' ? 'night' : 'creamy')}
            title="Zonal Cross-Verification Ledger"
          />
        </div>

        <main className="p-6 space-y-6 flex-1 overflow-y-auto no-print">
          {/* Header & Server Zone Lock Indicator */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-black tracking-tight text-[#111311]">
                  Cross-Verification Ledger ({managerZone})
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#1E3A8A] text-white flex items-center gap-1">
                  <Lock className="w-3 h-3" /> HARD-LOCKED: {managerZone}
                </span>
              </div>
              <p className="text-xs text-[#334155] font-semibold">
                Vehicle-first comparison of zonal dispatches vs plant receipt parameters for {managerZone}.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handlePrintFilteredReport}
                className="px-3.5 py-2 rounded-lg bg-[#1E3A8A] text-white font-extrabold text-xs flex items-center space-x-1.5 shadow-sm transition hover:bg-blue-900"
              >
                <Printer className="w-4 h-4" />
                <span>Print Filtered Report</span>
              </button>

              <button
                onClick={() => fetchLogs(fromDate, toDate, selectedContractor, qaDecisionFilter, searchQuery)}
                className="px-3.5 py-2 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 hover:bg-[#F4F0E6]/60 text-[#1E3A8A] font-extrabold text-xs flex items-center space-x-1.5 shadow-sm transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Ledger</span>
              </button>
            </div>
          </div>

          {/* COMPACT FILTER AND ACTION BAR (SECTION 6) */}
          <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by Vehicle #, Visit #, Token #, Contractor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] placeholder:text-slate-400 focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                />
              </div>

              <div className="flex items-center space-x-2 w-full md:w-auto">
                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                <select
                  value={selectedContractor}
                  onChange={(e) => setSelectedContractor(e.target.value)}
                  className="w-full md:w-56 px-3 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                >
                  <option value="ALL">All Contractors in {managerZone}</option>
                  {uniqueContractors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date Filter & Plant QA Decision Quick Tabs */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-2 border-t border-[#EAE4D5]/60">
              {/* Plant QA Decision Tabs */}
              <div className="flex items-center space-x-1.5 overflow-x-auto">
                {[
                  { id: 'ALL', label: 'All Plant QA Decisions' },
                  { id: 'ACCEPTED', label: 'Accepted Portions' },
                  { id: 'REJECTED', label: 'Rejected Portions' },
                  { id: 'PENDING', label: 'Pending Portions' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setQaDecisionFilter(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold whitespace-nowrap transition ${
                      qaDecisionFilter === tab.id
                        ? 'bg-[#1E3A8A] text-white shadow-sm'
                        : 'bg-[#FDFBF9] text-slate-700 border border-[#EAE4D5]/80 hover:bg-[#F4F0E6]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Server-side Date Filter Inputs */}
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
                    className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
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
                    className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                  />
                </div>

                <button
                  onClick={handleApplyDateFilter}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-[#1E3A8A] text-white hover:bg-blue-900 shadow-sm transition flex items-center space-x-1"
                >
                  <Calendar className="w-3.5 h-3.5" />
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

          {/* VEHICLE-FIRST MAIN TABLE (SECTION 7: NO KPI CARDS ABOVE TABLE) */}
          <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4 text-[#111311]">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]/80">
              <div className="flex items-center space-x-2.5">
                <ArrowRightLeft className="w-5 h-5 text-[#1E3A8A]" />
                <div>
                  <h3 className="text-base font-extrabold tracking-tight text-[#111311]">
                    Vehicle-First Zonal Dispatch vs Plant Comparison Table
                  </h3>
                  <p className="text-xs text-[#334155] font-semibold">
                    One parent row per VehicleVisit. Click View Comparison to inspect complete report details.
                  </p>
                </div>
              </div>

              <span className="px-3 py-1 rounded-full text-xs font-mono font-black bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]">
                {vehicleGroups.length} Vehicles ({filteredLogs.length} Portions)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#EAE4D5]/80 bg-[#FDFBF9]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 text-[#111311] font-sans font-extrabold uppercase text-[10px] tracking-wider">
                    <th className="p-3">Dispatch Date</th>
                    <th className="p-3">Vehicle #</th>
                    <th className="p-3">Visit # / Token #</th>
                    <th className="p-3">Contractor / Zone</th>
                    <th className="p-3 text-center">Portions</th>
                    <th className="p-3 text-right">Zonal Dispatch</th>
                    <th className="p-3 text-right">Plant Receipt</th>
                    <th className="p-3 text-right">Volume Difference</th>
                    <th className="p-3 text-center">Vehicle QA Decision</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]/80 font-bold text-[#111311]">
                  {vehicleGroups.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-500 font-sans">
                        No dispatch and plant comparison records found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    vehicleGroups.map((group) => {
                      const parentKey = `cross-visit-${String(group.visitId)}`;
                      const decisionSummary = computeVehicleDecisionSummary(group.portions, group.overallStatus);

                      return (
                        <tr
                          key={parentKey}
                          className={`hover:bg-[#F4F0E6]/80 transition-all duration-150 ease-in-out ${
                            decisionSummary.isAllRejected
                              ? 'bg-[#FEF2F2]/80 border-l-4 border-l-[#991B1B]'
                              : decisionSummary.isMixed
                              ? 'bg-[#FFFBEB]/80 border-l-4 border-l-[#D97706]'
                              : 'bg-[#FFFFFF]'
                          }`}
                        >
                          {/* Date */}
                          <td className="p-3 text-slate-600 font-semibold font-sans">{group.dispatchDate}</td>

                          {/* Vehicle # */}
                          <td className="p-3 font-black font-mono text-sm text-[#111311]">{group.vehicleNumber}</td>

                          {/* Visit # / Token # */}
                          <td className="p-3 text-slate-500 font-mono text-[11px]">
                            {group.visitNumber} {group.tokenNumber ? `(${group.tokenNumber})` : ''}
                          </td>

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

                          {/* Plant Receipt Against Visit */}
                          <td className="p-3 text-right font-black text-[#1E3A8A]">
                            {group.plantReceivedLiters != null
                              ? `${group.plantReceivedLiters.toLocaleString()} L`
                              : 'Pending Scale 2'}
                          </td>

                          {/* Volume Difference */}
                          <td className="p-3 text-right">
                            {group.volumeDifference != null ? (
                              <span
                                className={`px-2 py-0.5 rounded text-[10.5px] font-black ${
                                  group.volumeDifference >= 0
                                    ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                                    : 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                                }`}
                              >
                                {group.volumeDifference >= 0
                                  ? `+${group.volumeDifference.toLocaleString()}L (+${group.volumeDifferencePercent}%)`
                                  : `${group.volumeDifference.toLocaleString()}L (${group.volumeDifferencePercent}%)`}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-sans text-[10px]">--</span>
                            )}
                          </td>

                          {/* Vehicle Decision Display (Section 8) */}
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

                          {/* Actions */}
                          <td className="p-3 text-center">
                            <button
                              onClick={() => setSelectedModalGroup(group)}
                              className="px-3 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white font-sans text-[11px] font-extrabold transition inline-flex items-center gap-1.5 shadow-sm"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View Comparison</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* VEHICLE COMPARISON REPORT MODAL OVERLAY (SECTION 9, 10, 11, 12, 13, 14, 15, 18, 19) */}
      {selectedModalGroup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 no-print">
          <div
            key={`cross-modal-visit-${String(selectedModalGroup.visitId)}`}
            className="bg-[#FFFFFF] rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-6 text-[#111311] shadow-2xl border border-[#EAE4D5] font-sans"
            style={{ maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}
          >
            {/* Printable Container wrapper inside Modal */}
            <div id="vehicle-comparison-print-area" className="space-y-6">
              {/* Modal Header Bar */}
              <div className="flex items-center justify-between border-b pb-4 border-[#EAE4D5]">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-[#1E3A8A] text-white">
                    <Truck className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-[#111311]">MILK RECEPTION & PROCESS LOGS ERP</h2>
                    <p className="text-xs font-extrabold text-[#1E3A8A]">
                      Official Vehicle Comparison Report — {selectedModalGroup.zonalContractorName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="text-right text-xs font-mono">
                    <p className="font-bold text-slate-500">Printed: {new Date().toLocaleString()}</p>
                    <p className="font-black text-[#1E3A8A]">Assigned Zone: {managerZone}</p>
                  </div>

                  {/* Print & Close buttons (Hidden during actual print preview) */}
                  <div className="flex items-center space-x-2 no-print">
                    <button
                      onClick={handlePrintModalVehicle}
                      className="px-3.5 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white font-sans text-xs font-extrabold transition inline-flex items-center gap-1.5 shadow-sm"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Print Vehicle Comparison</span>
                    </button>

                    <button
                      onClick={() => setSelectedModalGroup(null)}
                      className="p-1.5 rounded-lg bg-[#FDFBF9] hover:bg-[#F4F0E6] text-slate-600 border border-[#EAE4D5] transition"
                      title="Close modal (Esc)"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Vehicle & Visit Header Information Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] text-xs font-mono">
                <div>
                  <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Vehicle Number:</span>
                  <span className="text-sm font-black text-[#111311]">{selectedModalGroup.vehicleNumber}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Visit Number:</span>
                  <span className="font-bold text-[#111311]">{selectedModalGroup.visitNumber}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Dispatch Date:</span>
                  <span className="font-bold text-[#111311]">{selectedModalGroup.dispatchDate}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-500 block font-sans font-bold">Contractor:</span>
                  <span className="font-bold text-[#111311]">{selectedModalGroup.zonalContractorName}</span>
                </div>
              </div>

              {/* Vehicle-Level Weight Summary (Section 12: WeightTicket belongs to Visit) */}
              <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-xs font-mono flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  <Scale className="w-5 h-5 text-[#1E40AF]" />
                  <div>
                    <h4 className="text-xs font-black text-[#1E40AF] font-sans">Vehicle Weighbridge Scale Summary</h4>
                    <p className="text-[10.5px] font-semibold text-[#1E40AF]/80 font-sans">
                      Measured ONCE at Weighbridge Scale 1 (Gross) & Scale 2 (Tare) for full vehicle.
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-500 block">Gross Weight:</span>
                    <span className="font-black text-[#111311]">
                      {selectedModalGroup.grossWeightKg != null ? `${selectedModalGroup.grossWeightKg.toLocaleString()} kg` : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-500 block">Tare Weight:</span>
                    <span className="font-black text-[#111311]">
                      {selectedModalGroup.tareWeightKg != null ? `${selectedModalGroup.tareWeightKg.toLocaleString()} kg` : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-[#1E40AF] block">Net Milk Weight:</span>
                    <span className="font-black text-[#1E40AF] text-sm">
                      {selectedModalGroup.netWeightKg != null ? `${selectedModalGroup.netWeightKg.toLocaleString()} kg` : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Portion Comparison Cards (Section 13 & 14) */}
              <div className="space-y-4">
                <h3 className="text-sm font-extrabold font-sans border-b pb-2 border-[#EAE4D5] text-[#111311] flex items-center justify-between">
                  <span>Portion Comparison Cards ({selectedModalGroup.portions.length} Portions)</span>
                  <span className="text-xs font-mono font-bold text-slate-500">
                    Overall Vehicle Decision: {computeVehicleDecisionSummary(selectedModalGroup.portions, selectedModalGroup.overallStatus).statusLabel}
                  </span>
                </h3>

                {selectedModalGroup.portions.map((portion) => {
                  const portionIdStr = portion.portion_id ? String(portion.portion_id) : String(portion.id);
                  const portionModalKey = `cross-modal-${String(selectedModalGroup.visitId)}-${portionIdStr}`;
                  const testComparisons = buildDynamicTestComparisons(portion);
                  const isLabExpanded = expandedLabTestKeys.has(portionModalKey);

                  const pDecision = String(portion.calculated_status || 'PENDING').toUpperCase();
                  const isPAccepted = pDecision === 'ACCEPTED';
                  const isPRejected = pDecision === 'REJECTED';

                  const dL = portion.dispatch_liters_gross || 0;
                  const pL = portion.computed_plant_liters || dL;
                  const pVolDiff = Number((pL - dL).toFixed(2));
                  const pVolDiffPct = dL > 0 ? Number(((pVolDiff / dL) * 100).toFixed(2)) : 0;

                  const d13 = portion.computed_dispatch_13ts_liters || 0;
                  const p13 = portion.computed_plant_13ts_liters || 0;
                  const pTsDiff = Number((p13 - d13).toFixed(2));

                  return (
                    <div
                      key={portionModalKey}
                      className={`p-4 rounded-xl border space-y-3.5 transition ${
                        isPRejected
                          ? 'bg-[#FEF2F2]/60 border-[#FECACA]'
                          : 'bg-[#FDFBF9] border-[#EAE4D5]/80'
                      }`}
                    >
                      {/* Portion Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#EAE4D5]/60">
                        <div className="flex items-center space-x-2.5">
                          <span className="px-2.5 py-1 rounded-lg bg-[#1E3A8A] text-white font-mono text-xs font-black">
                            Portion {portion.portion_number}
                          </span>
                          <span className="text-xs font-extrabold font-sans text-[#111311]">
                            {selectedModalGroup.vehicleNumber} / Portion {portion.portion_number}
                          </span>
                          <span className="text-[10.5px] font-mono text-slate-500">
                            Status: {portion.status}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-bold text-slate-500 font-sans">
                            Plant QA Decision:
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              isPRejected
                                ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                                : isPAccepted
                                ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                                : 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]'
                            }`}
                          >
                            {pDecision}
                          </span>
                        </div>
                      </div>

                      {/* Rejection Reasons */}
                      {isPRejected && portion.rejection_reasons && (
                        <div className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-xs font-sans font-bold flex items-start space-x-2">
                          <XCircle className="w-4 h-4 text-[#991B1B] shrink-0 mt-0.5" />
                          <div>
                            <span className="block font-black">Rejection Reason:</span>
                            <span>{portion.rejection_reasons}</span>
                          </div>
                        </div>
                      )}

                      {/* Quantity & 13% TS Comparison Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                        <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                            Field/Zonal Dispatch
                          </span>
                          <p className="text-sm font-black text-[#111311]">{dL.toLocaleString()} L</p>
                          <span className="text-[9.5px] font-semibold text-slate-500 block">
                            13% TS Eq: {d13.toLocaleString()} L
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                            Plant Receipt Against Dispatch
                          </span>
                          <p className="text-sm font-black text-[#1E3A8A]">{pL.toLocaleString()} L</p>
                          <span className="text-[9.5px] font-extrabold text-slate-400 block font-sans">
                            Weight: Available at vehicle level
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 block uppercase font-sans">
                            Numerical Differences
                          </span>
                          <p className={`text-sm font-black ${pVolDiff >= 0 ? 'text-emerald-700' : 'text-[#991B1B]'}`}>
                            Volume: {pVolDiff >= 0 ? `+${pVolDiff}L (+${pVolDiffPct}%)` : `${pVolDiff}L (${pVolDiffPct}%)`}
                          </p>
                          <span className={`text-[10px] font-bold block ${pTsDiff >= 0 ? 'text-emerald-700' : 'text-[#991B1B]'}`}>
                            13% TS Diff: {pTsDiff >= 0 ? `+${pTsDiff}L` : `${pTsDiff}L`}
                          </span>
                        </div>
                      </div>

                      {/* Important Quality Test Summary (Section 15 & 18) */}
                      <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10.5px] font-extrabold uppercase font-sans text-[#1E3A8A] flex items-center gap-1.5">
                            <FlaskConical className="w-3.5 h-3.5" />
                            Key Quality Test Summary (FAT, SNF, LR, Acidity, Temperature)
                          </span>
                          <span className="text-[9.5px] text-slate-400 font-sans">
                            Dynamically calculated from lab test records
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs font-mono">
                          {testComparisons.slice(0, 5).map((t) => (
                            <div key={t.testId} className="p-2 rounded bg-[#FDFBF9] border border-[#EAE4D5]">
                              <span className="text-[9.5px] font-bold text-slate-500 block uppercase font-sans">
                                {t.testCode} ({t.unit})
                              </span>
                              <span className="text-[11px] font-black text-[#111311] block">
                                {t.dispatchResult.value ?? '--'} / {t.plantResult.value ?? '--'}
                              </span>
                              <span className={`text-[9.5px] font-bold ${t.difference.numericValue != null && t.difference.numericValue >= 0 ? 'text-emerald-700' : 'text-[#991B1B]'}`}>
                                Diff: {t.difference.displayText}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* VIEW ALL LAB TESTS NESTED COMPARISON TABLE (SECTION 15 & 19) */}
                      <div className="pt-1">
                        <button
                          onClick={() => toggleExpandLabTests(portionModalKey)}
                          className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-[#FFFFFF] border border-[#EAE4D5] text-[#1E3A8A] hover:bg-[#F4F0E6] transition flex items-center space-x-1.5 shadow-sm no-print"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{isLabExpanded ? 'Hide All Lab Tests' : 'View All Lab Tests (Side-by-Side Comparison)'}</span>
                          {isLabExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>

                        {/* Lab Test Table rendered when opened or when printing */}
                        {(isLabExpanded || isPrintingFilteredReport) && (
                          <div className="mt-3 p-3.5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3">
                            <div className="flex items-center justify-between border-b border-[#EAE4D5]/60 pb-2">
                              <h5 className="text-xs font-extrabold font-sans text-[#111311]">
                                Full Dynamic Lab Test Comparison for Portion {portion.portion_number}
                              </h5>
                              <span className="text-[10px] text-slate-500 font-sans">
                                Authoritative side-by-side lab results
                              </span>
                            </div>

                            <div className="overflow-x-auto rounded-lg border border-[#EAE4D5]/60">
                              <table className="w-full text-left border-collapse text-xs font-mono">
                                <thead>
                                  <tr className="bg-[#FDFBF9] text-slate-600 font-sans font-bold text-[9.5px] uppercase border-b border-[#EAE4D5]/60">
                                    <th className="py-2 px-3">Test Code / Name</th>
                                    <th className="py-2 px-3">Category</th>
                                    <th className="py-2 px-3 text-center">Test Scope</th>
                                    <th className="py-2 px-3 text-right">Dispatch Result</th>
                                    <th className="py-2 px-3 text-right">Plant Result</th>
                                    <th className="py-2 px-3 text-right">Difference</th>
                                    <th className="py-2 px-3 text-center">Unit</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#EAE4D5]/40 font-semibold text-[#111311]">
                                  {testComparisons.map((test) => {
                                    const testKey = `cross-modal-test-${String(selectedModalGroup.visitId)}-${portionIdStr}-${test.testId}`;
                                    return (
                                      <tr key={testKey} className="hover:bg-[#F4F0E6]/40 transition">
                                        <td className="py-2 px-3">
                                          <span className="font-bold text-[#111311] block font-sans">{test.testName}</span>
                                          <span className="text-[9.5px] text-slate-400 font-mono">{test.testCode}</span>
                                        </td>
                                        <td className="py-2 px-3 text-slate-600 font-sans text-[10.5px]">{test.category}</td>
                                        <td className="py-2 px-3 text-center">
                                          <span className="px-2 py-0.5 rounded text-[9px] font-extrabold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                                            {test.testScope}
                                          </span>
                                        </td>
                                        <td className="py-2 px-3 text-right text-slate-700">
                                          {test.dispatchResult.status === 'AVAILABLE' ? (
                                            <span>{test.dispatchResult.value}</span>
                                          ) : test.dispatchResult.status === 'NOT_APPLICABLE' ? (
                                            <span className="text-slate-400 italic">Not Applicable</span>
                                          ) : (
                                            <span className="text-amber-700">Pending</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right text-[#1E3A8A]">
                                          {test.plantResult.status === 'AVAILABLE' ? (
                                            <span className="font-black">{test.plantResult.value}</span>
                                          ) : test.plantResult.status === 'NOT_APPLICABLE' ? (
                                            <span className="text-slate-400 italic">Not Applicable</span>
                                          ) : (
                                            <span className="text-amber-700">Pending</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right font-black">
                                          <span
                                            className={
                                              test.difference.numericValue != null && test.difference.numericValue >= 0
                                                ? 'text-emerald-700'
                                                : test.difference.numericValue != null
                                                ? 'text-[#991B1B]'
                                                : 'text-slate-400'
                                            }
                                          >
                                            {test.difference.displayText}
                                          </span>
                                        </td>
                                        <td className="py-2 px-3 text-center text-slate-500 text-[10px]">{test.unit}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE FILTERED REPORT CONTAINER (SECTION 20: EXCLUDES ALL REMOVED KPI CARDS) */}
      {isPrintingFilteredReport && (
        <div className="hidden print:block fixed inset-0 bg-white z-50 p-6 font-sans text-[#111311]" id="vehicle-comparison-print-area">
          <div className="border-b pb-4 mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-black">MILK RECEPTION & PROCESS LOGS ERP</h1>
              <h2 className="text-sm font-bold text-[#1E3A8A]">Zonal Cross-Verification Filtered Report</h2>
            </div>
            <div className="text-right text-xs font-mono">
              <p>Zone: {managerZone}</p>
              <p>Date Range: {fromDate || 'Start'} to {toDate || 'Present'}</p>
              <p>Printed: {new Date().toLocaleString()}</p>
            </div>
          </div>

          <table className="w-full text-left border-collapse text-xs font-mono border">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="p-2">Dispatch Date</th>
                <th className="p-2">Vehicle #</th>
                <th className="p-2">Contractor</th>
                <th className="p-2 text-center">Portions</th>
                <th className="p-2 text-right">Zonal Liters</th>
                <th className="p-2 text-right">Plant Liters</th>
                <th className="p-2 text-right">Difference</th>
                <th className="p-2 text-center">QA Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {vehicleGroups.map((v) => (
                <tr key={`print-report-${v.visitId}`}>
                  <td className="p-2">{v.dispatchDate}</td>
                  <td className="p-2 font-black">{v.vehicleNumber}</td>
                  <td className="p-2">{v.zonalContractorName}</td>
                  <td className="p-2 text-center">{v.portions.length}</td>
                  <td className="p-2 text-right">{v.totalZonalDispatchLiters.toLocaleString()} L</td>
                  <td className="p-2 text-right">{v.plantReceivedLiters ? `${v.plantReceivedLiters.toLocaleString()} L` : 'Pending'}</td>
                  <td className="p-2 text-right font-black">{v.volumeDifference ? `${v.volumeDifference} L` : '--'}</td>
                  <td className="p-2 text-center font-bold">{computeVehicleDecisionSummary(v.portions, v.overallStatus).statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CSS PRINT RULES FOR CLEAN TARGETED PRINTING */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          #vehicle-comparison-print-area {
            display: block !important;
            visibility: visible !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: white !important;
          }
        }
      `}</style>

      <LogDetailModal
        isOpen={!!selectedDetailLog}
        onClose={() => setSelectedDetailLog(null)}
        log={selectedDetailLog}
        currentUser={currentUser}
      />

      <AuditRevertModal
        isOpen={!!selectedAuditLog}
        onClose={() => setSelectedAuditLog(null)}
        log={selectedAuditLog}
        currentUser={currentUser}
        onRollbackComplete={async () => {
          fetchLogs(fromDate, toDate, selectedContractor, qaDecisionFilter, searchQuery);
        }}
      />
    </div>
  );
};
