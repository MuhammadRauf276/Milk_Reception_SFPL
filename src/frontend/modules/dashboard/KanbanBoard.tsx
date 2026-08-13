'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User, KANBAN_STAGES, Role, DEFAULT_USERS } from '@core/types';
import { getLiveWaitStatus } from '@core/durations';
import { computeZonalCrossVerification } from '@backend/services/dairyCalculations';
import { warnDuplicateKeys } from '@/lib/key-utils';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { IsometricIcon } from '@modules/shared/IsometricIcon';
import { AdaptiveVehicleCard } from '@modules/cards/AdaptiveVehicleCard';
import { LogDetailModal } from '@modules/dashboard/LogDetailModal';
import { AuditRevertModal } from '@modules/shared/AuditRevertModal';
import { TokenGenerationModal } from '@modules/forms/TokenGenerationModal';
import { MPDDispatchForm } from '@modules/forms/MPDDispatchForm';
import { QASamplingForm } from '@modules/forms/QASamplingForm';
import { SecurityWeightForm } from '@modules/forms/SecurityWeightForm';
import { ProductionReceptionForm } from '@modules/forms/ProductionReceptionForm';
import { SecurityGatewayWorkspace } from '@modules/dashboard/SecurityGatewayWorkspace';
import { MPDFieldWorkspace } from '@modules/dashboard/MPDFieldWorkspace';
import { QALaboratoryWorkspace } from '@modules/dashboard/QALaboratoryWorkspace';
import { WeighbridgeWorkspace } from '@modules/dashboard/WeighbridgeWorkspace';
import { ZonalHistoryTable } from '@modules/dashboard/ZonalHistoryTable';
import { SecurityWorkforceTable } from '@modules/dashboard/SecurityWorkforceTable';

import { Search, Filter, Truck, FlaskConical, Scale, Factory, Layers, RefreshCw, CheckCircle2, XCircle, ArrowRightLeft, Lock, Calendar, ShieldCheck } from 'lucide-react';

