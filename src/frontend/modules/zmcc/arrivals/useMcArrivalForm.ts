'use client';

import React, { useCallback, useState } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import {
  EMPTY_GPS,
  generateClientEventId,
  type ArrivingJourney,
  type GpsState,
  type McArrivalRow,
  type PolicyMode,
} from './arrivalTypes';

export function useMcArrivalForm(policyMode: PolicyMode, onRecorded: () => void) {
  const [selectedJourney, setSelectedJourney] = useState<ArrivingJourney | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [rawMilkTokenNumber, setRawMilkTokenNumber] = useState('');
  const [arrivalTimestamp, setArrivalTimestamp] = useState(() => toDatetimeLocalInput(new Date()));
  const [gps, setGps] = useState<GpsState>(EMPTY_GPS);
  const [eventId, setEventId] = useState(() => generateClientEventId('mot-arr'));
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<McArrivalRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedJourney(null);
    setRawMilkTokenNumber('');
    setArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setGps(EMPTY_GPS);
    setEventId(generateClientEventId('mot-arr'));
    setError(null);
  }, []);

  const selectJourney = (j: ArrivingJourney) => {
    setSelectedJourney(j);
    setFormOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJourney) {
      setError('Please select a journey.');
      return;
    }
    if (policyMode === 'REQUIRED' && !rawMilkTokenNumber.trim()) {
      setError('PHE Raw Milk Token is REQUIRED by operational policy.');
      return;
    }
    if (policyMode === 'DISABLED' && rawMilkTokenNumber.trim()) {
      setError('PHE Raw Milk Token is DISABLED by operational policy. Please clear the field.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/zmcc/arrivals/mot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journey_id: selectedJourney.id,
          raw_milk_token_number: rawMilkTokenNumber.trim() || undefined,
          arrival_timestamp: datetimeLocalToIso(arrivalTimestamp) || new Date(arrivalTimestamp).toISOString(),
          client_event_id: eventId,
          phe_latitude: gps.lat,
          phe_longitude: gps.lng,
          phe_gps_accuracy: gps.acc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to record MC arrival.');
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
    selectedJourney, selectJourney, formOpen, setFormOpen,
    rawMilkTokenNumber, setRawMilkTokenNumber,
    arrivalTimestamp, setArrivalTimestamp,
    gps, setGps, submitting, successResult, setSuccessResult, error, submit, reset,
  };
}
