'use client';

import React, { useCallback, useState } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import { apiClient, ApiError } from '@/frontend/lib/apiClient';
import { isForcedOffline } from '@/frontend/hooks/useOnlineStatus';
import { enqueueSyncItem } from '@/frontend/modules/pwa/syncEngine';
import { getActiveOwnerUserId } from '@/frontend/modules/pwa/deviceIdentity';
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

    const arrivalIso = datetimeLocalToIso(arrivalTimestamp) || new Date(arrivalTimestamp).toISOString();
    const payload = {
      journey_id: selectedJourney.id,
      raw_milk_token_number: rawMilkTokenNumber.trim() || undefined,
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
        kind: 'ZMCC_MOT_ARRIVAL',
        ownerUserId: owner,
        capturedAt: arrivalIso,
        payload,
      });
      const offlineResult: McArrivalRow = {
        id: clientUuid,
        journey_id: selectedJourney.id,
        zmcc_id: '',
        route_milk_token: null,
        raw_milk_token_number: payload.raw_milk_token_number || null,
        zmcc_token: 'QUEUED (OFFLINE)',
        arrival_timestamp: arrivalIso,
        arrival_date: arrivalIso.split('T')[0],
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
        journey: {
          id: selectedJourney.id,
          journey_number: selectedJourney.journey_number,
          operational_date: selectedJourney.operational_date,
          status: 'ARRIVED',
        } as unknown as McArrivalRow['journey'],
      } as unknown as McArrivalRow;
      setSuccessResult(offlineResult);
      setFormOpen(false);
      onRecorded();
    };

    if (!navigator.onLine || isForcedOffline()) {
      try {
        await handleOfflineQueue();
      } catch (queueErr) {
        setError(getErrorMessage(queueErr) || 'Failed to queue offline arrival.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const data = await apiClient.post<McArrivalRow>(
        '/api/zmcc/arrivals/mot',
        payload,
        {
          dedupKey: `zmcc-arr-${selectedJourney.id}`,
          timeoutMs: 15_000,
        }
      );
      setSuccessResult(data);
      setFormOpen(false);
      onRecorded();
    } catch (err) {
      if (err instanceof ApiError && (err.isNetworkError || err.isTimeout)) {
        try {
          await handleOfflineQueue();
          return;
        } catch {
          // fall through to error reporting
        }
      }
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
