'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ShieldCheck, Search, AlertTriangle, Lock, RefreshCw } from 'lucide-react';

export const SecurityManager: React.FC = () => {
  const [theme, setTheme] = useState<'creamy' | 'night'>('creamy');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchLogs]);

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

  const filteredLogs = logs.filter((log) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        log.vehicle_number.toLowerCase().includes(q) ||
        (log.token_number && log.token_number.toLowerCase().includes(q)) ||
        log.zonal_contractor_name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Calculate Security Performance Metrics
  const totalGateEntries = logs.filter((l) => l.igp_time).length;
  const delayedTransitCount = logs.filter((l) => {
    const transitMins = getMinutesBetween(l.igp_time, l.sampling_time_start);
    return transitMins !== null && transitMins > 15;
  }).length;
  const completedGateOuts = logs.filter((l) => l.out_from_gate_time).length;

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-[#FDFBF9] text-[#111311] flex flex-row font-sans">
      <Sidebar
        currentUser={currentUser}
        activeCount={logs.filter((l) => l.status !== 'Completed').length}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          currentUser={currentUser}
          currentTheme={theme}
          onToggleTheme={() => setTheme(theme === 'creamy' ? 'night' : 'creamy')}
          title="Security Audit & Performance Monitor"
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-6">
          {/* Top Header Panel */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm">
            <div>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-6 h-6 text-[#1E3A8A]" />
                <h1 className="text-xl font-extrabold tracking-tight text-[#111311]">
                  Security Manager Time Audit & Gate Performance Monitor
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white flex items-center gap-1">
                  <Lock className="w-3 h-3" /> READ-ONLY AUDIT CONSOLE
                </span>
              </div>
              <p className="text-xs text-[#334155] font-semibold mt-0.5">
                Read-only monitoring dashboard tracking Gate 2 entry tokens, weighbridge timestamps, and plant transit bottlenecks.
              </p>
            </div>

            <button
              onClick={() => fetchLogs()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>Refresh Audit Log</span>
            </button>
          </div>

          {/* SECURITY AUDIT METRIC CARDS WITH PASTEL GRADIENTS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Blue Box: Gate Entries */}
            <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-sm space-y-1 transition-all duration-200 ease-in-out hover:bg-[#DBEAFE]/80">
              <span className="text-[#1E40AF] font-sans block text-[10px] font-extrabold uppercase">
                Total Gate 2 IGP Entries
              </span>
              <div className="text-2xl font-black font-mono text-[#111311]">
                {totalGateEntries} Vehicles
              </div>
              <span className="text-[10px] text-[#1E40AF] font-bold">Issued entry tokens</span>
            </div>

            {/* Red Alert Box: Delays */}
            <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] shadow-sm space-y-1 transition-all duration-200 ease-in-out hover:bg-[#FEE2E2]/80">
              <span className="text-[#991B1B] font-sans block text-[10px] font-extrabold uppercase">
                Gate-to-Lab Transit Delays (&gt;15 mins)
              </span>
              <div className="text-2xl font-black font-mono text-[#991B1B] flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-[#991B1B]" />
                <span>{delayedTransitCount} Delays</span>
              </div>
              <span className="text-[10px] text-[#991B1B] font-bold">Flagged for team review</span>
            </div>

            {/* Green Box: Completed Clearance */}
            <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-sm space-y-1 transition-all duration-200 ease-in-out hover:bg-[#DCFCE7]/80">
              <span className="text-[#166534] font-sans block text-[10px] font-extrabold uppercase">
                Completed Gate Clearance Outs
              </span>
              <div className="text-2xl font-black font-mono text-[#166534]">
                {completedGateOuts} Vehicles
              </div>
              <span className="text-[10px] text-[#166534] font-bold">Final out timestamp recorded</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm flex items-center justify-between gap-3">
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
            <span className="text-xs font-bold text-[#334155]">
              Audited Records: <strong className="font-mono text-[#111311]">{filteredLogs.length}</strong>
            </span>
          </div>

          {/* SECURITY AUDIT LEDGER TABLE */}
          <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4 text-[#111311]">
            <div className="flex items-center justify-between pb-2 border-b border-[#EAE4D5]/80">
              <h3 className="text-sm font-extrabold text-[#111311]">
                Guard Team Station Timestamps & Transit Durations
              </h3>
              <span className="text-[10px] font-bold text-[#991B1B] bg-[#FEF2F2] px-2.5 py-0.5 rounded border border-[#FECACA]">
                Auto-Alerts Enabled (&gt;15m Gate-to-Lab)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#EAE4D5]/80 bg-[#FDFBF9]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 text-[#111311] font-sans font-extrabold uppercase text-[10px] tracking-wider">
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
                <tbody className="divide-y divide-[#EAE4D5]/80 font-bold text-[#111311]">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500 font-sans">
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
                          className={`hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out ${
                            hasTransitDelayAlert ? 'bg-[#FEF2F2]/80 border-l-4 border-l-[#991B1B]' : ''
                          }`}
                        >
                          {/* Date */}
                          <td className="p-3 text-slate-600 font-semibold font-sans">
                            {log.dispatch_date || log.created_at.split('T')[0]}
                          </td>

                          {/* Vehicle # */}
                          <td className="p-3 font-black text-[#111311] font-mono text-sm">
                            {log.vehicle_number}
                          </td>

                          {/* Token # */}
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#EFF6FF] border border-[#BFDBFE] font-black text-[#1E40AF]">
                              {log.token_number || 'PENDING'}
                            </span>
                          </td>

                          {/* IGP Time */}
                          <td className="p-3 text-slate-700">
                            {log.igp_time || '—'}
                          </td>

                          {/* 1st Weight Time */}
                          <td className="p-3 text-slate-700">
                            {log.first_weight_time || '—'}
                          </td>

                          {/* 2nd Weight Time */}
                          <td className="p-3 text-slate-700">
                            {log.second_weight_time || '—'}
                          </td>

                          {/* Out-from-Gate */}
                          <td className="p-3 text-slate-700">
                            {log.out_from_gate_time || '—'}
                          </td>

                          {/* Gate-to-Gate Duration */}
                          <td className="p-3 text-right">
                            <span className="font-extrabold text-[#111311]">
                              {totalGateMins !== null ? `${totalGateMins} mins` : 'In Pipeline'}
                            </span>
                          </td>

                          {/* Transit Delay Alert */}
                          <td className="p-3 text-center">
                            {hasTransitDelayAlert ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5 text-[#991B1B]" />
                                ⚠ Gate-to-Lab Transit Delay ({transitMins}m)
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
