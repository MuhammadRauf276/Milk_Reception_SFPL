'use client';

import React from 'react';
import { Clock, Truck, ShieldCheck, UserCheck, AlertCircle } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
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

export interface VehicleOption {
  id: string;
  vehicle_number: string;
  is_available: boolean;
  busy_reason?: string;
}

export interface MotOption {
  id: string;
  mot_code: string;
  name: string;
  phone_number: string;
  is_available: boolean;
  busy_reason?: string;
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

  // ZMCC & Contractor specialized fields
  isZmccSource?: boolean;
  availableVehicles?: VehicleOption[];
  selectedVehicleId?: string;
  onSelectVehicle?: (vehicleId: string, vehicleNumber: string) => void;
  availableMotProfiles?: MotOption[];
  selectedMotProfileId?: string;
  onSelectMotProfileId?: (profileId: string) => void;
  motError?: string | null;
  driverName?: string;
  onDriverNameChange?: (name: string) => void;
  driverError?: string | null;
  isLoadingResources?: boolean;
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
  vehicleQuantity,
  vehicleQuantityError,
  vehicleLr,
  vehicleFat,
  rawMilkDispatchNoteNumber,
  onRawMilkDispatchNoteNumberChange,
  isZmccSource = true,
  availableVehicles = [],
  selectedVehicleId = '',
  onSelectVehicle,
  availableMotProfiles = [],
  selectedMotProfileId = '',
  onSelectMotProfileId,
  motError,
  driverName = '',
  onDriverNameChange,
  driverError,
  isLoadingResources = false,
}) => {
  const freeVehiclesCount = availableVehicles.filter((v) => v.is_available).length;
  const freeMotsCount = availableMotProfiles.filter((m) => m.is_available).length;

  const vehicleComboboxOptions = availableVehicles.map((v) => ({
    value: v.id,
    label: v.vehicle_number,
    keywords: v.vehicle_number,
    disabled: !v.is_available,
    disabledReason: v.busy_reason || 'Busy',
  }));

  const motComboboxOptions = availableMotProfiles.map((m) => ({
    value: m.id,
    label: `${m.mot_code} · ${m.name}${m.phone_number ? ` (${m.phone_number})` : ''}`,
    keywords: `${m.mot_code} ${m.name} ${m.phone_number}`,
    disabled: !m.is_available,
    disabledReason: m.busy_reason || 'Busy',
  }));

  return (
    <div className="space-y-4">
      {/* Fallback for global admin only. Never shown to source-assigned users. */}
      {!isSourceBound && availableSources.length > 0 && (
        <div className="bg-card border-border p-4 rounded-xl border text-xs space-y-1.5 shadow-xs">
          <label className="block font-semibold text-amber-950">
            Procurement source
          </label>
          <Combobox
            options={availableSources.map((x) => ({
              value: x.id,
              label: `${x.name} · ${x.source_type || 'SOURCE'}`,
            }))}
            value={selectedSourceId}
            onValueChange={onSelectSourceId}
            placeholder="Select procurement source"
            searchPlaceholder="Search source"
          />
        </div>
      )}

      {!isSourceBound && !selectedSourceId && (
        <div className="bg-card border-border p-4 rounded-xl border text-blue-900 text-xs font-semibold">
          Select a source.
        </div>
      )}

      <div className="p-4 sm:p-5 rounded-xl bg-card border border-border-strong shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center space-x-2">
            <Truck className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-foreground">
              Vehicle & Dispatch Time
            </h3>
          </div>
          {isZmccSource && (
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              <span>MPD Fleet & Escort</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 min-w-0">
          {/* 1. Vehicle Selection (Combobox for ZMCC, text input for Contractor) */}
          <div className="space-y-1 min-w-0">
            <label htmlFor="vehicle-selection" className="block text-xs font-semibold text-foreground">
              Vehicle No. *
            </label>
            {isZmccSource ? (
              <div className="space-y-1">
                <Combobox
                  id="vehicle-selection"
                  options={vehicleComboboxOptions}
                  value={selectedVehicleId}
                  onValueChange={(val) => {
                    const match = availableVehicles.find((v) => v.id === val);
                    if (match && onSelectVehicle) {
                      onSelectVehicle(match.id, match.vehicle_number);
                    }
                  }}
                  placeholder={
                    isLoadingResources
                      ? 'Loading vehicles…'
                      : availableVehicles.length === 0
                        ? 'No vehicles found'
                        : 'Select free vehicle'
                  }
                  searchPlaceholder="Search vehicle number"
                  emptyText="No vehicles match"
                  disabled={availableVehicles.length === 0}
                  className={vehicleNumberError ? 'border-rose-500 ring-1 ring-rose-500' : ''}
                />
                {availableVehicles.length > 0 && freeVehiclesCount === 0 && (
                  <p className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>All vehicles currently busy</span>
                  </p>
                )}
              </div>
            ) : (
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
            )}
            {vehicleNumberError && (
              <p className="text-xs font-semibold text-rose-600 mt-1 break-words" id="vehicle-number-error">
                {vehicleNumberError}
              </p>
            )}
          </div>

          {/* 2. Escort / Driver Person (Combobox for ZMCC MOT, text input for Contractor driver) */}
          <div className="space-y-1 min-w-0">
            <label htmlFor="escort-person-input" className="block text-xs font-semibold text-foreground flex items-center justify-between">
              <span>{isZmccSource ? 'MOT Escort *' : 'Contractor Driver *'}</span>
              <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            </label>
            {isZmccSource ? (
              <div className="space-y-1">
                <Combobox
                  id="escort-person-input"
                  options={motComboboxOptions}
                  value={selectedMotProfileId}
                  onValueChange={(val) => onSelectMotProfileId?.(val)}
                  placeholder={
                    isLoadingResources
                      ? 'Loading MOT escorts…'
                      : availableMotProfiles.length === 0
                        ? 'No MOT escorts found'
                        : 'Select free MOT escort'
                  }
                  searchPlaceholder="Search MOT name or code"
                  emptyText="No MOT escort match"
                  disabled={availableMotProfiles.length === 0}
                  className={motError ? 'border-rose-500 ring-1 ring-rose-500' : ''}
                />
                {availableMotProfiles.length > 0 && freeMotsCount === 0 && (
                  <p className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>All MOT escorts currently busy</span>
                  </p>
                )}
              </div>
            ) : (
              <input
                id="escort-person-input"
                type="text"
                value={driverName}
                onChange={(e) => onDriverNameChange?.(e.target.value)}
                placeholder="e.g. Muhammad Bilal"
                className={`w-full min-w-0 h-11 px-3.5 text-xs font-semibold rounded-xl border bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition ${
                  driverError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-border-strong'
                }`}
                required
              />
            )}
            {(motError || driverError) && (
              <p className="text-xs font-semibold text-rose-600 mt-1 break-words">
                {motError || driverError}
              </p>
            )}
          </div>

          {/* 3. Dispatch Note Number */}
          <div className="space-y-1 min-w-0">
            <label htmlFor="dispatch-note-input" className="block text-xs font-semibold text-foreground">
              Dispatch note no.
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

          {/* 4. Dispatch Time */}
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
