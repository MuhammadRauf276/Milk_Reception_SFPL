'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { LogDetailModal } from '@modules/dashboard/LogDetailModal';
import { AuditRevertModal } from '@modules/shared/AuditRevertModal';
import { getLiveWaitStatus } from '@core/durations';
import { warnDuplicateKeys } from '@/lib/key-utils';
import { Search, Filter, Clock, Eye, History, ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';

export default function FleetTrackingPage() {
  const [theme, setTheme] = useState<'creamy' | 'night'>('creamy');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  
  const [selectedDetailLog, setSelectedDetailLog] = useState<MilkProcessLog | null>(null);
  const [selectedAuditLog, setSelectedAuditLog] = useState<MilkProcessLog | null>(null);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.user) setCurrentUser(data.user);
    } catch (_err) {
      // Fallback
    }
  };

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
    } catch (_err) {
      // Handled
    }
  }, []);

  useEffect(() => {
    fetchUser();
    fetchLogs();

    const interval = setInterval(() => {
      fetchLogs();
      setCurrentTime(new Date());
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Role Checks & Strict Hard-Lock Boundaries for Zone Managers / Contractors
  const isZonalManager = currentUser?.role === 'MPD_Zone_Manager';
  const targetZone = isZonalManager ? (currentUser?.zone || 'ZMCC Hasilpur') : selectedZone;

  // Intercept dataset before fleet matrix filtering
  const zoneScopedLogs = isZonalManager
    ? logs.filter((l) => l.zonal_contractor_name === targetZone)
    : logs;

  const uniqueZones = Array.from(new Set(logs.map((l) => l.zonal_contractor_name))).filter(Boolean);

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

    if (selectedStatus !== 'ALL' && log.status !== selectedStatus) {
      return false;
    }

    return true;
  });

  const activeCount = zoneScopedLogs.filter((l) => l.status !== 'Completed').length;

  if (process.env.NODE_ENV !== 'production' && filteredLogs.length > 0) {
    const keys = filteredLogs.map((l) => `fleet-log-${String(l.id)}-${l.portion_id ? String(l.portion_id) : String(l.portion_number || 'P01')}`);
    warnDuplicateKeys('Fleet Tracking Matrix', keys);
  }

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-[#FDFBF9] text-[#111311] flex flex-row font-sans">
      <Sidebar
        currentUser={currentUser}
        activeCount={activeCount}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          currentUser={currentUser}
          currentTheme={theme}
          onToggleTheme={() => setTheme(theme === 'creamy' ? 'night' : 'creamy')}
          title="High-Density Fleet Matrix"
        />

        <main className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Top Bar Navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Link
                href="/management/dashboard"
                className="p-2 rounded-lg bg-[#FFFFFF] border border-[#EAE4D5]/80 hover:bg-[#F4F0E6]/60 text-slate-700 transition"
              >
                <ArrowLeft className="w-4 h-4 text-[#1E3A8A]" />
              </Link>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-xl font-black tracking-tight text-[#111311]">
                    High-Density Fleet Tracking Matrix
                  </h1>
                  {isZonalManager && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#1E3A8A] text-white flex items-center gap-1">
                      <Lock className="w-3 h-3" /> HARD-LOCKED: {targetZone}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#334155] font-semibold">
                  {isZonalManager
                    ? `Isolated fleet matrix for ${targetZone}. Competing contractor dispatches are hidden.`
                    : 'High-volume vehicle tracking board displaying all plant dispatches in compact mini cards.'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="px-3.5 py-2 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311]">
                Filtered Trucks: <strong className="font-mono text-[#111311] text-sm font-extrabold">{filteredLogs.length}</strong>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by Vehicle #, Token #, Contractor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] placeholder:text-slate-400 focus:ring-2 focus:ring-[#1E3A8A] outline-none"
              />
            </div>

            <div className="flex items-center space-x-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                disabled={isZonalManager}
                className="w-full md:w-56 px-3 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none disabled:opacity-75"
              >
                {isZonalManager ? (
                  <option value={targetZone}>{targetZone} (HARD-LOCKED)</option>
                ) : (
                  <>
                    <option value="ALL">All Procurement Zones</option>
                    {uniqueZones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="flex items-center space-x-2 w-full md:w-auto">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full md:w-56 px-3 py-2 text-xs font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
              >
                <option value="ALL">All Pipeline Stations</option>
                <option value="Dispatched">Dispatched / En-Route</option>
                <option value="Token Issued">Gate 2 Token Desk</option>
                <option value="Sampling">QA Lab Sampling</option>
                <option value="First Weight">Weighbridge Scale</option>
                <option value="Silo Reception">Silo Milk Reception</option>
                <option value="Completed">Completed Dispatches</option>
              </select>
            </div>
          </div>

          {/* Grid of Mini Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 w-full">
            {filteredLogs.length === 0 ? (
              <div className="col-span-full p-12 text-center border border-dashed border-[#EAE4D5]/80 rounded-xl text-xs font-bold text-slate-400">
                No vehicles found matching current filters.
              </div>
            ) : (
              filteredLogs.map((log) => {
                const liveWait = getLiveWaitStatus(log, currentTime);
                const isQARejected = log.calculated_status === 'Rejected';
                const portionKey = log.portion_id ? String(log.portion_id) : String(log.portion_number || 'P01');
                const cardKey = `fleet-log-${String(log.id)}-${portionKey}`;

                return (
                  <div
                    key={cardKey}
                    className={`p-4 rounded-xl border bg-[#FFFFFF] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ease-in-out space-y-3 flex flex-col justify-between ${
                      isQARejected ? 'border-[#FECACA] bg-[#FEF2F2]/40 ring-1 ring-[#FECACA]' : 'border-[#EAE4D5]/80'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-black font-mono text-[#111311] truncate">
                          {log.vehicle_number}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]">
                          {log.portion_number}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-[#334155] truncate">
                        {log.zonal_contractor_name}
                      </p>
                    </div>

                    <div>
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                          log.status === 'Dispatched'
                            ? 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]'
                            : log.status === 'Completed'
                            ? 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]'
                            : 'bg-[#FAF5FF] text-[#6B21A8] border border-[#E9D5FF]'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 p-2 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[10px] font-mono font-bold text-[#111311]">
                      <div>
                        <span className="text-slate-500 font-sans block text-[9px]">Liters</span>
                        <span>{log.dispatch_liters_gross || 0} L</span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-sans block text-[9px]">Fat/SNF</span>
                        <span>{log.sampling_fat || log.dispatch_fat || 0}% / {log.computed_sampling_snf || log.computed_dispatch_snf || 0}%</span>
                      </div>
                    </div>

                    {log.status !== 'Completed' && (
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-600 pt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Wait Time:</span>
                        </span>
                        <span className={`font-mono font-black ${liveWait.isBottleneck ? 'text-[#991B1B]' : 'text-[#1E3A8A]'}`}>
                          {liveWait.minutes} mins
                        </span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-[#EAE4D5]/80 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedDetailLog(log)}
                        className="w-full flex items-center justify-center space-x-1 py-1.5 px-2 rounded-lg text-xs font-extrabold bg-[#1E3A8A] text-white hover:bg-blue-900 shadow-sm border border-blue-950 transition-all duration-200 ease-in-out"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect Details</span>
                      </button>

                      <button
                        onClick={() => setSelectedAuditLog(log)}
                        className="p-1.5 rounded-lg text-slate-600 hover:bg-[#FDFBF9] border border-[#EAE4D5]/80 transition-all duration-200 ease-in-out"
                        title="Audit History"
                      >
                        <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      </div>

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
          fetchLogs();
        }}
      />
    </div>
  );
}
