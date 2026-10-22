'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, MapPin, Plus, Search, UserPlus, Users } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { ZmccDrawer, zmccInputClass, zmccLabelClass } from '../shared/ZmccDrawer';
import type { useHcArrivalForm } from './useHcArrivalForm';
import type { HcSupplierRow } from './arrivalTypes';

interface Props {
  form: ReturnType<typeof useHcArrivalForm>;
  localSuppliers: HcSupplierRow[];
  loadingLocalSuppliers: boolean;
  onAddSupplier: () => void;
  onCaptureGps: () => void;
}

export const HcArrivalPanel: React.FC<Props> = ({
  form,
  localSuppliers,
  loadingLocalSuppliers,
  onAddSupplier,
  onCaptureGps,
}) => {
  const localSupplierSuccessResult = form.successResult;
  const supplierSearchTerm = form.supplierSearchTerm;
  const selectedLocalSupplierId = form.selectedLocalSupplierId;
  const localSupplierGps = form.gps;
  return (
    <div className="max-w-xl mx-auto bg-white rounded-xl border border-emerald-200 p-6 shadow-2xs space-y-4 animate-panel-in">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-100 pb-3">
        <div className="flex items-center space-x-2">
          <Users className="w-5 h-5 text-emerald-700" />
          <h3 className="text-sm font-semibold text-slate-900">HC Arrival at ZMCC</h3>
        </div>
        <button
          type="button"
          onClick={onAddSupplier}
          className="flex items-center space-x-1 min-h-[44px] px-3 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5 text-emerald-700" />
          <span>+ Add HC Supplier</span>
        </button>
      </div>

      {localSupplierSuccessResult ? (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <div>
                  <h4 className="text-sm font-semibold">HC Arrival Recorded!</h4>
                  <span className="text-xs text-emerald-700">The milk source is chosen later, when the milk is unloaded to the tank.</span>
                </div>
              </div>

              <div className="space-y-2 text-xs divide-y divide-emerald-200/60 pt-2">
                <div className="pb-1.5">
                  ZMCC Token: <strong className="tabular-nums text-emerald-900 text-sm font-semibold">{localSupplierSuccessResult.zmcc_token}</strong>
                </div>
                <div className="py-1.5">
                  Raw Milk Token: <strong className="tabular-nums text-slate-800">{localSupplierSuccessResult.raw_milk_token_number || '—'}</strong>
                  {localSupplierSuccessResult.rmr_number && (
                    <span className="text-slate-500 text-xs ml-2">
                      (Legacy RMR: <strong className="tabular-nums text-slate-700">{localSupplierSuccessResult.rmr_number}</strong>)
                    </span>
                  )}
                </div>
                <div className="py-1.5">
                  Vehicle: <strong className="tabular-nums text-slate-800">{localSupplierSuccessResult.vehicle_number}</strong>
                </div>
                <div className="py-1.5">
                  Supplier: <strong className="text-slate-900">{localSupplierSuccessResult.local_supplier?.name}</strong>{' '}
                  <span className="text-slate-500 tabular-nums text-xs">({localSupplierSuccessResult.local_supplier?.local_supplier_code})</span>
                </div>
                <div className="pt-1.5">
                  Arrival Date: <strong className="text-slate-800">{localSupplierSuccessResult.arrival_date}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  form.setSuccessResult(null);
                  form.reset();
                }}
                className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Record Another HC Supplier
              </button>
            </div>
      ) : (
        <button
          type="button"
          onClick={() => form.setFormOpen(true)}
          className="w-full min-h-[48px] py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold cursor-pointer"
        >
          Record HC Arrival
        </button>
      )}

      <ZmccDrawer
        open={form.formOpen && !localSupplierSuccessResult}
        onClose={() => form.setFormOpen(false)}
        title="Record HC Arrival at ZMCC"
        icon={<Users className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />}
      >
        <form onSubmit={form.submit} className="space-y-4">
              {form.error && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{form.error}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    HC Supplier <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={onAddSupplier}
                    className="min-h-[44px] px-2 text-xs font-semibold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Quick Add Supplier</span>
                  </button>
                </div>
                <Combobox
                  options={[
                    ...localSuppliers.filter((s) => s.approval_status === 'ACTIVE'),
                    ...localSuppliers.filter((s) => s.id === selectedLocalSupplierId && s.approval_status !== 'ACTIVE'),
                  ].map((s) => ({
                    value: s.id,
                    label: `${s.local_supplier_code} · ${s.name}`,
                    keywords: `${s.local_supplier_code} ${s.name} ${s.phone || ''} ${s.cnic || ''}`,
                  }))}
                  value={selectedLocalSupplierId}
                  onValueChange={form.setSelectedLocalSupplierId}
                  placeholder="Select active supplier…"
                  searchPlaceholder="Search by code, name, phone…"
                  className="min-h-[44px] w-full text-xs font-semibold"
                />
                {localSuppliers.some((s) => s.id === selectedLocalSupplierId && s.approval_status === 'PENDING_APPROVAL') && (
                  <p className="text-xs text-amber-700 mt-1">
                    This HC is waiting for Zonal Manager approval. You cannot receive milk from it yet.
                  </p>
                )}
                {localSuppliers.length === 0 && !loadingLocalSuppliers && (
                  <p className="text-xs text-amber-700 mt-1">
                    No suppliers in directory yet. Click &quot;+ Quick Add Supplier&quot; above to onboard the first one.
                  </p>
                )}
              </div>

              <div>
                <label className={zmccLabelClass}>
                  Raw Milk Token No. <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={100}
                  value={form.rawMilkTokenNumber}
                  onChange={(e) => form.setRawMilkTokenNumber(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 001924"
                  required
                  className={`${zmccInputClass} font-semibold tabular-nums`}
                />
              </div>

              <div>
                <label className={zmccLabelClass}>
                  Vehicle Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.vehicleNumber}
                  onChange={(e) => form.setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. LES-4029"
                  required
                  className={`${zmccInputClass} font-semibold tabular-nums uppercase`}
                />
              </div>

              <div>
                <label className={zmccLabelClass}>
                  Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={form.arrivalTimestamp}
                  onChange={(e) => form.setArrivalTimestamp(e.target.value)}
                  required
                  className={`${zmccInputClass} font-semibold`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">PHE GPS Coordinates (Optional)</label>
                  <button
                    type="button"
                    onClick={() => onCaptureGps()}
                    className="min-h-[44px] px-2 text-xs font-semibold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Capture GPS</span>
                  </button>
                </div>
                <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border tabular-nums">
                  {localSupplierGps.lat != null ? (
                    <span>Lat: {localSupplierGps.lat}, Lng: {localSupplierGps.lng} (±{localSupplierGps.acc}m)</span>
                  ) : (
                    <span className="text-slate-400">GPS not captured yet</span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={form.submitting}
                className="w-full min-h-[44px] py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                {form.submitting ? 'Recording Arrival…' : 'Record HC Arrival & Generate Token'}
              </button>
        </form>
      </ZmccDrawer>
    </div>
  );
};
