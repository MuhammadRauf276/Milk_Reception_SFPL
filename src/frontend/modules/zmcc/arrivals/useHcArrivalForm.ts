'use client';

import React, { useCallback, useState } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import { isForcedOffline } from '@/frontend/hooks/useOnlineStatus';
import { enqueueSyncItem } from '@/frontend/modules/pwa/syncEngine';
import { getActiveOwnerUserId } from '@/frontend/modules/pwa/deviceIdentity';
import { EMPTY_GPS, generateClientEventId, type GpsState, type HcArrivalRow } from './arrivalTypes';

export function useHcArrivalForm(onRecorded: () => void) {
  const [formOpen, setFormOpen] = useState(false);
  const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
  const [selectedLocalSupplierId, setSelectedLocalSupplierId] = useState('');
  const [rawMilkTokenNumber, setRawMilkTokenNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [arrivalTimestamp, setArrivalTimestamp] = useState(() => toDatetimeLocalInput(new Date()));
  const [gps, setGps] = useState<GpsState>(EMPTY_GPS);
  const [eventId, setEventId] = useState(() => generateClientEventId('ls-arr'));
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<HcArrivalRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedLocalSupplierId('');
    setSupplierSearchTerm('');
    setRawMilkTokenNumber('');
    setVehicleNumber('');
    setArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setGps(EMPTY_GPS);
    setEventId(generateClientEventId('ls-arr'));
    setError(null);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalSupplierId) {
      setError('Please select an HC supplier.');
      return;
    }
    if (!rawMilkTokenNumber.trim()) {
      setError('Raw Milk Token number is required.');
      return;
    }
    if (!vehicleNumber.trim()) {
      setError('Vehicle number is required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const arrivalIso = datetimeLocalToIso(arrivalTimestamp) || new Date(arrivalTimestamp).toISOString();
    const payload = {
      local_supplier_id: selectedLocalSupplierId,
      raw_milk_token_number: rawMilkTokenNumber.trim(),
      vehicle_number: vehicleNumber.trim().toUpperCase(),
      arrival_timestamp: arrivalIso,
      client_event_id: eventId,
      phe_latitude: gps.lat,
      phe_longitude: gps.lng,
      phe_gps_accuracy: gps.acc,
    };

    const handleOfflineQueue = async () => {
      const clientUuid = crypto.randomUUID();
      const owner = getActiveOwnerUserId() || 'unknown';
      await enqueueSyncItem({
        clientUuid,
        kind: 'ZMCC_LOCAL_SUPPLIER_ARRIVAL',
        ownerUserId: owner,
        capturedAt: arrivalIso,
        payload,
      });
      const offlineResult: HcArrivalRow = {
        id: clientUuid,
        zmcc_id: '',
        local_supplier_id: selectedLocalSupplierId,
        milk_source_id: null,
        milk_source_code_snapshot: null,
        milk_source_name_snapshot: null,
        rmr_number: null,
        raw_milk_token_number: payload.raw_milk_token_number,
        vehicle_number: payload.vehicle_number,
        arrival_timestamp: arrivalIso,
        arrival_date: arrivalIso.split('T')[0],
        zmcc_token: 'QUEUED (OFFLINE)',
        phe_latitude: gps.lat,
        phe_longitude: gps.lng,
        phe_gps_accuracy: gps.acc,
        client_event_id: eventId,
        recorded_by_user_id: owner,
        submitted_at: new Date().toISOString(),
        correction_count: 0,
        manager_correction_count: 0,
        last_corrected_by_user_id: null,
        last_corrected_at: null,
        gate_exit_required: false,
        exit_timestamp: null,
        exit_recorded_by_user_id: null,
        exit_client_event_id: null,
      } as unknown as HcArrivalRow;
      setSuccessResult(offlineResult);
      setFormOpen(false);
      onRecorded();
    };

    if (!navigator.onLine || isForcedOffline()) {
      try {
        await handleOfflineQueue();
      } catch (queueErr) {
        setError(getErrorMessage(queueErr) || 'Failed to queue offline HC arrival.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const res = await fetch('/api/zmcc/arrivals/hc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to record HC arrival.');
      } else {
        setSuccessResult(data);
        setFormOpen(false);
        onRecorded();
      }
    } catch (err) {
      try {
        await handleOfflineQueue();
      } catch {
        setError(getErrorMessage(err) || 'An unexpected error occurred.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    formOpen, setFormOpen,
    supplierSearchTerm, setSupplierSearchTerm,
    selectedLocalSupplierId, setSelectedLocalSupplierId,
    rawMilkTokenNumber, setRawMilkTokenNumber,
    vehicleNumber, setVehicleNumber,
    arrivalTimestamp, setArrivalTimestamp,
    gps, setGps, submitting, successResult, setSuccessResult, error, setError, submit, reset,
  };
}
