'use client';

import React from 'react';
import { MilkProcessLog, User } from '@core/types';
import { getLiveWaitStatus } from '@core/durations';
import { Clock, Eye, History, ShieldAlert, CheckCircle2, Lock, ChevronDown, ChevronUp, Radio, AlertTriangle } from 'lucide-react';

interface AdaptiveVehicleCardProps {
  log: MilkProcessLog;
  rankIndex: number;
  currentUser: User | null;
  currentTime: Date;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onInspectDetails: (log: MilkProcessLog) => void;
  onOpenAuditHistory: (log: MilkProcessLog) => void;
  onOpenQASampling?: (log: MilkProcessLog) => void;
  onOpenWeight?: (log: MilkProcessLog) => void;
  onOpenReception?: (log: MilkProcessLog) => void;
}

export const AdaptiveVehicleCard: React.FC<AdaptiveVehicleCardProps> = ({
  log,
  rankIndex,
  currentUser,
  currentTime,
  isCollapsed = false,
  onToggleCollapse,
  onInspectDetails,
  onOpenAuditHistory,
  onOpenQASampling,
  onOpenWeight,
  onOpenReception,
}) => {
  const liveWait = getLiveWaitStatus(log, currentTime);
  const isQAAccepted = log.calculated_status === 'Accepted';
  const isQARejected = log.calculated_status === 'Rejected';
  const isParallelOverrideActive = !!(log.parallel_override_active || log.status === 'Sampling_In_Progress');
  const isRMMbrtPending = !!log.rm_mbrt_pending;

  if (isCollapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        className={`p-2.5 rounded-xl border bg-[#FFFFFF] shadow-sm hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out cursor-pointer flex items-center justify-between text-xs ${
          isQARejected ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#EAE4D5]/80'
        }`}
      >
        <div className="flex items-center space-x-2 truncate">
          <span className="w-5 h-5 rounded-full bg-[#FDFBF9] text-[#111311] font-extrabold flex items-center justify-center text-[10px] shrink-0 font-mono border border-[#EAE4D5]/80">
            #{rankIndex + 1}
          </span>
          <span className="font-extrabold font-mono text-[#111311]">{log.vehicle_number}</span>
          <span className="text-[#334155] font-semibold truncate text-[11px]">• {log.zonal_contractor_name}</span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span className={`font-mono text-[10px] font-extrabold ${liveWait.isBottleneck ? 'text-[#991B1B]' : 'text-[#1E3A8A]'}`}>
            {liveWait.minutes}m
          </span>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border bg-[#FFFFFF] text-[#111311] shadow-sm space-y-3 flex flex-col justify-between transition-all duration-200 ease-in-out hover:bg-[#F4F0E6]/40 ${
        isQARejected
          ? 'border-[#FECACA] bg-[#FEF2F2]/60 ring-1 ring-[#FECACA]'
          : log.borderline_warning
          ? 'border-amber-400 bg-amber-50/50 ring-1 ring-amber-300'
          : 'border-[#EAE4D5]/80'
      }`}
    >
      {/* Top Card Rank & Portion Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 rounded-md bg-[#1E3A8A] text-white text-[10px] font-extrabold font-mono">
            #{rankIndex + 1} PRIORITY
          </span>
          <span className="px-2 py-0.5 rounded-md bg-[#FDFBF9] text-[#111311] border border-[#EAE4D5]/80 text-[10px] font-extrabold">
            {log.portion_number}
          </span>
        </div>

        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="p-1 rounded text-slate-500 hover:text-slate-800">
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Registration & Contractor Block */}
      <div>
        <h3 className="text-lg font-black font-mono tracking-tight text-[#111311]">
          {log.vehicle_number}
        </h3>
        <p className="text-xs font-bold text-[#334155] truncate">
          {log.zonal_contractor_name}
        </p>
      </div>

      {/* REJECTION WARNING BANNER & LOCK (Coral-Rose Tint) */}
      {isQARejected && (
        <div className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[10.5px] font-bold flex items-start space-x-2">
          <ShieldAlert className="w-4 h-4 text-[#991B1B] shrink-0 mt-0.5" />
          <div>
            <p className="font-extrabold uppercase text-[#991B1B]">VEHICLE LOCKED: REQUIRES CORRECTION CLEARANCE</p>
            <p className="text-[10px] text-[#991B1B]/80 font-semibold">{log.rejection_reasons || 'QA Lab Rejection'}</p>
          </div>
        </div>
      )}

      {/* PARALLEL LAB OVERRIDE WARNING BADGE */}
      {isParallelOverrideActive && (
        <div className="p-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-[10.5px] font-bold flex items-start space-x-2 animate-pulse">
          <Radio className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-extrabold uppercase text-amber-800">PARALLEL MBRT IN PROGRESS (OVERRIDE ACTIVE)</p>
            <p className="text-[10px] text-amber-700 font-semibold">1st Weight scale unblocked. Silo unloading frozen until 30-min MBRT saved.</p>
          </div>
        </div>
      )}

      {/* BORDERLINE WARNING BADGE */}
      {log.borderline_warning && !isQARejected && (
        <div className="p-2 rounded-lg bg-amber-100/70 border border-amber-300 text-amber-900 text-[10px] font-extrabold flex items-center space-x-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span>BORDERLINE SPEC (SNF {log.computed_sampling_snf ?? log.computed_dispatch_snf}% near 8.5% threshold)</span>
        </div>
      )}

      {/* ADAPTIVE 4-QUADRANT METADATA GRID */}
      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[11px] font-mono font-bold text-[#111311]">
        {log.status === 'Dispatched' && (
          <>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Gross Liters</span>
              <span>{log.dispatch_liters_gross != null ? `${log.dispatch_liters_gross.toLocaleString()} L` : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Dispatch Time</span>
              <span>{log.zonal_contractor_dispatch_time || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Dispatch Fat/SNF</span>
              <span>
                {log.dispatch_fat != null ? `${log.dispatch_fat}%` : '—'} /{' '}
                {log.computed_dispatch_snf != null ? `${log.computed_dispatch_snf}%` : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">13 TS</span>
              <span>{log.computed_dispatch_13ts_liters != null ? `${log.computed_dispatch_13ts_liters.toLocaleString()} L` : '—'}</span>
            </div>
          </>
        )}

        {(log.status === 'Token Issued' || log.status === 'Sampling' || log.status === 'Sampling_In_Progress' || log.status === 'PLANT_QA') && (
          <>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Token #</span>
              <span className="text-[#1E3A8A] font-black">{log.token_number || 'PENDING'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">IGP Arrival</span>
              <span>{log.igp_time || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Lab Fat / LR</span>
              <span>
                {log.sampling_fat != null ? `${log.sampling_fat}%` : '—'} /{' '}
                {log.sampling_lr != null ? `${log.sampling_lr}` : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">SNF / TS %</span>
              <span>
                {log.computed_sampling_snf != null ? `${log.computed_sampling_snf}%` : '—'} /{' '}
                {log.computed_sampling_ts != null ? `${log.computed_sampling_ts}%` : '—'}
              </span>
            </div>
          </>
        )}

        {(log.status === 'First Weight' || log.status === 'READY_FOR_GROSS' || log.status === 'GROSS_WEIGHED') && (
          <>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Gross Weight</span>
              <span>{log.first_weight_of_vehicle != null ? `${log.first_weight_of_vehicle.toLocaleString()} KG` : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">QA Disposition</span>
              <span className={isQAAccepted ? 'text-[#166534] font-extrabold' : isQARejected ? 'text-[#991B1B] font-extrabold' : 'text-slate-600 font-semibold'}>
                {log.calculated_status || 'PENDING'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Physical Liters</span>
              <span>{log.computed_plant_liters != null ? `${log.computed_plant_liters.toLocaleString()} L` : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">13 TS</span>
              <span>{log.computed_plant_13ts_liters != null ? `${log.computed_plant_13ts_liters.toLocaleString()} L` : '—'}</span>
            </div>
          </>
        )}

        {(log.status === 'Silo Reception' || log.status === 'Second Weight' || log.status === 'READY_FOR_UNLOADING' || log.status === 'UNLOADING' || log.status === 'READY_FOR_TARE' || log.status === 'TARE_WEIGHED' || log.status === 'READY_FOR_GATE_EXIT' || log.status === 'Completed' || log.status === 'COMPLETED') && (
          <>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Storage Tank ID</span>
              <span className="text-[#1E3A8A]">{log.silo_storage_id || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Physical Liters</span>
              <span>{log.computed_plant_liters != null ? `${log.computed_plant_liters.toLocaleString()} L` : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">13 TS</span>
              <span>{log.computed_plant_13ts_liters != null ? `${log.computed_plant_13ts_liters.toLocaleString()} L` : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9px]">Net Milk Received</span>
              <span>{log.computed_net_milk_weight != null ? `${log.computed_net_milk_weight.toLocaleString()} KG` : '—'}</span>
            </div>
          </>
        )}
      </div>

      {/* LIVE TICKING WAIT DURATION */}
      {log.status !== 'Completed' && (
        <div className="flex items-center justify-between text-xs font-bold text-slate-600 pt-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Station Duration:</span>
          </span>
          <span className={`font-mono font-black ${liveWait.isBottleneck ? 'text-[#991B1B]' : 'text-[#1E3A8A]'}`}>
            {liveWait.minutes} mins
          </span>
        </div>
      )}

      {/* CARD ACTION BUTTONS */}
      <div className="pt-2 border-t border-[#EAE4D5]/80 space-y-2">
        {(log.status === 'Sampling' || log.status === 'Sampling_In_Progress') && (currentUser?.role === 'QA_Operator' || currentUser?.role === 'QA' || currentUser?.role === 'Correction_Officer' || currentUser?.role === 'Admin') && (
          <button
            onClick={() => onOpenQASampling && onOpenQASampling(log)}
            className="w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-[#166534] hover:bg-emerald-800 text-white font-extrabold text-xs shadow-sm border border-emerald-900 transition-all duration-200 ease-in-out"
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span>{isParallelOverrideActive ? 'Save Complete MBRT (Clear Override)' : 'Log QA Tests'}</span>
          </button>
        )}

        {(log.status === 'First Weight' || (log.status === 'Sampling_In_Progress' && isParallelOverrideActive)) && (currentUser?.role === 'Production_Operator' || currentUser?.role === 'Security_Operator' || currentUser?.role === 'Correction_Officer' || currentUser?.role === 'Admin') && (
          <button
            onClick={() => !isQARejected && onOpenWeight && onOpenWeight(log)}
            disabled={isQARejected}
            className={`w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl font-extrabold text-xs shadow-sm border transition-all duration-200 ease-in-out ${
              isQARejected
                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                : 'bg-[#1E3A8A] hover:bg-blue-900 text-white border-blue-950'
            }`}
          >
            {isQARejected ? <Lock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-white" />}
            <span>{isQARejected ? 'VEHICLE LOCKED (QA REJECTED)' : 'Log 1st Weight'}</span>
          </button>
        )}

        {log.status === 'Silo Reception' && (currentUser?.role === 'Production_Operator' || currentUser?.role === 'Correction_Officer' || currentUser?.role === 'Admin') && (
          <button
            onClick={() => !isQARejected && !isRMMbrtPending && onOpenReception && onOpenReception(log)}
            disabled={isQARejected || isRMMbrtPending}
            className={`w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl font-extrabold text-xs shadow-sm border transition-all duration-200 ease-in-out ${
              isQARejected || isRMMbrtPending
                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                : 'bg-[#1E3A8A] hover:bg-blue-900 text-white border-blue-950'
            }`}
          >
            {isQARejected || isRMMbrtPending ? <Lock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-white" />}
            <span>{isQARejected ? 'VEHICLE LOCKED (QA REJECTED)' : isRMMbrtPending ? 'SILO FROZEN (MBRT PENDING)' : 'Log Silo Reception'}</span>
          </button>
        )}

        {/* Inspect Details & Audit Buttons */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => onInspectDetails(log)}
            className="flex-1 flex items-center justify-center space-x-1 py-1.5 px-2 rounded-lg text-xs font-extrabold bg-[#FDFBF9] hover:bg-[#F4F0E6]/60 text-[#111311] border border-[#EAE4D5]/80 transition-all duration-200 ease-in-out"
          >
            <Eye className="w-3.5 h-3.5 text-[#1E3A8A]" />
            <span>Inspect Details</span>
          </button>

          <button
            onClick={() => onOpenAuditHistory(log)}
            className="p-1.5 rounded-lg text-slate-600 hover:bg-[#FDFBF9] border border-[#EAE4D5]/80 transition-all duration-200 ease-in-out"
            title="View Audit Trail History"
          >
            <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
          </button>
        </div>
      </div>
    </div>
  );
};
