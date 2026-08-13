'use client';

import React, { useState } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { Search, ShieldCheck, Ticket, Truck, Eye } from 'lucide-react';

interface SecurityWorkforceTableProps {
  logs: MilkProcessLog[];
  onInspectDetails?: (log: MilkProcessLog) => void;
  currentUser?: User | null;
  isSecurityManager?: boolean;
}

export const SecurityWorkforceTable: React.FC<SecurityWorkforceTableProps> = ({
  logs,
  onInspectDetails,
  currentUser,
  isSecurityManager: propIsSecurityManager,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const isSecurityManager = propIsSecurityManager ?? (currentUser?.role === 'Security_Manager');

  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to calculate minutes between two HH:mm strings
  const getMinutesBetween = (timeA?: string | null, timeB?: string | null): number | null => {
    if (!timeA || !timeB) return null;
    const [hA, mA] = timeA.split(':').map(Number);
    const [hB, mB] = timeB.split(':').map(Number);
    if (isNaN(hA) || isNaN(mA) || isNaN(hB) || isNaN(mB)) return null;

    const minsA = hA * 60 + mA;
    const minsB = hB * 60 + mB;
    const diff = minsB - minsA;
    return diff >= 0 ? diff : diff + 1440;
  };

  // Metrics for Isolated Gate Delay Summary Banner
  const totalTokensIssuedToday = logs.filter(
    (l) => l.token_number && (l.igp_date === todayStr || l.dispatch_date === todayStr || l.created_at.split('T')[0] === todayStr)
  ).length;

  const totalActiveVehiclesInsideGates = logs.filter(
    (l) => l.token_number && !l.out_from_gate_time
  ).length;

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

  return (
    <div className="space-y-6">
      {/* ISOLATED GATE DELAY SUMMARY BANNER WITH PASTEL GRADIENT SPECIFICATIONS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Blue Box: Tokens Issued */}
        <div className="p-5 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#DBEAFE]/80">
          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#1E40AF]">
              Total Tokens Issued Today
            </span>
            <div className="text-3xl font-black font-mono text-[#111311]">
              {totalTokensIssuedToday}
            </div>
            <span className="text-[10px] font-bold text-[#1E40AF]">Gate 2 Passes Generated</span>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#BFDBFE] text-[#1E40AF]">
            <Ticket className="w-6 h-6" />
          </div>
        </div>

        {/* Green Box: Active Vehicles */}
        <div className="p-5 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-sm flex items-center justify-between transition-all duration-200 ease-in-out hover:bg-[#DCFCE7]/80">
          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#166534]">
              Total Active Vehicles Inside Gates
            </span>
            <div className="text-3xl font-black font-mono text-[#111311]">
              {totalActiveVehiclesInsideGates}
            </div>
            <span className="text-[10px] font-bold text-[#166534]">Currently On Plant Grounds</span>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#BBF7D0] text-[#166534]">
            <Truck className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* SEARCH BAR */}
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
        <span className="text-xs font-extrabold text-[#334155]">
          Audited Gate Records: <strong className="font-mono text-[#111311]">{filteredLogs.length}</strong>
        </span>
      </div>

      {/* SECURITY TEAM WORKFORCE HISTORY TABLE */}
      <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4 text-[#111311]">
        <div className="flex items-center justify-between pb-2 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-[#1E3A8A]" />
            <h3 className="text-sm font-extrabold text-[#111311]">
              Security Guard Team Gate Milestone History Ledger
            </h3>
          </div>
          <span className="text-[10px] font-bold text-[#1E40AF] bg-[#EFF6FF] px-2.5 py-0.5 rounded border border-[#BFDBFE]">
            Read-Only Guard Logs
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#EAE4D5]/80 bg-[#FDFBF9]">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 text-[#111311] font-sans font-extrabold uppercase text-[10px] tracking-wider">
                <th className="p-3">Date</th>
                <th className="p-3">Vehicle #</th>
                <th className="p-3">Token #</th>
                <th className="p-3">IGP Time (Gate 2 Entry)</th>
                <th className="p-3">1st Weight Time</th>
                <th className="p-3">2nd Weight Time</th>
                <th className="p-3">Out-from-Gate Time</th>
                <th className="p-3 text-right">Gate-to-Gate Duration</th>
                <th className="p-3 text-center">Security Operator ID</th>
                {!isSecurityManager && <th className="p-3 text-center">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/80 font-bold text-[#111311]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={isSecurityManager ? 9 : 10} className="p-8 text-center text-slate-500 font-sans">
                    No security milestone records found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const transitMins = getMinutesBetween(log.igp_time, log.sampling_time_start);
                  const hasTransitDelayAlert = transitMins !== null && transitMins > 15;
                  const totalGateMins = getMinutesBetween(log.igp_time, log.out_from_gate_time);
                  const operatorId = log.token_number ? `SEC-GATE-${(log.id % 4) + 1}` : 'SYS-AUTO';

                  return (
                    <tr
                      key={`sec-workforce-log-${String(log.id)}`}
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
                        {hasTransitDelayAlert && (
                          <span className="block mt-1 text-[9px] font-black uppercase text-[#991B1B] bg-[#FEF2F2] px-1.5 py-0.5 rounded border border-[#FECACA] w-max">
                            ⚠ Gate-to-Lab Transit Delay ({transitMins}m)
                          </span>
                        )}
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

                      {/* Out-from-Gate Time */}
                      <td className="p-3 text-slate-700">
                        {log.out_from_gate_time || '—'}
                      </td>

                      {/* Gate-to-Gate Duration */}
                      <td className="p-3 text-right">
                        <span className="font-extrabold text-[#111311]">
                          {totalGateMins !== null ? `${totalGateMins} mins` : 'In Pipeline'}
                        </span>
                      </td>

                      {/* Security Operator ID */}
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-[#FDFBF9] border border-[#EAE4D5]/80 font-mono font-bold text-slate-700">
                          {operatorId}
                        </span>
                      </td>

                      {/* Action Cell */}
                      {!isSecurityManager && (
                        <td className="p-3 text-center">
                          <button
                            onClick={() => onInspectDetails && onInspectDetails(log)}
                            className="px-2.5 py-1 rounded-lg bg-[#FDFBF9] hover:bg-[#F4F0E6]/60 text-[#111311] border border-[#EAE4D5]/80 font-sans text-[10px] font-extrabold transition-all duration-200 ease-in-out inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#1E3A8A]" />
                            <span>Audit</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
