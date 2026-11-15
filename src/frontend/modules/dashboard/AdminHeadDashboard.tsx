'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { DataTable } from '@/components/ui/data-table';
import { SkeletonStats, SkeletonTable } from '@/components/ui/loaders';
import { formatTime } from '@/lib/format';

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

  if (!data)
    return (
      <main className="min-h-dvh w-full max-w-full min-w-0 space-y-4 bg-background p-4 sm:p-6">
        <SkeletonStats count={2} />
        <SkeletonTable />
      </main>
    );

  return (
    <main className="min-h-dvh w-full max-w-full min-w-0 bg-background p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <h1 className="text-xl font-semibold text-foreground">Plant presence</h1>
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 text-sm">
        <div className="min-w-0 rounded-2xl bg-card border border-border p-4">
          Vehicles inside: <b className="font-mono tabular-nums text-foreground">{data.security.vehiclesInsidePlant}</b>
        </div>
        <div className="min-w-0 rounded-2xl bg-card border border-border p-4">
          Ready for exit: <b className="font-mono tabular-nums text-foreground">{data.security.pendingGateExit}</b>
        </div>
      </div>
      <div className="mt-5">
        <DataTable<Dashboard['vehicles'][number]>
          rows={data.vehicles}
          getRowId={(v) => v.visitId}
          emptyTitle="No vehicles inside"
          columns={[
            { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', primary: true, cell: (v) => <span className="font-mono tabular-nums font-semibold text-foreground">{v.vehicleNumber}</span> },
            { key: 'stage', header: 'Stage', label: 'Stage', cell: (v) => v.stage.replaceAll('_', ' ') },
            { key: 'entered', header: 'Entered', label: 'Entered', cell: (v) => <span className="tabular-nums">{formatTime(v.enteredPlantAt)}</span> },
            { key: 'updated', header: 'Stage updated', label: 'Stage updated', cell: (v) => <span className="tabular-nums">{formatTime(v.stageChangedAt)}</span> },
          ]}
        />
      </div>
    </main>
  );
}
