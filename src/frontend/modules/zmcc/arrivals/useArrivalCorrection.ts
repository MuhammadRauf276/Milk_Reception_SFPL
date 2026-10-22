'use client';

import React, { useState } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import type { CorrectionTarget } from './arrivalTypes';

export function useArrivalCorrection(onApplied: () => void) {
  const toast = useToast();
  const [target, setTarget] = useState<CorrectionTarget | null>(null);
  const [reason, setReason] = useState('');
  const [token, setToken] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [localSupplierId, setLocalSupplierId] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [acc, setAcc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (t: CorrectionTarget) => {
    const { record } = t;
    setTarget(t);
    setReason('');
    setError(null);
    setTimestamp(record.arrival_timestamp ? toDatetimeLocalInput(record.arrival_timestamp) : '');
    setLat(record.phe_latitude != null ? String(record.phe_latitude) : '');
    setLng(record.phe_longitude != null ? String(record.phe_longitude) : '');
    setAcc(record.phe_gps_accuracy != null ? String(record.phe_gps_accuracy) : '');

    if (t.type === 'MC') {
      setToken(t.record.raw_milk_token_number || '');
    } else {
      setLocalSupplierId(t.record.local_supplier_id ? String(t.record.local_supplier_id) : '');
      setToken(t.record.raw_milk_token_number || '');
      setVehicle(t.record.vehicle_number || '');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (!reason.trim() || reason.trim().length < 5) {
      setError('Reason is mandatory (at least 5 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let url = '';
      if (target.type === 'MC') url = `/api/zmcc/arrivals/mot/${target.record.id}`;
      else url = `/api/zmcc/arrivals/hc/${target.record.id}`;

      const payload: Record<string, unknown> = {
        reason: reason.trim(),
        arrival_timestamp: datetimeLocalToIso(timestamp) || new Date(timestamp).toISOString(),
      };
      if (target.type === 'MC') {
        if (token.trim()) payload.raw_milk_token_number = token.trim();
      } else {
        payload.local_supplier_id = localSupplierId || undefined;
        payload.raw_milk_token_number = token.trim();
        payload.vehicle_number = vehicle.trim().toUpperCase();
      }
      if (lat && lng) {
        payload.phe_latitude = Number(lat);
        payload.phe_longitude = Number(lng);
        if (acc) payload.phe_gps_accuracy = Number(acc);
      }

      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to apply correction.');
      } else {
        toast.showSuccess('Arrival correction applied successfully.');
        setTarget(null);
        onApplied();
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    target, setTarget, open, submit, submitting, error,
    reason, setReason, token, setToken, vehicle, setVehicle,
    localSupplierId, setLocalSupplierId,
    timestamp, setTimestamp, lat, setLat, lng, setLng,
  };
}
