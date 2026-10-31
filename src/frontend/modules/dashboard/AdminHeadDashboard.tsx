'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { TableWrapper } from '@/components/ui/table-wrapper';

type Dashboard = {
  security: {
    vehiclesInsidePlant: number;
    pendingGateExit: number;
    latestEntryAt: string | null;
    latestExitAt: string | null;
  };
  vehicles: Array<{
    visitId: string;
    vehicleNumber: string;
    stage: string;
    enteredPlantAt: string | null;
    stageChangedAt: string | null;
  }>;
};

export function AdminHeadDashboard() {
  const { data } = useQuery({
    queryKey: ['admin-head', 'dashboard'],
    queryFn: ({ signal }) =>
      fetchJson<{ dashboard?: Dashboard }>('/api/admin-head/dashboard', { signal }).then(
        (v) => v.dashboard ?? null
      ),
    refetchInterval: 30_000,
  });

  if (!data) return <main className="p-6 text-sm text-muted-foreground">Loading Admin Head dashboard…</main>;

  return (
    <main className="min-h-[100dvh] w-full max-w-full min-w-0 bg-background p-3 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <h1 className="text-xl font-semibold text-foreground">Admin Head: Plant Presence</h1>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <div className="flex-1 min-w-[140px] rounded-xl bg-card border border-border p-4 shadow-2xs">
          Vehicles inside: <b className="text-foreground">{data.security.vehiclesInsidePlant}</b>
        </div>
        <div className="flex-1 min-w-[140px] rounded-xl bg-card border border-border p-4 shadow-2xs">
          Ready for exit: <b className="text-foreground">{data.security.pendingGateExit}</b>
        </div>
      </div>
      <div className="mt-5">
        <TableWrapper>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-subtle border-b border-border">
                <th className="p-3 font-semibold text-foreground">Vehicle</th>
                <th className="p-3 font-semibold text-foreground">Stage</th>
                <th className="p-3 font-semibold text-foreground">Entered</th>
                <th className="p-3 font-semibold text-foreground">Stage updated</th>
              </tr>
            </thead>
            <tbody>
              {data.vehicles.map((v) => (
                <tr key={v.visitId} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                  <td className="p-3 tabular-nums font-semibold text-foreground">{v.vehicleNumber}</td>
                  <td className="p-3">{v.stage.replaceAll('_', ' ')}</td>
                  <td className="p-3">{v.enteredPlantAt ? new Date(v.enteredPlantAt).toLocaleTimeString() : '—'}</td>
                  <td className="p-3">{v.stageChangedAt ? new Date(v.stageChangedAt).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrapper>
      </div>
    </main>
  );
}
