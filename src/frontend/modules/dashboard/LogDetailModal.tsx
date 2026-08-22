'use client';

import React from 'react';
import { MilkProcessLog, User } from '@core/types';
import { calculateStageDurations } from '@core/durations';
import { X, Truck, FlaskConical, Scale, Factory, ShieldCheck, ShieldAlert, Info, Lock } from 'lucide-react';

interface LogDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  log: MilkProcessLog | null;
  currentUser?: User | null;
}

export const LogDetailModal: React.FC<LogDetailModalProps> = ({
  isOpen,
  onClose,
  log,
  currentUser,
}) => {
  if (!isOpen || !log) return null;

  const userZone = currentUser?.zone || 'ZMCC Hasilpur';
  const isZonalManager = currentUser?.role === 'MPD_Zone_Manager';
  const isAccessDenied = isZonalManager && log.zonal_contractor_name !== userZone;

  const durations = calculateStageDurations(log);
  const isQARejected = log.calculated_status === 'Rejected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#FDFBF7] text-[#111311] rounded-2xl shadow-2xl border border-[#EAE4D5]/80 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#EAE4D5]/80 bg-[#FDFBF7]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-sm">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-black font-mono tracking-tight text-black">{log.vehicle_number}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#FFFFFF] border border-[#EAE4D5]/80 text-[#111311]">
                  {log.portion_number}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-[#1E3A8A] text-white">
                  {log.status}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-bold">{log.zonal_contractor_name} | Token #{log.token_number || 'PENDING'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-black transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SECURITY CHECK: ACCESS DENIED LAYOUT FOR COMPETING ZONES */}
        {isAccessDenied ? (
          <div className="p-8 text-center space-y-4 bg-[#FFFFFF]">
            <div className="inline-flex p-4 rounded-full bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B]">
              <Lock className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-extrabold text-[#991B1B] uppercase">ACCESS DENIED: ZONE RESTRICTION</h4>
              <p className="text-xs font-semibold text-slate-700 max-w-md mx-auto">
                You are authenticated as <span className="font-black text-black font-mono">{userZone}</span>. You do not have permission to view end-to-end plant journey metrics for vehicles belonging to competing procurement networks ({log.zonal_contractor_name}).
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-[#111311] text-white hover:bg-slate-800 font-extrabold text-xs shadow-sm transition"
            >
              Back to Zonal History
            </button>
          </div>
        ) : (
          /* Content Body: FULL END-TO-END PIPELINE JOURNEY */
          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto font-mono text-xs">
            {/* QA Rejection Lock Warning */}
            {isQARejected && (
              <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] flex items-start space-x-3">
                <ShieldAlert className="w-5 h-5 text-[#991B1B] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-extrabold text-sm uppercase text-[#991B1B]">VEHICLE LOCKED: QA REJECTED</h4>
                  <p className="text-xs font-semibold mt-0.5 text-[#991B1B]/90">{log.rejection_reasons || 'Failed quality specs.'}</p>
                </div>
              </div>
            )}

            {/* 1. MPD Field Dispatch Block */}
            <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 font-sans font-extrabold text-sm text-black">
                <Truck className="w-4 h-4 text-[#1E3A8A]" />
                <span>1. MPD Field Dispatch Details</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-black font-black">
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Dispatch Date/Time</span>
                  <span className="text-black">{log.dispatch_date || '—'} {log.zonal_contractor_dispatch_time || ''}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Gross Liters</span>
                  <span className="text-black">{log.dispatch_liters_gross != null ? `${log.dispatch_liters_gross.toLocaleString()} L` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Dispatch Fat / LR</span>
                  <span className="text-black">{log.dispatch_fat != null ? `${log.dispatch_fat}%` : '—'} / {log.dispatch_lr != null ? `${log.dispatch_lr}` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">SNF % / 13 TS</span>
                  <span className="text-black">{log.computed_dispatch_snf != null ? `${log.computed_dispatch_snf}%` : '—'} / {log.computed_dispatch_13ts_liters != null ? `${log.computed_dispatch_13ts_liters.toLocaleString()} L` : '—'}</span>
                </div>
              </div>
            </div>

            {/* 2. Security Gate & Token Block */}
            <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 font-sans font-extrabold text-sm text-black">
                <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
                <span>2. Security Gate 2 Entry & Token</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-black font-black">
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Token Issued</span>
                  <span className="text-[#1E3A8A] font-black">{log.token_number || 'PENDING'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">IGP Timestamp</span>
                  <span className="text-black">{log.igp_date || ''} {log.igp_time || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Gate Out Timestamp</span>
                  <span className="text-black">{log.out_from_gate_time || 'In Plant'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Gate-to-Gate Duration</span>
                  <span className="text-black">{durations.totalGateToGateTime || 'In Progress'}</span>
                </div>
              </div>
            </div>

            {/* 3. QA Lab Chemical & MBRT Block */}
            <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 font-sans font-extrabold text-sm text-black">
                <FlaskConical className="w-4 h-4 text-[#166534]" />
                <span>3. QA Lab Chemical & MBRT Analysis</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-black font-black">
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Lab Fat / LR</span>
                  <span className="text-black">{log.sampling_fat != null ? `${log.sampling_fat}%` : '—'} / {log.sampling_lr != null ? `${log.sampling_lr}` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">SNF % / TS %</span>
                  <span className="text-black">{log.computed_sampling_snf != null ? `${log.computed_sampling_snf}%` : '—'} / {log.computed_sampling_ts != null ? `${log.computed_sampling_ts}%` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">MBRT Minutes</span>
                  <span className="text-black">{log.b_mbrt_minutes_test != null ? `${log.b_mbrt_minutes_test} mins` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">QA Disposition</span>
                  <span className={isQARejected ? 'text-[#991B1B] font-black' : 'text-[#166534] font-black'}>
                    {log.calculated_status || 'PENDING'}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Weighbridge Scale Block (INCLUDES PLANT 13% TS LITERS METRIC) */}
            <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 font-sans font-extrabold text-sm text-black">
                <Scale className="w-4 h-4 text-[#6B21A8]" />
                <span>4. Weighbridge Scale Measurements</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-black font-black">
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Gross Weight</span>
                  <span className="text-black">{log.first_weight_of_vehicle != null ? `${log.first_weight_of_vehicle.toLocaleString()} KG` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Second Weight</span>
                  <span className="text-black">{log.second_weight_of_vehicle != null ? `${log.second_weight_of_vehicle.toLocaleString()} KG` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Net Milk Received</span>
                  <span className="text-[#1E3A8A] font-black">{log.computed_net_milk_weight != null ? `${log.computed_net_milk_weight.toLocaleString()} KG` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">Physical Liters</span>
                  <span className="text-[#166534] font-black">{log.computed_plant_liters != null ? `${log.computed_plant_liters.toLocaleString()} L` : '—'}</span>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px] font-sans font-bold block">13 TS</span>
                  <span className="text-[#6B21A8] font-black">{log.computed_plant_13ts_liters != null ? `${log.computed_plant_13ts_liters.toLocaleString()} L` : '—'}</span>
                </div>
              </div>
            </div>

            {/* 5. Production Silo Milk Offloading Block (HIDDEN FOR MPD_ZONE_MANAGER / CONTRACTOR ROLE) */}
            {!isZonalManager && (
              <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-3 shadow-sm">
                <div className="flex items-center space-x-2 font-sans font-extrabold text-sm text-black">
                  <Factory className="w-4 h-4 text-[#1E3A8A]" />
                  <span>5. Production Silo Milk Offloading</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-black font-black">
                  <div>
                    <span className="text-slate-600 text-[10px] font-sans font-bold block">Storage Silo ID</span>
                    <span className="text-[#1E3A8A] font-black">{log.silo_storage_id || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-600 text-[10px] font-sans font-bold block">Reception Start/End</span>
                    <span className="text-black">{log.reception_start_time || '—'} - {log.reception_end_time || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-600 text-[10px] font-sans font-bold block">Unloading Duration</span>
                    <span className="text-black">{durations.unloadingDuration || '—'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#EAE4D5]/80 bg-[#FDFBF7] text-xs font-bold text-slate-600">
          <div className="flex items-center space-x-1.5">
            <Info className="w-4 h-4 text-[#1E3A8A]" />
            <span>MilkReception Enterprise System • End-to-End Audit Log</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#111311] text-white hover:bg-slate-800 transition shadow-sm font-extrabold"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
