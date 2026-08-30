'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ShieldCheck, Search, AlertTriangle, Lock, RefreshCw } from 'lucide-react';

export const SecurityManager: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

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
      // Error
    }
  }, []);

  useEffect(() => {
    fetchUser();
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleManualSync = async () => {
    setIsLoading(true);
    await fetchLogs();
    setTimeout(() => setIsLoading(false), 500);
  };

  // Helper to calculate minutes between two HH:mm strings
  const getMinutesBetween = (timeA?: string | null, timeB?: string | null): number | null => {
    if (!timeA || !timeB) return null;
    const [hA, mA] = timeA.split(':').map(Number);
    const [hB, mB] = timeB.split(':').map(Number);
    if (isNaN(hA) || isNaN(mA) || isNaN(hB) || isNaN(mB)) return null;

    const minsA = hA * 60 + mA;
    const minsB = hB * 60 + mB;
    const diff = minsB - minsA;
    return diff >= 0 ? diff : diff + 1440; // Handle midnight wrap if needed
  };

  const filteredLogs = logs.filter(
    (log) =>
      log.vehicle_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.token_number && log.token_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
      log.zonal_contractor_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate Security Performance Metrics
  const totalGateEntries = logs.filter((l) => l.igp_time).length;
  const delayedTransitCount = logs.filter((l) => {
    const transitMins = getMinutesBetween(l.igp_time, l.sampling_time_start);
    return transitMins !== null && transitMins > 15;
  }).length;
  const completedGateOuts = logs.filter((l) => l.out_from_gate_time).length;

  return (
    <div className="w-full max-w-full flex h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      <Sidebar
        currentUser={currentUser}
        activeCount={logs.filter((l) => l.status !== 'Completed').length}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full max-w-full">
        <Header
          currentUser={currentUser}
          title="Security Audit & Performance Monitor"
          onMenuClick={() => setIsMobileNavOpen((prev) => !prev)}
        />

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6 w-full max-w-full">
          {/* Top Header Panel */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm">
            <div>
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                <ShieldCheck className="w-6 h-6 text-[#1E3A8A]" />
                <h1 className="text-xl font-black tracking-tight text-[#111311]">
                  Security Time Audit & Gate Performance
                </h1>
                <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Read-Only Audit Console
                </span>
              </div>
              <p className="text-xs text-slate-600 font-semibold mt-1">
                Read-only monitoring dashboard tracking Gate 2 entry tokens, weighbridge timestamps, and plant transit bottlenecks.
              </p>
            </div>

            <button
              type="button"
              onClick={handleManualSync}
              disabled={isLoading}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#FDFBF9] border border-[#C4B9A3] text-xs font-black text-[#111311] hover:bg-[#EFE9D9]/60 active:scale-95 transition-all shadow-sm disabled:opacity-50 self-start md:self-auto"
            >
              <RefreshCw className={`w-4 h-4 text-[#1E3A8A] ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Syncing...' : 'Refresh Audit Log'}</span>
            </button>
          </div>

          {/* SECURITY AUDIT METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Blue Box: Gate Entries */}
            <div className="p-5 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-sm space-y-1.5 transition-all hover:bg-[#DBEAFE]/80">
              <span className="text-[#1E40AF] font-sans block text-[11px] font-black uppercase tracking-wider">
                Total Gate 2 IGP Entries
              </span>
              <div className="text-2xl sm:text-3xl font-black font-mono text-[#111311]">
                {totalGateEntries} <span className="text-base font-bold font-sans text-slate-600">Vehicles</span>
              </div>
              <span className="text-[11px] text-[#1E40AF] font-bold block">Issued entry tokens</span>
            </div>

            {/* Red Alert Box: Delays */}
            <div className="p-5 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] shadow-sm space-y-1.5 transition-all hover:bg-[#FEE2E2]/80">
              <span className="text-[#991B1B] font-sans block text-[11px] font-black uppercase tracking-wider">
                Gate-to-Lab Transit Delays (&gt;15 mins)
              </span>
              <div className="text-2xl sm:text-3xl font-black font-mono text-[#991B1B] flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-[#991B1B] shrink-0" />
                <span>{delayedTransitCount} <span className="text-base font-bold font-sans text-[#991B1B]">Delays</span></span>
              </div>
              <span className="text-[11px] text-[#991B1B] font-bold block">Flagged for team review</span>
            </div>

            {/* Green Box: Completed Clearance */}
            <div className="p-5 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-sm space-y-1.5 transition-all hover:bg-[#DCFCE7]/80">
              <span className="text-[#166534] font-sans block text-[11px] font-black uppercase tracking-wider">
                Completed Gate Clearance Outs
              </span>
              <div className="text-2xl sm:text-3xl font-black font-mono text-[#166534]">
                {completedGateOuts} <span className="text-base font-bold font-sans text-slate-600">Vehicles</span>
              </div>
              <span className="text-[11px] text-[#166534] font-bold block">Final out timestamp recorded</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicle #, token #..."
                className="w-full pl-10 pr-4 py-2.5 min-h-[44px] text-xs font-bold rounded-xl bg-[#FDFBF9] border border-[#C4B9A3] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none shadow-xs"
              />
            </div>
            <span className="text-xs font-extrabold text-[#334155] self-end sm:self-center">
              Audited Records: <strong className="font-mono text-[#111311]">{filteredLogs.length}</strong>
            </span>
          </div>

          {/* SECURITY AUDIT LEDGER TABLE */}
          <div className="p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-4 text-[#111311]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#EAE4D5]">
              <h3 className="text-sm font-black text-[#111311]">
                Guard Team Station Timestamps & Transit Durations
              </h3>
              <span className="text-[10px] font-black text-[#991B1B] bg-[#FEF2F2] px-2.5 py-1 rounded-lg border border-[#FECACA] self-start sm:self-auto">
                Auto-Alerts Enabled (&gt;15m Gate-to-Lab)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#C4B9A3] bg-[#FDFBF9]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-[#EFE9D9]/60 border-b border-[#C4B9A3] text-[#111311] font-sans font-black uppercase text-[10px] tracking-wider whitespace-nowrap">
                    <th className="p-3">Date</th>
                    <th className="p-3">Vehicle #</th>
                    <th className="p-3">Token #</th>
                    <th className="p-3">IGP Time (Gate 2)</th>
                    <th className="p-3">1st Weight Time</th>
                    <th className="p-3">2nd Weight Time</th>
                    <th className="p-3">Out-from-Gate</th>
                    <th className="p-3 text-right">Gate-to-Gate Duration</th>
                    <th className="p-3 text-center">Transit Delay Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5] font-bold text-[#111311]">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500 font-sans font-bold">
                        No security audit records found.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const transitMins = getMinutesBetween(log.igp_time, log.sampling_time_start);
                      const hasTransitDelayAlert = transitMins !== null && transitMins > 15;
                      const totalGateMins = getMinutesBetween(log.igp_time, log.out_from_gate_time);

                      return (
                        <tr
                          key={`sec-mgr-log-${String(log.id)}`}
                          className={`hover:bg-[#EFE9D9]/40 transition-colors ${
                            hasTransitDelayAlert ? 'bg-[#FEF2F2] border-l-4 border-l-[#991B1B]' : ''
                          }`}
                        >
                          {/* Date */}
                          <td className="p-3 text-slate-600 font-semibold font-sans whitespace-nowrap">
                            {log.dispatch_date || log.created_at.split('T')[0]}
                          </td>

                          {/* Vehicle # */}
                          <td className="p-3 font-black text-[#111311] font-mono text-sm whitespace-nowrap">
                            {log.vehicle_number}
                          </td>

                          {/* Token # */}
                          <td className="p-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#EFF6FF] border border-[#BFDBFE] font-black text-[#1E40AF]">
                              {log.token_number || 'PENDING'}
                            </span>
                          </td>

                          {/* IGP Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.igp_time || '—'}
                          </td>

                          {/* 1st Weight Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.first_weight_time || '—'}
                          </td>

                          {/* 2nd Weight Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.second_weight_time || '—'}
                          </td>

                          {/* Out-from-Gate */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.out_from_gate_time || '—'}
                          </td>

                          {/* Gate-to-Gate Duration */}
                          <td className="p-3 text-right whitespace-nowrap">
                            <span className="font-black text-[#111311]">
                              {totalGateMins !== null ? `${totalGateMins} mins` : 'In Pipeline'}
                            </span>
                          </td>

                          {/* Transit Delay Alert */}
                          <td className="p-3 text-center whitespace-nowrap">
                            {hasTransitDelayAlert ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5 text-[#991B1B]" />
                                ⚠ Gate-to-Lab Delay ({transitMins}m)
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-sans font-semibold">Normal</span>
                            )}
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
    </div>
  );
};
