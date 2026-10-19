'use client';

import React from 'react';
import { Clock, Truck } from 'lucide-react';
import {
  QuantityUnit,
  MeasurementBasis,
} from '@/backend/modules/dispatch/quantity-policy/types';

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
  isVehicleQualityAuto?: boolean;
  onResetVehicleQualityAuto?: () => void;
  rawMilkDispatchNoteNumber?: string;
  onRawMilkDispatchNoteNumberChange?: (value: string) => void;
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
  vehicleAllowedUnits,
  vehicleQuantityError,
  sourceType,
  vehicleLr,
  onVehicleLrChange,
  vehicleFat,
  onVehicleFatChange,
  isVehicleQualityAuto = false,
  onResetVehicleQualityAuto,
  rawMilkDispatchNoteNumber,
  onRawMilkDispatchNoteNumberChange,
}) => {
  return (
    <div className="space-y-4">
      {!isSourceBound && availableSources.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-300/80 text-xs space-y-1.5 shadow-xs">
          <label className="block font-semibold text-amber-950">
            Select Operating Procurement Source (Admin Override):
          </label>
          <select
            value={selectedSourceId}
            onChange={(e) => onSelectSourceId(e.target.value)}
            className="w-full h-11 px-3.5 font-semibold rounded-xl border border-amber-300 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-primary"
          >
            <option value="">Select procurement source</option>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.source_type}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isSourceBound && !selectedSourceId && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
          Please select an operating procurement source from the dropdown above to initialize the dispatch draft.
        </div>
      )}

      <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-4">
        <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
          <Truck className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">
            Vehicle & Dispatch Time
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 min-w-0">
          <div className="space-y-1 min-w-0">
            <label htmlFor="vehicle-number-input" className="block text-xs font-semibold text-foreground">
              Vehicle No. *
            </label>
            <input
              id="vehicle-number-input"
              type="text"
              value={vehicleNumber}
              onChange={(e) => onVehicleNumberChange(e.target.value)}
              placeholder="e.g. KBL-8492"
              className={`w-full min-w-0 h-11 px-3.5 text-sm tabular-nums font-semibold rounded-xl border bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition ${
                vehicleNumberError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-border-strong'
              }`}
              required
            />
            {vehicleNumberError && (
              <p className="text-xs font-semibold text-rose-600 mt-1 break-words" id="vehicle-number-error">
                {vehicleNumberError}
              </p>
            )}
          </div>

          <div className="space-y-1 min-w-0">
            <label htmlFor="dispatch-note-input" className="block text-xs font-semibold text-foreground">
              Raw Milk Dispatch Note No.
            </label>
            <input
              id="dispatch-note-input"
              type="text"
              pattern="[0-9]*"
              inputMode="numeric"
              value={rawMilkDispatchNoteNumber || ''}
              onChange={(e) => onRawMilkDispatchNoteNumberChange?.(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 008124"
              className="w-full min-w-0 h-11 px-3.5 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition"
            />
          </div>

          <div className="space-y-1 min-w-0">
            <label htmlFor="dispatch-time-input" className="block text-xs font-semibold text-foreground flex items-center justify-between">
              <span>Dispatch Time *</span>
              <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
            </label>
            <input
              id="dispatch-time-input"
              type="datetime-local"
              value={dispatchOpDatetime}
              max={maxDatetime}
              onChange={(e) => onDispatchOpDatetimeChange(e.target.value)}
              className="w-full min-w-0 h-11 px-3.5 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition"
              required
            />
          </div>
        </div>
      </div>

      <input type="hidden" id="vehicle-quantity-input" value={vehicleQuantity.value} />
      <input type="hidden" id="vehicle-unit-select" value="KG" />
      <input type="hidden" id="vehicle-basis-select" value="MEASURED" />
      <input type="hidden" id="vehicle-lr-input" value={vehicleLr || ''} />
      <input type="hidden" id="vehicle-fat-input" value={vehicleFat || ''} />
      {vehicleQuantityError && (
        <p className="text-xs font-semibold text-rose-600 mt-1 break-words" id="vehicle-quantity-error">
          {vehicleQuantityError}
        </p>
      )}
    </div>
  );
};