export const KanbanBoard: React.FC = () => {
  const [theme, setTheme] = useState<'creamy' | 'night'>('creamy');
  const [currentUser, setCurrentUser] = useState<User | null>(DEFAULT_USERS.MPD_Operator);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'PLANNED' | 'IN_PLANT' | 'COMPLETED'>('ALL');

  // Date Range Filter for Top Cross-Verification Cards (Default: TODAY)
  const [summaryDateRange, setSummaryDateRange] = useState<'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_15' | 'ALL'>('TODAY');

  // Modals & Slideovers
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);
  const [auditLogToInspect, setAuditLogToInspect] = useState<MilkProcessLog | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  
  // Department Action Forms
  const [qaLogToEdit, setQaLogToEdit] = useState<MilkProcessLog | null>(null);
  const [weightLogToEdit, setWeightLogToEdit] = useState<MilkProcessLog | null>(null);
  const [receptionLogToEdit, setReceptionLogToEdit] = useState<MilkProcessLog | null>(null);

  // High Volume Collapsed State map per stage
  const [expandedLanes, setExpandedLanes] = useState<Record<string, boolean>>({});

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.user) setCurrentUser(data.user);
    } catch (_err) {
      // Fallback
    }
  };

  const fetchLogs = useCallback(async (fFromDate?: string, fToDate?: string) => {
    try {
      const params = new URLSearchParams();
      if (fFromDate) params.set('fromDate', fFromDate);
      if (fToDate) params.set('toDate', fToDate);

      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (_err) {
      // Handled
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
    fetchLogs(fromDate, toDate);

    const interval = setInterval(() => {
      fetchLogs(fromDate, toDate);
      setCurrentTime(new Date());
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchLogs, fromDate, toDate]);

  // Role Checks
  const isSecurityOperator = currentUser?.role === 'Security_Operator' || currentUser?.role === 'Security_Weight';
  const isSecurityManager = currentUser?.role === 'Security_Manager';
  const isMPDOperator = currentUser?.role === 'MPD_Operator' || currentUser?.role === 'MPD';
  const isQAChemist = currentUser?.role === 'QA_Operator' || currentUser?.role === 'QA';
  const isWeighbridgeOperator = currentUser?.role === 'WEIGHBRIDGE_OPERATOR' || currentUser?.role === 'Weighbridge_Operator';
  const isZonalManager = currentUser?.role === 'MPD_Zone_Manager';
  const targetZone = isZonalManager ? (currentUser?.zone || 'ZMCC Hasilpur') : selectedZone;

  // STRICT ROW-LEVEL DATA ISOLATION BOUNDARY FOR ZMCC MINOR MANAGERS
  const zoneScopedLogs = isZonalManager
    ? logs.filter((l) => l.zonal_contractor_name === targetZone)
    : logs;

  // Filter logs by Date Range for the TOP 4 Cross-Verification Cards
  const todayStr = new Date().toISOString().split('T')[0];

  const summaryScopedLogs = zoneScopedLogs.filter((l) => {
    const logDate = l.dispatch_date || l.created_at.split('T')[0];
    if (summaryDateRange === 'TODAY') return logDate === todayStr;
    if (summaryDateRange === 'YESTERDAY') {
      const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      return logDate === yesterdayStr;
    }
    if (summaryDateRange === 'LAST_7') {
      const diffDays = Math.floor((Date.now() - new Date(logDate).getTime()) / (1000 * 3600 * 24));
      return diffDays <= 7;
    }
    if (summaryDateRange === 'LAST_15') {
      const diffDays = Math.floor((Date.now() - new Date(logDate).getTime()) / (1000 * 3600 * 24));
      return diffDays <= 15;
    }
    return true;
  });

  // TOP 4 ZMCC Cross-Verification cards filter dynamically by summaryDateRange
  const zonalAnalytics = computeZonalCrossVerification(summaryScopedLogs, targetZone);

  // Filtered dataset incorporating search queries & quick status toggles
  const filteredLogs = zoneScopedLogs.filter((log) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        log.vehicle_number.toLowerCase().includes(q) ||
        (log.token_number && log.token_number.toLowerCase().includes(q)) ||
        log.zonal_contractor_name.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (!isZonalManager && selectedZone !== 'ALL' && log.zonal_contractor_name !== selectedZone) {
      return false;
    }

    if (quickFilter === 'PLANNED') {
      const s = String(log.status).toUpperCase();
      if (s !== 'DISPATCHED' && s !== 'PLANNED') return false;
    }
    if (quickFilter === 'IN_PLANT') {
      const s = String(log.status).toUpperCase();
      const isEnRoute = s === 'DISPATCHED' || s === 'PLANNED';
      const isDone = s === 'COMPLETED' || s === 'EXIT' || s === 'SCALE_2_READY';
      if (isEnRoute || isDone) return false;
    }
    if (quickFilter === 'COMPLETED') {
      const s = String(log.status).toUpperCase();
      const calc = String(log.calculated_status || '').toUpperCase();
      const isDone = s === 'COMPLETED' || s === 'EXIT' || s === 'SCALE_2_READY' || calc === 'REJECTED';
      if (!isDone) return false;
    }

    return true;
  });

  // Zone list for dropdown filter
  const uniqueZones = Array.from(new Set(logs.map((l) => l.zonal_contractor_name))).filter(Boolean);

  // BOTTOM 4 LIVE PIPELINE METRIC CARDS (Always reflects live active pipeline status)
  const activeInPlantCount = zoneScopedLogs.filter((l) => l.status !== 'Dispatched' && l.status !== 'Completed').length;
  const qaTestingQueueCount = zoneScopedLogs.filter((l) => l.status === 'Sampling' || l.status === 'Sampling_In_Progress').length;
  const weighbridgeBottleneckCount = zoneScopedLogs.filter((l) => l.status === 'First Weight' || l.status === 'Second Weight').length;
  const dailyDispatchesCompleted = zoneScopedLogs.filter((l) => l.status === 'Completed' && (l.dispatch_date || l.created_at.split('T')[0]) === todayStr).length;

  const handleSaveDispatch = async (data: Partial<MilkProcessLog>) => {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create dispatch');
    fetchLogs();
  };

  const handleIssueToken = async (logId: number, tokenNumber: string, igpDate: string, igpTime: string) => {
    const res = await fetch(`/api/logs/${logId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token_number: tokenNumber,
        igp_date: igpDate,
        igp_time: igpTime,
        status: 'Token Issued',
      }),
    });
    if (!res.ok) throw new Error('Failed to issue token');
    fetchLogs();
  };

  const handleLogGateOut = async (logId: number, outTime: string) => {
    const res = await fetch(`/api/logs/${logId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        out_from_gate_time: outTime,
        status: 'Completed',
      }),
    });
    if (!res.ok) throw new Error('Failed to clear gate out');
    fetchLogs();
  };

  const handleUpdateLog = async (id: number, updates: Partial<MilkProcessLog>) => {
    const res = await fetch(`/api/logs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update log');
    }
    fetchLogs();
  };

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-[#FDFBF9] text-[#111311] flex flex-row font-sans">
      {/* Sidebar rendered only for multi-workspace roles (Manager/Admin) */}
      {!isMPDOperator && !isSecurityOperator && !isQAChemist && (
        <Sidebar
          currentUser={currentUser}
          onOpenDispatchModal={() => setIsDispatchModalOpen(true)}
          onOpenTokenModal={() => setIsTokenModalOpen(true)}
          activeCount={activeInPlantCount}
        />
      )}

      {/* Main Content Column with Top Header Bar */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          currentUser={currentUser}
          currentTheme={theme}
          onToggleTheme={() => setTheme(theme === 'creamy' ? 'night' : 'creamy')}
          title={isMPDOperator ? 'MPD Dispatch' : isSecurityOperator ? 'Security Gate' : isQAChemist ? 'QA Laboratory' : isWeighbridgeOperator ? 'Weighbridge' : 'Supply Chain Workstation'}
          showBranding={isMPDOperator || isSecurityOperator || isQAChemist || isWeighbridgeOperator}
        />

        <main className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* CONDITIONAL RENDERING 1: RESTRICTED MPD OPERATOR FIELD WORKSPACE */}
          {isMPDOperator ? (
            <MPDFieldWorkspace
              logs={logs}
              currentUser={currentUser}
              onSaveDispatch={handleSaveDispatch}
              onRefresh={fetchLogs}
            />
          ) : isSecurityOperator ? (
            /* CONDITIONAL RENDERING 2: RESTRICTED SECURITY OPERATOR WORKSPACE */
            <SecurityGatewayWorkspace
              logs={logs}
              onIssueToken={handleIssueToken}
              onLogGateOut={handleLogGateOut}
            />
          ) : isQAChemist ? (
            /* CONDITIONAL RENDERING 3: DEDICATED QA CHEMIST LABORATORY WORKSPACE */
            <QALaboratoryWorkspace
              logs={logs}
              currentUser={currentUser}
            />
          ) : isWeighbridgeOperator ? (
            /* CONDITIONAL RENDERING 4: DEDICATED WEIGHBRIDGE WORKSPACE */
            <WeighbridgeWorkspace
              currentUser={currentUser}
            />
          ) : isSecurityManager ? (
            /* CONDITIONAL RENDERING 3: STRICT ISOLATED SECURITY MANAGER DASHBOARD */
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm">
                <div>
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-6 h-6 text-[#1E3A8A]" />
                    <h1 className="text-xl font-extrabold tracking-tight text-[#111311]">
                      Security Manager Station & Workforce Audit Ledger
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white flex items-center gap-1">
                      <Lock className="w-3 h-3" /> READ-ONLY CONSOLE
                    </span>
                  </div>
                  <p className="text-xs text-[#334155] font-semibold mt-0.5">
                    Isolated security workforce dashboard tracking Gate 2 entry tokens, weighbridge scale times, and plant transit bottlenecks.
                  </p>
                </div>

                <button
                  onClick={() => fetchLogs()}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#1E3A8A]" />
                  <span>Refresh Audit Logs</span>
                </button>
              </div>

              <SecurityWorkforceTable
                logs={logs}
                currentUser={currentUser}
                isSecurityManager={true}
              />
            </div>
          ) : (
            /* CONDITIONAL RENDERING 4: UNRESTRICTED KANBAN WORKSPACE FOR PLANT MANAGERS & ADMINS */
            <>
              {/* Top Header Panel */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-xl font-extrabold tracking-tight text-[#111311]">
                      {isZonalManager ? `ZMCC Zonal Historical Station (${targetZone})` : 'Physical Plant 5-Stage Reception Kanban'}
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white">
                      {currentUser?.role || 'OPERATOR'}
                    </span>
                    {isZonalManager && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white flex items-center gap-1">
                        <Lock className="w-3 h-3" /> HISTORICAL ARCHIVE VIEW
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#334155] font-semibold mt-0.5">
                    {isZonalManager
                      ? `Active plant columns replaced with historical log table for ${targetZone}.`
                      : 'Global plant workstation. Unrestricted access across all procurement zones and pipelines.'}
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => fetchLogs()}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out shadow-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#1E3A8A]" />
                    <span>Refresh Board</span>
                  </button>

                  {(currentUser?.role === 'Correction_Officer' || currentUser?.role === 'Admin') && (
                    <button
                      onClick={() => setIsDispatchModalOpen(true)}
                      className="px-4 py-2 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-extrabold text-xs shadow-sm border border-indigo-950 transition-all duration-200 ease-in-out"
                    >
                      + Record Dispatch
                    </button>
                  )}
                </div>
              </div>

              {/* ZMCC MINOR MANAGER AUTOMATED CROSS-VERIFICATION ANALYTICS PANEL (TOP 4 CARDS WITH DATE RANGE SELECTOR) */}
              {isZonalManager && (
                <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3 text-[#111311]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#EAE4D5]/80">
                    <div className="flex items-center space-x-2">
                      <ArrowRightLeft className="w-5 h-5 text-[#1E3A8A]" />
                      <h3 className="text-sm font-extrabold text-[#111311]">
                        ZMCC Minor Manager Cross-Verification Panel ({targetZone})
                      </h3>
                    </div>

                    {/* DATE RANGE FILTER DYNAMICALLY APPLIED TO THE TOP 4 CARDS */}
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-extrabold text-[#334155] flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#1E3A8A]" /> Date Filter:
                      </span>
                      <select
                        value={summaryDateRange}
                        onChange={(e) => setSummaryDateRange(e.target.value as any)}
                        className="px-3 py-1.5 text-xs font-extrabold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none shadow-sm"
                      >
                        <option value="TODAY">Today ({todayStr})</option>
                        <option value="YESTERDAY">Yesterday</option>
                        <option value="LAST_7">Last 7 Days</option>
                        <option value="LAST_15">Last 15 Days</option>
                        <option value="ALL">All Time</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF]">
                      <span className="text-[#1E40AF]/80 font-sans block text-[10px] uppercase font-bold">
                        Zonal Dispatch vs Plant Receipt ({summaryDateRange})
                      </span>
                      <span className="text-sm font-black text-[#111311]">{zonalAnalytics.totalZonalDispatchedLiters} L / {zonalAnalytics.plantReceivedFromThisZone} L</span>
                      <span className={`block text-[10px] font-bold ${zonalAnalytics.volumeVarianceLiters >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'}`}>
                        Zonal Receipt Variance: {zonalAnalytics.volumeVarianceLiters > 0 ? `+${zonalAnalytics.volumeVarianceLiters}` : zonalAnalytics.volumeVarianceLiters} L ({zonalAnalytics.volumeVariancePercent}%)
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF] text-[#6B21A8]">
                      <span className="text-[#6B21A8]/80 font-sans block text-[10px] uppercase font-bold">
                        13% TS Eq Liters ({summaryDateRange})
                      </span>
                      <span className="text-sm font-black text-[#111311]">{zonalAnalytics.totalDispatch13TSLiters} L / {zonalAnalytics.totalPlant13TSLiters} L</span>
                      <span className={`block text-[10px] font-bold ${zonalAnalytics.tsVariance >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'}`}>
                        TS Variance: {zonalAnalytics.tsVariance > 0 ? `+${zonalAnalytics.tsVariance}` : zonalAnalytics.tsVariance} L ({zonalAnalytics.tsVariancePercent}%)
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534]">
                      <span className="text-[#166534]/80 font-sans block text-[10px] uppercase font-bold">
                        Portion QA Acceptances ({summaryDateRange})
                      </span>
                      <span className="text-sm font-black text-[#166534] flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-[#166534]" />
                        {zonalAnalytics.acceptedCount} Portions Passed
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B]">
                      <span className="text-[#991B1B]/80 font-sans block text-[10px] uppercase font-bold">
                        Portion QA Rejections ({summaryDateRange})
                      </span>
                      <span className="text-sm font-black text-[#991B1B] flex items-center gap-1">
                        <XCircle className="w-4 h-4 text-[#991B1B]" />
                        {zonalAnalytics.rejectedCount} Portions Rejected
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* PIPELINE SUMMARY METRICS HEADER */}
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#334155] flex items-center gap-2">
                  <Truck className="w-4 h-4 text-[#1E3A8A]" />
                  <span>Live Pipeline Summary Metrics</span>
                </h3>
              </div>

              {/* 4 LIVE PIPELINE SUMMARY METRIC CARDS WITH PASTEL GRADIENT SPECIFICATIONS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Blue Box: Vehicle Dispatch / Fleet */}
                <div className="p-5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#DBEAFE]/80">
                  <div>
                    <p className="text-xs font-extrabold text-[#1E40AF]">Active In-Plant</p>
                    <h2 className="text-3xl font-black font-mono text-[#111311] mt-1">{activeInPlantCount}</h2>
                    <span className="text-[10px] font-bold text-[#1E40AF]">Vehicles in Pipeline</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#BFDBFE] text-[#1E40AF]">
                    <Truck className="w-6 h-6" />
                  </div>
                </div>

                {/* Green Box: Scale / Weights / QA */}
                <div className="p-5 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#DCFCE7]/80">
                  <div>
                    <p className="text-xs font-extrabold text-[#166534]">QA Lab Queue</p>
                    <h2 className="text-3xl font-black font-mono text-[#111311] mt-1">{qaTestingQueueCount}</h2>
                    <span className="text-[10px] font-bold text-[#166534]">Sampling & MBRT</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#BBF7D0] text-[#166534]">
                    <FlaskConical className="w-6 h-6" />
                  </div>
                </div>

                {/* Purple Box: Quality Recovery */}
                <div className="p-5 rounded-xl bg-[#FAF5FF] border border-[#E9D5FF] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#F3E8FF]/80">
                  <div>
                    <p className="text-xs font-extrabold text-[#6B21A8]">Weighbridge Queue</p>
                    <h2 className="text-3xl font-black font-mono text-[#111311] mt-1">{weighbridgeBottleneckCount}</h2>
                    <span className="text-[10px] font-bold text-[#6B21A8]">Gross & Tare Scale</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E9D5FF] text-[#6B21A8]">
                    <Scale className="w-6 h-6" />
                  </div>
                </div>

                {/* Amber/Green Completed Dispatches */}
                <div className="p-5 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#DCFCE7]/80">
                  <div>
                    <p className="text-xs font-extrabold text-[#166534]">Completed Dispatches (Today)</p>
                    <h2 className="text-3xl font-black font-mono text-[#111311] mt-1">{dailyDispatchesCompleted}</h2>
                    <span className="text-[10px] font-bold text-[#166534]">Fully Offloaded</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#BBF7D0] text-[#166534]">
                    <Factory className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Global Search & Region Filters Panel */}
              <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search vehicle #, token #..."
                    className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                  />
                </div>

                {/* Quick Filter Buttons */}
                <div className="flex items-center space-x-1.5 overflow-x-auto w-full md:w-auto">
                  {(['ALL', 'PLANNED', 'IN_PLANT', 'COMPLETED'] as const).map((filterKey) => (
                    <button
                      key={filterKey}
                      onClick={() => setQuickFilter(filterKey)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase transition-all duration-200 ease-in-out ${
                        quickFilter === filterKey
                          ? 'bg-[#1E3A8A] text-[#FFFFFF] shadow-sm'
                          : 'bg-[#FDFBF9] text-slate-700 border border-[#EAE4D5]/80 hover:bg-[#F4F0E6]/60'
                      }`}
                    >
                      {filterKey.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                {/* Zone Dropdown Filter */}
                <div className="flex items-center space-x-2 w-full md:w-auto">
                  <Filter className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                  <select
                    value={targetZone}
                    onChange={(e) => setSelectedZone(e.target.value)}
                    disabled={isZonalManager}
                    className="w-full md:w-56 px-3 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none disabled:opacity-80 disabled:bg-slate-200/80 cursor-not-allowed"
                  >
                    {isZonalManager ? (
                      <option value={targetZone}>{targetZone} (HARD-LOCKED)</option>
                    ) : (
                      <>
                        <option value="ALL">All Procurement Zones</option>
                        {uniqueZones.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* MAIN CONTENT AREA: HISTORICAL ARCHIVE TABLE FOR ZONE MANAGERS VS 5-STAGE KANBAN FOR GLOBAL MANAGERS */}
              {isZonalManager ? (
                <ZonalHistoryTable
                  logs={filteredLogs}
                  targetZone={targetZone}
                  onInspectDetails={(l) => setSelectedLog(l)}
                  currentFromDate={fromDate}
                  currentToDate={toDate}
                  onDateFilterChange={(fFromDate, fToDate) => {
                    setFromDate(fFromDate || '');
                    setToDate(fToDate || '');
                    fetchLogs(fFromDate, fToDate);
                  }}
                />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5 w-full items-start">
                  {KANBAN_STAGES.map((stageConfig) => {
                    const laneLogs = filteredLogs
                      .filter((l) => l.status === stageConfig.status || (stageConfig.status === 'Sampling' && l.status === 'Sampling_In_Progress'))
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                    const isHighVolume = laneLogs.length > 5;
                    const isLaneExpanded = !!expandedLanes[stageConfig.status];
                    const avgWaitMins = Math.round(
                      laneLogs.reduce((acc, curr) => acc + getLiveWaitStatus(curr, currentTime).minutes, 0) /
                        (laneLogs.length || 1)
                    );
                    const isQueueBottleneck = laneLogs.length > 3 || avgWaitMins > 30;

                    return (
                      <div
                        key={stageConfig.status}
                        className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm flex flex-col space-y-4 min-w-[280px]"
                      >
                        {/* Lane Column Header */}
                        <div className="space-y-2 pb-3 border-b border-[#EAE4D5]/80">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2.5">
                              <IsometricIcon type={stageConfig.iconType as any} size="sm" />
                              <div>
                                <h3 className="text-sm font-extrabold tracking-tight text-[#111311]">
                                  {stageConfig.title}
                                </h3>
                                <p className="text-[10px] text-[#334155] font-semibold">{stageConfig.subtitle}</p>
                              </div>
                            </div>

                            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-black bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]">
                              {laneLogs.length}
                            </span>
                          </div>

                          {/* Station Live Queue Analytics Banner */}
                          <div
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold flex items-center justify-between transition-all duration-200 ease-in-out ${
                              isQueueBottleneck
                                ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] animate-pulse'
                                : 'bg-[#FDFBF9] text-slate-700 border border-[#EAE4D5]/80'
                            }`}
                          >
                            <span>Avg Station Wait:</span>
                            <span className="font-mono font-black">{avgWaitMins} mins {isQueueBottleneck && '(BOTTLENECK >30M)'}</span>
                          </div>
                        </div>

                        {/* High Volume Collapse Toggle */}
                        {isHighVolume && (
                          <button
                            onClick={() =>
                              setExpandedLanes({ ...expandedLanes, [stageConfig.status]: !isLaneExpanded })
                            }
                            className="w-full py-1.5 px-2 rounded-lg text-[10px] font-extrabold bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#1E3A8A] hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out flex items-center justify-center space-x-1"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>
                              {isLaneExpanded ? 'Collapse Compact List' : `High Volume: Expand (${laneLogs.length} Trucks)`}
                            </span>
                          </button>
                        )}

                        {/* Vehicle Stack */}
                        <div className="space-y-3">
                          {laneLogs.length === 0 ? (
                            <div className="p-8 text-center border border-dashed border-[#EAE4D5]/80 rounded-xl text-xs font-semibold text-slate-400">
                              No vehicles in this stage
                            </div>
                          ) : (
                            (() => {
                              if (process.env.NODE_ENV !== 'production' && laneLogs.length > 0) {
                                const keys = laneLogs.map((l) => `kanban-${stageConfig.status}-log-${String(l.id)}-${l.portion_id ? String(l.portion_id) : String(l.portion_number || 'P01')}`);
                                warnDuplicateKeys(`Kanban Stage (${stageConfig.status})`, keys);
                              }
                              return laneLogs.map((log, rankIdx) => {
                                const portionKey = log.portion_id ? String(log.portion_id) : String(log.portion_number || 'P01');
                                const cardKey = `kanban-${stageConfig.status}-log-${String(log.id)}-${portionKey}`;
                                return (
                                  <AdaptiveVehicleCard
                                    key={cardKey}
                                    log={log}
                                    rankIndex={rankIdx}
                                    currentUser={currentUser}
                                    currentTime={currentTime}
                                    isCollapsed={isHighVolume && !isLaneExpanded}
                                    onToggleCollapse={() =>
                                      setExpandedLanes({ ...expandedLanes, [stageConfig.status]: !isLaneExpanded })
                                    }
                                    onInspectDetails={(l) => setSelectedLog(l)}
                                    onOpenAuditHistory={(l) => setAuditLogToInspect(l)}
                                    onOpenQASampling={(l) => setQaLogToEdit(l)}
                                    onOpenWeight={(l) => setWeightLogToEdit(l)}
                                    onOpenReception={(l) => setReceptionLogToEdit(l)}
                                  />
                                );
                              });
                            })()
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals & Slideovers */}
      <LogDetailModal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        log={selectedLog}
        currentUser={currentUser}
      />

      <AuditRevertModal
        isOpen={!!auditLogToInspect}
        onClose={() => setAuditLogToInspect(null)}
        log={auditLogToInspect}
        currentUser={currentUser}
        onRollbackComplete={async () => {
          fetchLogs();
        }}
      />

      <TokenGenerationModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        dispatchedLogs={logs.filter((l) => l.status === 'Dispatched')}
        onTokenSubmitted={handleIssueToken}
      />

      <MPDDispatchForm
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        onSave={handleSaveDispatch}
        currentUser={currentUser}
      />

      <QASamplingForm
        isOpen={!!qaLogToEdit}
        onClose={() => setQaLogToEdit(null)}
        log={qaLogToEdit}
        onSave={handleUpdateLog}
      />

      <SecurityWeightForm
        isOpen={!!weightLogToEdit}
        onClose={() => setWeightLogToEdit(null)}
        log={weightLogToEdit}
        onSave={handleUpdateLog}
      />

      <ProductionReceptionForm
        isOpen={!!receptionLogToEdit}
        onClose={() => setReceptionLogToEdit(null)}
        log={receptionLogToEdit}
        onSave={handleUpdateLog}
      />
    </div>
  );
};
