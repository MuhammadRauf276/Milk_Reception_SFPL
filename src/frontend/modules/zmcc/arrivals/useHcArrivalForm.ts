'use client';

import React, { useCallback, useState } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
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
    try {
      const res = await fetch('/api/zmcc/arrivals/hc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_supplier_id: selectedLocalSupplierId,
          raw_milk_token_number: rawMilkTokenNumber.trim(),
          vehicle_number: vehicleNumber.trim().toUpperCase(),
          arrival_timestamp: datetimeLocalToIso(arrivalTimestamp) || new Date(arrivalTimestamp).toISOString(),
          client_event_id: eventId,
          phe_latitude: gps.lat,
          phe_longitude: gps.lng,
          phe_gps_accuracy: gps.acc,
        }),
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
      setError(getErrorMessage(err) || 'An unexpected error occurred.');
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
