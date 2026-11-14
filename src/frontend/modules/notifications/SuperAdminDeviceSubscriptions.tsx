'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatDeviceLabel } from '@/lib/format';
import { getRoleLabel } from '@core/roles/labels';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
type Device = { id: string; user: string; role: string; deviceLabel: string | null; active: boolean; createdAt: string; revokedAt: string | null };
const NO_ITEMS: Device[] = [];
export function SuperAdminDeviceSubscriptions() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications', 'admin-devices'],
    queryFn: ({ signal }) => fetchJson<{ subscriptions?: Device[] }>('/api/super-admin/push-subscriptions', { signal }),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/super-admin/push-subscriptions?id=${id}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'admin-devices'] }),
  });
  const items = query.data?.subscriptions ?? NO_ITEMS;
  const error = revokeMutation.isError ? 'Unable to revoke device.' : query.isError ? query.error.message || 'Unable to load devices.' : '';
  const revoke = (id: string) => revokeMutation.mutate(id);
  const columns: DataColumn<Device>[] = [
    { key: 'user', header: 'User', label: 'User', primary: true, cell: (item) => item.user },
    { key: 'role', header: 'Role', label: 'Role', cell: (item) => getRoleLabel(item.role, item.role) },
    { key: 'device', header: 'Device', label: 'Device', cell: (item) => formatDeviceLabel(item.deviceLabel) },
    { key: 'state', header: 'State', label: 'State', cell: (item) => (item.active ? 'Active' : 'Revoked') },
    {
      key: 'revoke',
      header: '',
      label: 'Revoke',
      actions: true,
      cell: (item) =>
        item.active ? (
          <button onClick={() => revoke(item.id)} className="min-h-11 px-2 text-xs font-semibold text-rose-700 underline">Revoke</button>
        ) : null,
    },
  ];
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h1 className="text-xl font-semibold">Notification devices</h1>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={items}
          getRowId={(item) => item.id}
          emptyTitle="No records"
        />
      </div>
    </section>
  );
}
