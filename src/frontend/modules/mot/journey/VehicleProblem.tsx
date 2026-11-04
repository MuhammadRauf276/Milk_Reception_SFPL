'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Truck } from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { Modal } from '@/components/ui/modal';
import type { CurrentJourney } from './types';

interface VehicleRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  decision_note: string | null;
  from_vehicle: { id: string; vehicle_number: string };
  to_vehicle: { id: string; vehicle_number: string } | null;
  visited_shops: Array<{ shop_name: string; gross_liters: number }>;
}

const storageKey = (journeyId: string) => `mot-vehicle-requests:${journeyId}`;

function readSaved(journeyId: string): VehicleRequest[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(journeyId)) ?? '[]') as VehicleRequest[];
  } catch {
    return [];
  }
}

/**
 * The journey's vehicle requests. The last answer is kept on the phone, so a waiting request
 * still holds the work back when there is no signal.
 */
export function useVehicleRequests(journeyId: string | null, isCovering: boolean, coverHeaders?: HeadersInit) {
  const [requests, setRequests] = useState<VehicleRequest[]>([]);

  const url = `/api/zmcc/mot/journeys/current/vehicle-problem${
    isCovering && journeyId ? `?journeyId=${encodeURIComponent(journeyId)}` : ''
  }`;

  const reload = useCallback(async () => {
    if (!journeyId) return;
    try {
      const res = await fetch(url, { headers: coverHeaders });
      if (!res.ok) return;
      const data = await res.json();
      const next: VehicleRequest[] = data.requests ?? [];
      setRequests(next);
      try {
        localStorage.setItem(storageKey(journeyId), JSON.stringify(next));
      } catch {
        // Storage full or blocked: the screen still works online.
      }
    } catch {
      // Offline: the last answer stays on screen.
    }
  }, [journeyId, url, coverHeaders]);

  const pending = requests.some((r) => r.status === 'PENDING');

  useEffect(() => {
    setRequests(journeyId ? readSaved(journeyId) : []);
    void reload();
  }, [journeyId, reload]);

  // Answers quickly while the Mobile Tester is waiting on one.
  useEffect(() => {
    if (!journeyId) return;
    const timer = setInterval(() => void reload(), pending ? 15_000 : 60_000);
    return () => clearInterval(timer);
  }, [journeyId, pending, reload]);

  return { requests, pending, reload, url };
}

interface Props {
  journey: CurrentJourney;
  vehicleRequests: ReturnType<typeof useVehicleRequests>;
  coverHeaders?: HeadersInit;
  open: boolean;
  onClose: () => void;
  onVehicleChanged: (vehicle: { id: string; vehicle_number: string }) => void;
}

/** What the Mobile Tester sees about a vehicle request, and the form opened from "Send Request" in the sidebar. */
export function VehicleProblem({ journey, vehicleRequests, coverHeaders, open, onClose, onVehicleChanged }: Props) {
  const { requests, pending, reload, url } = vehicleRequests;
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  const newVehicle = requests.find((r) => r.status === 'APPROVED')?.to_vehicle;
  useEffect(() => {
    if (newVehicle && newVehicle.id !== journey.mot_vehicle?.id) onVehicleChanged(newVehicle);
  }, [newVehicle, journey.mot_vehicle?.id, onVehicleChanged]);

  const latest = requests[0];

  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error('Please write what happened to the vehicle.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(coverHeaders as Record<string, string> | undefined) },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send. Please try again.');
      toast.success(data.message);
      onClose();
      setReason('');
      await reload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      {pending && (
        <div role="status" className="p-3 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 text-sm font-medium flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Waiting for the Zonal Manager</p>
            <p className="text-xs mt-0.5">
              Your request is sent. Do not collect from more shops or return to PHE until the manager answers. Your collected milk is safe.
            </p>
          </div>
        </div>
      )}
      {!pending && latest?.status === 'REJECTED' && (
        <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs font-medium">
          Request refused, continue with this vehicle: {latest.decision_note}
        </div>
      )}
      {requests
        .filter((r) => r.status === 'APPROVED')
        .map((r) => (
          <div key={r.id} className="p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 text-xs font-medium space-y-1">
            <div className="flex items-start gap-2">
              <Truck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Vehicle changed: {r.from_vehicle.vehicle_number} to {r.to_vehicle?.vehicle_number}. All collected milk moved to the new vehicle.
              </span>
            </div>
            {r.visited_shops.length > 0 && (
              <p className="pl-6 text-[11px] text-blue-800">
                Shops on {r.from_vehicle.vehicle_number}: {r.visited_shops.map((s) => s.shop_name).join(', ')}
              </p>
            )}
          </div>
        ))}

      {open && (
        <Modal onClose={onClose} title="Send Request" className="max-w-md">
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-600">
              Only if this vehicle cannot continue. The Zonal Manager will give you a new vehicle. Your collected milk and finished shops stay on this journey.
            </p>
            <label htmlFor="vehicle-problem-reason" className="block text-xs font-semibold text-slate-700">
              What happened to the vehicle? <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="vehicle-problem-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-subtle p-3 text-sm font-medium"
            />
            <button
              type="button"
              onClick={submit}
              disabled={sending || !reason.trim()}
              className="min-h-11 w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send to Zonal Manager'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
