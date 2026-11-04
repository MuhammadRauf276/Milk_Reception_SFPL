'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { toast } from '@/frontend/lib/appToast';

interface VehicleRequest {
  id: string;
  journey_number: string;
  route_name: string | null;
  mot_name: string | null;
  zmcc_id: string;
  reason: string;
  from_vehicle: { vehicle_number: string };
  shops_total: number;
  shops_visited: number;
}

interface RequestsResponse {
  requests: VehicleRequest[];
  available_vehicles: Record<string, Array<{ id: string; vehicle_number: string }>>;
}

interface Props {
  facilityId?: string | null;
  onDecided: () => void;
}

/** Vehicle problems waiting for a Zonal Manager. Stays hidden for anyone who cannot answer them. */
export function VehicleRequestsPanel({ facilityId, onDecided }: Props) {
  const query = useQuery({
    queryKey: ['zmcc', 'vehicle-requests', facilityId ?? null],
    queryFn: ({ signal }) => {
      const params = facilityId ? `?zmcc_id=${encodeURIComponent(facilityId)}` : '';
      return fetchJson<RequestsResponse>(`/api/zmcc/mot/vehicle-requests${params}`, { signal });
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = query.data?.requests ?? [];
  if (requests.length === 0) return null;

  const decide = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const data = await fetchJson<{ message: string }>(`/api/zmcc/mot/vehicle-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.success(data.message);
      await query.refetch();
      onDecided();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-card p-4 rounded-xl border border-amber-300 shadow-2xs space-y-3">
      <div className="flex items-center gap-2 text-amber-900">
        <AlertTriangle className="w-4 h-4" />
        <h2 className="text-sm font-semibold">Vehicle Problems ({requests.length})</h2>
      </div>
      {requests.map((r) => {
        const free = query.data?.available_vehicles[r.zmcc_id] ?? [];
        const note = notes[r.id] ?? '';
        return (
          <div key={r.id} className="p-3 rounded-lg border border-border space-y-2 text-xs">
            <p className="font-semibold text-foreground">
              {r.from_vehicle.vehicle_number} · {r.mot_name ?? 'MOT'} · {r.route_name ?? 'Route'} · #{r.journey_number}
            </p>
            <p className="text-slate-700">{r.reason}</p>
            <p className="text-slate-500">
              {r.shops_visited} of {r.shops_total} shops done. Remaining shops continue on the new vehicle.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                aria-label="New vehicle"
                value={chosen[r.id] ?? ''}
                onChange={(e) => setChosen((prev) => ({ ...prev, [r.id]: e.target.value }))}
                className="min-h-11 flex-1 rounded-lg border border-border bg-subtle px-2 font-medium"
              >
                <option value="">{free.length ? 'Choose new vehicle' : 'No free vehicle'}</option>
                {free.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicle_number}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busyId === r.id || !chosen[r.id]}
                onClick={() => decide(r.id, { decision: 'APPROVE', new_vehicle_id: chosen[r.id] })}
                className="min-h-11 px-4 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
              >
                Give Vehicle
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                aria-label="Reason for refusing"
                value={note}
                onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                placeholder="Reason, if refusing"
                className="min-h-11 flex-1 rounded-lg border border-border bg-subtle px-2 font-medium"
              />
              <button
                type="button"
                disabled={busyId === r.id || note.trim().length < 3}
                onClick={() => decide(r.id, { decision: 'REJECT', note: note.trim() })}
                className="min-h-11 px-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-semibold disabled:opacity-50"
              >
                Refuse
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
