'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';

type Dashboard = { security: { vehiclesInsidePlant: number; pendingGateExit: number; latestEntryAt: string | null; latestExitAt: string | null }; vehicles: Array<{ visitId: string; vehicleNumber: string; stage: string; enteredPlantAt: string | null; stageChangedAt: string | null }> };
export function AdminHeadDashboard() {
  const { data } = useQuery({
    queryKey: ['admin-head', 'dashboard'],
    queryFn: ({ signal }) => fetchJson<{ dashboard?: Dashboard }>('/api/admin-head/dashboard', { signal }).then((v) => v.dashboard ?? null),
    refetchInterval: 30_000,
  });
  if (!data) return <main className="p-8 text-sm text-slate-500">Loading Admin Head dashboard…</main>;
  return <main className="min-h-screen bg-slate-50 p-6"><h1 className="text-xl font-semibold text-slate-900">Admin Head: Plant Presence</h1><div className="mt-4 flex gap-4 text-sm"><div className="rounded-xl bg-white p-4 shadow-sm">Vehicles inside: <b>{data.security.vehiclesInsidePlant}</b></div><div className="rounded-xl bg-white p-4 shadow-sm">Ready for exit: <b>{data.security.pendingGateExit}</b></div></div><div className="mt-5 overflow-hidden rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-100"><th className="p-3">Vehicle</th><th>Stage</th><th>Entered</th><th>Stage updated</th></tr></thead><tbody>{data.vehicles.map((v) => <tr key={v.visitId} className="border-t"><td className="p-3 tabular-nums font-semibold">{v.vehicleNumber}</td><td>{v.stage.replaceAll('_', ' ')}</td><td>{v.enteredPlantAt ? new Date(v.enteredPlantAt).toLocaleTimeString() : '—'}</td><td>{v.stageChangedAt ? new Date(v.stageChangedAt).toLocaleTimeString() : '—'}</td></tr>)}</tbody></table></div></main>;
}
