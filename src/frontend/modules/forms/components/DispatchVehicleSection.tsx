'use client';

import React from 'react';
import { Clock, Truck, Activity } from 'lucide-react';
import {
  QuantityUnit,
  MeasurementBasis,
} from '@/backend/modules/dispatch/quantity-policy/types';
import {
  calculateDensity,
  calculateGrossLiters,
  calculateSNF,
  calculateTS,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';

export type QuantityUnitType = QuantityUnit;
export type MeasurementBasisType = MeasurementBasis;

export interface QuantityState {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface DispatchVehicleSectionProps {
  isSourceBound: boolean;
  availableSources: Array<{ id: string; name: string; source_type: string }>;
  selectedSourceId: string;
  onSelectSourceId: (id: string) => void;
  vehicleNumber: string;
  onVehicleNumberChange: (value: string) => void;
  vehicleNumberError: string | null;
  dispatchOpDatetime: string;
  onDispatchOpDatetimeChange: (value: string) => void;
  maxDatetime: string;
  isPolicyReady: boolean;
  vehicleQuantity: QuantityState;
  onVehicleQuantityValueChange: (value: string) => void;
  onVehicleUnitChange: (unit: QuantityUnitType) => void;
  onVehicleBasisChange: (basis: MeasurementBasisType) => void;
  vehicleAllowedUnits: QuantityUnitType[];
  vehicleAllowedBases: MeasurementBasisType[];
  vehicleQuantityError: string | null;
  sourceType?: string;
  vehicleLr?: string;
  onVehicleLrChange?: (value: string) => void;
  vehicleFat?: string;
  onVehicleFatChange?: (value: string) => void;
}

export const DispatchVehicleSection: React.FC<DispatchVehicleSectionProps> = ({
  isSourceBound,
  availableSources,
  selectedSourceId,
  onSelectSourceId,
  vehicleNumber,
  onVehicleNumberChange,
  vehicleNumberError,
  dispatchOpDatetime,
  onDispatchOpDatetimeChange,
  maxDatetime,
  isPolicyReady,
  vehicleQuantity,
  onVehicleQuantityValueChange,
  onVehicleUnitChange,
  onVehicleBasisChange,
  vehicleAllowedUnits,
  vehicleAllowedBases,
  vehicleQuantityError,
  sourceType,
  vehicleLr,
  onVehicleLrChange,
  vehicleFat,
  onVehicleFatChange,
}) => {
  const numQty = parseFloat(vehicleQuantity.value);
  const numLr = vehicleLr ? parseFloat(vehicleLr) : NaN;
  const numFat = vehicleFat ? parseFloat(vehicleFat) : NaN;

  const previewDensity = !isNaN(numLr) && numLr > 0 ? calculateDensity(numLr) : null;
  const previewGrossLiters = !isNaN(numQty) && numQty > 0
    ? calculateGrossLiters(numQty, vehicleQuantity.unit, !isNaN(numLr) ? numLr : null)
    : null;
  const previewSnf = !isNaN(numLr) && !isNaN(numFat) && numLr > 0 && numFat >= 0
    ? calculateSNF(numLr, numFat)
    : null;
  const previewTs = previewSnf !== null && !isNaN(numFat) && numFat >= 0
    ? calculateTS(numFat, previewSnf)
    : null;
  const previewAt13ts = previewGrossLiters !== null && previewTs !== null
    ? calculateAt13TSLiters(previewGrossLiters, previewTs)
    : null;

  return (
    <div className="space-y-4">
      {/* Global Source Selector if user is NOT source-bound (e.g. Admin) */}
      {!isSourceBound && availableSources.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-300/80 text-xs space-y-1.5 shadow-sm">
          <label className="block font-bold text-amber-950">
            Select Operating Procurement Source (Admin Override):
          </label>
          <select
            value={selectedSourceId}
            onChange={(e) => onSelectSourceId(e.target.value)}
            className="w-full h-11 px-3.5 font-bold rounded-xl border border-amber-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
          >
            <option value="">-- Select Procurement Source --</option>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.source_type})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Notice when unbound admin has not yet selected a source */}
      {!isSourceBound && !selectedSourceId && (
        <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
          Please select an operating procurement source from the dropdown above to initialize the dispatch draft.
        </div>
      )}

      {/* Vehicle Registration & Timestamp Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-4">
        <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
          <Truck className="w-4 h-4 text-[#1E40AF]" />
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
            Vehicle & Dispatch Time
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label htmlFor="vehicle-number-input" className="block text-xs font-bold text-[#111311]">
              Vehicle No. *
            </label>
            <input
              id="vehicle-number-input"
              type="text"
              value={vehicleNumber}
              onChange={(e) => onVehicleNumberChange(e.target.value)}
              placeholder="e.g. KBL-8492"
              className={`w-full h-11 px-3.5 text-sm font-mono font-bold rounded-xl border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition ${
                vehicleNumberError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-[#C4B9A3]'
              }`}
              required
            />
            {vehicleNumberError && (
              <p className="text-xs font-bold text-rose-600 mt-1" id="vehicle-number-error">
                {vehicleNumberError}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="dispatch-time-input" className="block text-xs font-bold text-[#111311] flex items-center justify-between">
              <span>Dispatch Time *</span>
              <Clock className="w-3.5 h-3.5 text-[#1E40AF]" />
            </label>
            <input
              id="dispatch-time-input"
              type="datetime-local"
              value={dispatchOpDatetime}
              max={maxDatetime}
              onChange={(e) => onDispatchOpDatetimeChange(e.target.value)}
              className="w-full h-11 px-3.5 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition"
              required
            />
          </div>
        </div>
      </div>

      {/* Whole-Vehicle Dispatch Quantity Section */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2 gap-1">
          <label className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
            {sourceType === 'ZMCC' ? 'Measured Tank / Vehicle Issue' : 'Measured Whole-Vehicle Dispatch Quantity'} *
          </label>
          <span className="text-[10px] font-bold text-slate-500">
            Authoritative measured issue from bulk tank / weighbridge
          </span>
        </div>

        {!isPolicyReady ? (
          <div className="p-4 text-center rounded-xl bg-slate-50 border border-dashed border-[#C4B9A3] text-xs font-semibold text-slate-500">
            Loading frozen quantity policy snapshot...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label htmlFor="vehicle-quantity-input" className="block text-xs font-bold text-[#111311]">
                  Value *
                </label>
                <input
                  id="vehicle-quantity-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={vehicleQuantity.value}
                  onChange={(e) => onVehicleQuantityValueChange(e.target.value)}
                  placeholder="e.g. 19500"
                  className={`w-full h-11 px-3.5 text-sm font-mono font-bold rounded-xl border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition ${
                    vehicleQuantityError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-[#C4B9A3]'
                  }`}
                  required
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="vehicle-unit-select" className="block text-xs font-bold text-[#111311]">
                  Unit *
                </label>
                <select
                  id="vehicle-unit-select"
                  value={vehicleQuantity.unit}
                  onChange={(e) => onVehicleUnitChange(e.target.value as QuantityUnitType)}
                  className="w-full h-11 px-3 text-xs font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition"
                >
                  {vehicleAllowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="vehicle-basis-select" className="block text-xs font-bold text-[#111311]">
                  Basis *
                </label>
                <div className="w-full h-11 px-3 flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50/60 text-[#111311]">
                  <span className="text-xs font-mono font-black text-emerald-900 tracking-wider">
                    {vehicleQuantity.basis || 'MEASURED'}
                  </span>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-200/70 px-2 py-0.5 rounded-md">
                    Authoritative
                  </span>
                </div>
                <input type="hidden" id="vehicle-basis-select" value={vehicleQuantity.basis || 'MEASURED'} />
              </div>
            </div>

            {/* Whole-Vehicle / Composite Quality Section */}
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/90 space-y-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-amber-200/70 pb-2">
                <div className="flex items-center space-x-1.5">
                  <Activity className="w-4 h-4 text-amber-900" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-950">
                    Whole-Vehicle / Composite Quality {sourceType === 'ZMCC' ? '(Required)' : '(Optional)'}
                  </span>
                </div>
                <span className="text-[10px] font-semibold text-amber-800">
                  Authoritative whole-vehicle sample • Independent of portion tests
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="vehicle-lr-input" className="block text-xs font-bold text-amber-950">
                    Vehicle Composite LR {sourceType === 'ZMCC' ? '*' : (vehicleQuantity.unit === 'KG' ? '*' : '(Optional)')}
                  </label>
                  <input
                    id="vehicle-lr-input"
                    type="number"
                    step="0.01"
                    min="10"
                    max="40"
                    value={vehicleLr || ''}
                    onChange={(e) => onVehicleLrChange && onVehicleLrChange(e.target.value)}
                    placeholder="e.g. 28.00"
                    className="w-full h-11 px-3.5 text-sm font-mono font-bold rounded-xl border border-amber-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                  <span className="text-[10px] text-amber-800 block">
                    Density = 1 + (LR / 1000)
                  </span>
                </div>

                <div className="space-y-1">
                  <label htmlFor="vehicle-fat-input" className="block text-xs font-bold text-amber-950">
                    Vehicle Composite Fat % {sourceType === 'ZMCC' ? '*' : '(Optional)'}
                  </label>
                  <input
                    id="vehicle-fat-input"
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    value={vehicleFat || ''}
                    onChange={(e) => onVehicleFatChange && onVehicleFatChange(e.target.value)}
                    placeholder="e.g. 3.80"
                    className="w-full h-11 px-3.5 text-sm font-mono font-bold rounded-xl border border-amber-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                  <span className="text-[10px] text-amber-800 block">
                    TS = Fat + SNF • Commercial Solids Truth
                  </span>
                </div>
              </div>

              {/* Derived Read-Only Canonical Preview Badges */}
              {(previewGrossLiters !== null || previewDensity !== null || previewAt13ts !== null) && (
                <div className="pt-3 border-t border-amber-200/70 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* PHYSICAL TRUTH BLOCK */}
                    <div className="p-3 rounded-xl bg-white border border-blue-200 shadow-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-900 font-sans">
                          Physical Truth
                        </span>
                        <span className="text-[10px] font-bold text-slate-600 font-mono">
                          Density: {previewDensity !== null ? previewDensity.toFixed(4) : '—'}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-bold text-slate-600 font-sans">Gross Liters</span>
                        <span className="text-base font-black text-blue-950 font-mono">
                          {previewGrossLiters !== null
                            ? `${previewGrossLiters.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* COMMERCIAL TRUTH BLOCK */}
                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-300 shadow-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-900 font-sans">
                          Commercial Truth
                        </span>
                        <span className="text-[10px] font-bold text-emerald-800 font-mono">
                          SNF: {previewSnf !== null ? `${previewSnf.toFixed(2)}%` : '—'} • TS: {previewTs !== null ? `${previewTs.toFixed(2)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-bold text-emerald-900 font-sans">@13TS Liters</span>
                        <span className="text-base font-black text-emerald-950 font-mono">
                          {previewAt13ts !== null
                            ? `${previewAt13ts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {vehicleQuantityError && (
              <p className="text-xs font-bold text-rose-600 mt-1" id="vehicle-quantity-error">
                {vehicleQuantityError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
